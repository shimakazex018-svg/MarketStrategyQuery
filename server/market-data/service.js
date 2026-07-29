'use strict';

const fs = require('fs/promises');
const path = require('path');
const { createCboeHistorySource } = require('../data-sources/cboe-history');
const { SelfCalculatedCoordinator } = require('../self-calculated/coordinator');
const { ANALYSIS_METRIC_IDS, PRODUCTION_METRIC_IDS, ProductionDataCoordinator } = require('../production-data/coordinator');
const { isProviderEffectivelyEnabled, providerById } = require('./provider-compliance');
const { availableRanges, filterHistory, validateModel } = require('./schema');
const { isWeekend } = require('./scheduler');
const { AcquisitionAudit } = require('./acquisition-audit');

const ONLINE_DECISIONS = Object.freeze({
  pe: { provider: 'sec-edgar', permission: 'secEdgar', reason: 'SEC bulk update requires explicit local opt-in and a valid user agent' },
  'nasdaq-cot-positioning': { provider: 'cftc', permission: 'cftc', reason: 'CFTC official public dataset is unavailable' },
  vix: { provider: 'cboe', permission: 'cboe', reason: 'Cboe 数据存储与再展示许可待确认' },
  vxn: { provider: 'cboe', permission: 'cboe', reason: 'Cboe 数据存储与再展示许可待确认' }
});

function isoNow(now) {
  return (now instanceof Date ? now : new Date(now)).toISOString();
}

function demoModel(indicator, now) {
  return {
    id: indicator.id,
    displayName: indicator.name,
    value: Number.isFinite(Number(indicator.value)) ? Number(indicator.value) : null,
    unit: indicator.unit || '',
    asOf: indicator.demoAsOf || null,
    source: indicator.demoSource || '站点静态演示数据',
    sourceUrl: null,
    sourceType: 'demo',
    frequency: 'static-demo',
    status: 'demo',
    statusMessage: indicator.demoMessage || '演示数据 / 待接入正式来源',
    updatedAt: indicator.demoUpdatedAt || null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextAllowedAt: null,
    isDemo: true,
    isStale: false,
    availableRanges: ['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y'],
    historyStart: null,
    history: [],
    servedAt: isoNow(now)
  };
}

function unavailableModel(indicator, decision, now) {
  return {
    id: indicator.id,
    displayName: indicator.name,
    value: null,
    unit: indicator.unit || '',
    asOf: null,
    source: decision.provider === 'cboe' ? 'Cboe（许可待确认）' : '正式来源暂不可用',
    sourceUrl: null,
    sourceType: 'official-pending',
    frequency: 'daily-close',
    status: 'unavailable',
    statusMessage: decision.reason,
    updatedAt: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextAllowedAt: null,
    isDemo: false,
    isStale: false,
    availableRanges: [],
    historyStart: null,
    history: [],
    servedAt: isoNow(now)
  };
}

function errorModel(indicator, source, error, limiterState, now) {
  return {
    id: indicator.id,
    displayName: indicator.name,
    value: null,
    unit: indicator.unit || '',
    asOf: null,
    source: source.source,
    sourceUrl: source.sourceUrl,
    sourceType: 'official',
    frequency: source.frequency,
    status: 'error',
    statusMessage: '在线数据暂时不可用，且没有可用缓存',
    updatedAt: null,
    lastAttemptAt: limiterState?.lastAttemptAt || isoNow(now),
    lastSuccessAt: limiterState?.lastSuccessAt || null,
    nextAllowedAt: limiterState?.nextAllowedAt || null,
    lastErrorType: error.marketDataType || 'unknown',
    isDemo: false,
    isStale: false,
    availableRanges: [],
    historyStart: null,
    history: [],
    servedAt: isoNow(now)
  };
}

class MarketDataService {
  constructor({ rootDir, config, cacheStore, limiter, logger, definitions = null, fetchImpl = global.fetch, now = () => new Date() }) {
    this.rootDir = rootDir;
    this.config = config;
    this.cacheStore = cacheStore;
    this.limiter = limiter;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.webPageProviders = new Map();
    this.indicators = [];
    this.models = new Map();
    this.sources = new Map();
    this.cacheErrors = new Map();
    this.coordinator = null;
    this.definitionOverride = definitions;
    this.productionMode = false;
    this.productionCoordinator = null;
    this.audit = new AcquisitionAudit(config.runtimeRoot || path.join(rootDir, 'runtime-data'), { now });
  }

  registerWebPageProvider(providerId, provider) {
    this.webPageProviders.set(providerId, provider);
  }

  getProviderDiagnosticStatus(providerId) {
    if (this.productionMode) return this.productionCoordinator.providerStatus(providerId);
    return this.webPageProviders.get(providerId)?.getStatus() || null;
  }

  getProviderLatest(providerId) {
    if (this.productionMode && ['fred', 'worldperatio'].includes(providerId)) return { providerId, metrics: this.indicators.filter(item => providerId === 'fred' ? !item.id.endsWith('_pe') : item.id.endsWith('_pe')).map(item => this.getIndicator(item.id)) };
    if (this.productionMode && providerId === 'ishares-soxx') return { providerId, metrics: [this.getIndicator('soxx_price')] };
    return this.webPageProviders.get(providerId)?.getLatest() || null;
  }

  getProviderHistory(providerId) {
    if (this.productionMode && ['fred', 'worldperatio'].includes(providerId)) return { providerId, metrics: this.indicators.filter(item => providerId === 'fred' ? !item.id.endsWith('_pe') : item.id.endsWith('_pe')).map(item => ({ metricId: item.id, history: this.getIndicator(item.id)?.history || [] })) };
    if (this.productionMode && providerId === 'ishares-soxx') return { providerId, metrics: [{ metricId: 'soxx_price', history: this.getIndicatorHistory('soxx_price', 'ALL')?.history || [] }] };
    return this.webPageProviders.get(providerId)?.getHistory() || null;
  }

  getProviderStatistics(providerId) {
    if (this.productionMode && providerId === 'worldperatio') return { providerId, metrics: this.indicators.filter(item => item.id.endsWith('_pe')).map(item => { const model = this.models.get(item.id); return { metricId: item.id, sourceDataDate: model?.sourceDataDate || null, valuationLabel: model?.valuationLabel || null, historicalStatistics: model?.historicalStatistics || {} }; }) };
    return this.webPageProviders.get(providerId)?.getStatistics() || null;
  }

  async init({ startupRefresh = true } = {}) {
    await this.cacheStore.init();
    const limiterError = await this.limiter.init();
    if (limiterError) await this.logger.log({ at: isoNow(this.now()), event: 'request-state-error', errorType: limiterError.type });
    this.indicators = this.definitionOverride || JSON.parse(await fs.readFile(path.join(this.rootDir, 'public', 'data', 'indicators.json'), 'utf8'));

    if (this.indicators.length === PRODUCTION_METRIC_IDS.length && PRODUCTION_METRIC_IDS.every(id => this.indicators.some(item => item.id === id))) {
      this.productionMode = true;
      this.productionCoordinator = new ProductionDataCoordinator({ rootDir: this.rootDir, definitions: this.indicators, fetchImpl: this.fetchImpl, now: this.now, timezone: this.config.timezone });
      await this.productionCoordinator.init();
      this.models = this.productionCoordinator.models;
      if (startupRefresh) await this.refreshExpiredOnStartup();
      return this;
    }

    if (this.config.selfCalculatedMvp) {
      this.coordinator = new SelfCalculatedCoordinator({
        rootDir: this.rootDir,
        runtimeRoot: this.config.runtimeRoot,
        config: this.config,
        cacheStore: this.cacheStore,
        definitions: this.indicators,
        fetchImpl: this.fetchImpl,
        now: this.now
      });
      await this.coordinator.init();
      this.models = this.coordinator.models;
      this.sources.set('pe', this.coordinator.secSource);
      this.sources.set('nasdaq-cot-positioning', this.coordinator.cftcSource);
      return this;
    }

    for (const id of ['vix', 'vxn']) {
      this.sources.set(id, createCboeHistorySource(id, {
        fetchImpl: this.fetchImpl,
        requestTimeoutMs: this.config.requestTimeoutMs
      }));
    }

    for (const indicator of this.indicators) {
      const decision = ['vix', 'vxn'].includes(indicator.id) ? ONLINE_DECISIONS[indicator.id] : null;
      if (!decision) {
        this.models.set(indicator.id, demoModel(indicator, this.now()));
        continue;
      }
      const approved = this.config.enabled && this.config.permissions[decision.permission];
      if (!approved) {
        this.models.set(indicator.id, unavailableModel(indicator, decision, this.now()));
        continue;
      }
      const cached = await this.cacheStore.readIndicator(indicator.id);
      if (cached.error) {
        this.cacheErrors.set(indicator.id, cached.error);
        await this.logger.log({ at: isoNow(this.now()), indicatorId: indicator.id, event: 'cache-read', success: false, errorType: cached.error.type });
      }
      if (cached.data) {
        try {
          const requestState = this.limiter.indicatorState(indicator.id);
          this.models.set(indicator.id, validateModel({
            ...cached.data,
            lastAttemptAt: requestState.lastAttemptAt || cached.data.lastAttemptAt || null,
            lastSuccessAt: requestState.lastSuccessAt || cached.data.lastSuccessAt || null,
            nextAllowedAt: requestState.nextAllowedAt || cached.data.nextAllowedAt || null
          }));
        } catch (error) {
          this.cacheErrors.set(indicator.id, { type: 'cache-invalid', message: error.message });
        }
      }
      if (!this.models.has(indicator.id)) {
        this.models.set(indicator.id, errorModel(indicator, this.sources.get(indicator.id), { marketDataType: 'not-attempted' }, null, this.now()));
      }
    }

    if (startupRefresh) await this.refreshExpiredOnStartup();
    return this;
  }

  indicatorDefinition(id) {
    return this.indicators.find(indicator => indicator.id === id);
  }

  isApproved(id) {
    if (this.productionMode) return PRODUCTION_METRIC_IDS.includes(id) || ANALYSIS_METRIC_IDS.includes(id);
    const decision = ONLINE_DECISIONS[id];
    const provider = decision ? providerById(this.config.providerRegistry, decision.provider) : null;
    return Boolean(decision
      && this.config.enabled
      && this.config.permissions[decision.permission]
      && isProviderEffectivelyEnabled(provider));
  }

  isExternalSelfCalculated(id) {
    return this.config.selfCalculatedMvp && (id === 'pe' || id === 'nasdaq-cot-positioning');
  }

  isFresh(model, now = this.now()) {
    if (model.status !== 'fresh' || !model.lastSuccessAt) return false;
    const source = this.sources.get(model.id);
    return source && now.valueOf() - new Date(model.lastSuccessAt).valueOf() < source.freshForMs;
  }

  async refreshExpiredOnStartup() {
    if (this.productionMode) {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: this.config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(this.now()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
      if (Number(parts.hour) > 7 || (Number(parts.hour) === 7 && Number(parts.minute) >= 30)) {
        for (const id of PRODUCTION_METRIC_IDS) await this.refresh(id, { kind: 'startup', requestSource: 'server-start' });
        for (const id of ANALYSIS_METRIC_IDS) await this.refresh(id, { kind: 'startup', requestSource: 'local-import-check' });
      }
      return;
    }
    if (isWeekend(this.now(), this.config.timezone)) return;
    const tasks = [];
    for (const [id] of this.sources) {
      if (!this.isApproved(id)) continue;
      const model = this.models.get(id);
      if (!this.isFresh(model)) tasks.push(this.refresh(id, { kind: 'startup', requestSource: 'server-start' }));
    }
    await Promise.allSettled(tasks);
  }

  async refresh(id, { kind = 'scheduled', requestSource = 'scheduler' } = {}) {
    if (this.productionMode) {
      const startedAt = isoNow(this.now());
      const result = await this.productionCoordinator.refresh(id);
      const indicator = this.getIndicator(id);
      const providerId = id === 'soxx_price' ? 'ishares' : id === 'naaim_exposure' ? 'naaim' : id.endsWith('_pe') ? 'worldperatio' : 'fred';
      const trigger = ['soxx_price', 'naaim_exposure'].includes(id) ? 'local_reload' : kind === 'startup' ? 'startup_catchup' : 'scheduled';
      await this.audit.append({
        providerId, metricId: id, trigger, startedAt, completedAt: isoNow(this.now()),
        result: result.ok ? (result.reason === 'already-successful-today' ? 'cached' : 'success') : 'failed',
        externalRequestCount: ['soxx_price', 'naaim_exposure'].includes(id) ? 0 : result.reason === 'already-successful-today' ? 0 : 1,
        cacheAction: result.ok ? (result.reason === 'already-successful-today' ? 'unchanged' : 'updated') : indicator?.status === 'stale' ? 'stale_fallback' : 'none',
        sourceDataDate: indicator?.sourceDataDate || indicator?.asOf || null,
        errorCategory: result.ok ? null : result.reason || 'source_unavailable'
      });
      return result;
    }
    if (this.config.selfCalculatedMvp) return this.refreshSelfCalculated(id, { kind, requestSource });
    const indicator = this.indicatorDefinition(id);
    const source = this.sources.get(id);
    if (!indicator || !source) return { ok: false, statusCode: 404, reason: 'unknown-indicator' };
    if (!this.isApproved(id)) return { ok: false, statusCode: 409, reason: 'source-not-approved', indicator: this.getIndicator(id) };

    const allowed = await this.limiter.canAttempt(id, source.provider, kind, this.now());
    if (!allowed.ok) return { ok: false, statusCode: 429, ...allowed, indicator: this.getIndicator(id) };
    if (!this.limiter.begin(id)) return { ok: false, statusCode: 409, reason: 'in-progress', indicator: this.getIndicator(id) };

    const attemptAt = this.now();
    await this.limiter.recordAttempt(id, source.provider, kind, attemptAt);
    try {
      const result = await source.fetch();
      const latest = result.history.at(-1);
      const previous = this.models.get(id);
      const unchanged = previous?.asOf === latest.date && Number(previous?.value) === latest.value;
      const successAt = this.now();
      const limiterState = await this.limiter.recordSuccess(id, successAt);
      const model = validateModel({
        id,
        displayName: indicator.name,
        value: latest.value,
        unit: indicator.unit || '',
        asOf: latest.date,
        source: source.source,
        sourceUrl: source.sourceUrl,
        sourceType: 'official',
        frequency: source.frequency,
        status: 'fresh',
        statusMessage: unchanged ? '来源数据日期与数值未变化' : '官方日收盘数据',
        updatedAt: isoNow(successAt),
        lastAttemptAt: limiterState.lastAttemptAt,
        lastSuccessAt: limiterState.lastSuccessAt,
        nextAllowedAt: limiterState.nextAllowedAt,
        isDemo: false,
        isStale: false,
        availableRanges: availableRanges(result.history),
        historyStart: result.history[0].date,
        history: result.history
      });
      this.models.set(id, model);
      if (!unchanged) await this.cacheStore.writeIndicator(id, model);
      if (process.env.MARKET_DATA_SAVE_RAW === 'true') await this.cacheStore.writeRaw(id, result.raw);
      await this.logger.log({
        at: isoNow(successAt), indicatorId: id, provider: source.provider, event: 'fetch', requestSource,
        httpStatus: result.httpStatus, durationMs: result.durationMs, success: true,
        dataDate: latest.date, wroteNewData: !unchanged, attempt: limiterState.attempts,
        nextRetryAt: null
      });
      return { ok: true, unchanged, indicator: this.getIndicator(id) };
    } catch (error) {
      const failedAt = this.now();
      const limiterState = await this.limiter.recordFailure(id, error.marketDataType || 'unknown', failedAt);
      const cached = this.models.get(id);
      const hasCache = cached?.history?.length && cached.value !== null;
      const model = hasCache
        ? { ...cached, status: 'stale', statusMessage: '更新失败，显示最后一次成功数据', isStale: true,
          lastAttemptAt: limiterState.lastAttemptAt, nextAllowedAt: limiterState.nextAllowedAt,
          lastErrorType: limiterState.lastErrorType, servedAt: isoNow(failedAt) }
        : errorModel(indicator, source, error, limiterState, failedAt);
      this.models.set(id, model);
      if (hasCache) await this.cacheStore.writeIndicator(id, model);
      await this.logger.log({
        at: isoNow(failedAt), indicatorId: id, provider: source.provider, event: 'fetch', requestSource,
        httpStatus: error.status || null, durationMs: error.durationMs || null, success: false,
        dataDate: cached?.asOf || null, wroteNewData: false, errorType: error.marketDataType || 'unknown',
        attempt: limiterState.attempts, nextRetryAt: limiterState.nextAllowedAt
      });
      return { ok: false, statusCode: 502, reason: error.marketDataType || 'fetch-failed', indicator: this.getIndicator(id) };
    } finally {
      this.limiter.end(id);
    }
  }

  async refreshSelfCalculated(id, { kind = 'scheduled', requestSource = 'scheduler' } = {}) {
    const indicator = this.indicatorDefinition(id);
    if (!indicator) return { ok: false, statusCode: 404, reason: 'unknown-indicator' };
    if (!this.isExternalSelfCalculated(id)) {
      await this.coordinator.reloadLocalInputs();
      return { ok: true, indicator: this.getIndicator(id) };
    }
    if (!this.isApproved(id)) return { ok: false, statusCode: 409, reason: 'source-not-approved', indicator: this.getIndicator(id) };
    const source = this.sources.get(id);
    if (this.isExternalSelfCalculated(id)) {
      await this.limiter.ensureDay(this.now());
      const attemptsToday = this.limiter.snapshot().indicators[id]?.attempts || 0;
      if (attemptsToday >= 1) return { ok: false, statusCode: 429, reason: 'source-daily-limit', indicator: this.getIndicator(id) };
    }
    const allowed = await this.limiter.canAttempt(id, source.provider, kind, this.now());
    if (!allowed.ok) return { ok: false, statusCode: 429, ...allowed, indicator: this.getIndicator(id) };
    if (!this.limiter.begin(id)) return { ok: false, statusCode: 409, reason: 'in-progress', indicator: this.getIndicator(id) };
    const attemptAt = this.now();
    await this.limiter.recordAttempt(id, source.provider, kind, attemptAt);
    try {
      const result = await this.coordinator.refresh(id);
      const successAt = this.now();
      await this.limiter.recordSuccess(id, successAt);
      await this.logger.log({
        at: isoNow(successAt), indicatorId: id, provider: source.provider, event: 'fetch', requestSource,
        success: result.ok, wroteNewData: result.sourceResult?.status !== 'unchanged',
        dataDate: this.models.get(id)?.asOf || null
      });
      return { ...result, indicator: this.getIndicator(id) };
    } catch (error) {
      const failedAt = this.now();
      const limiterState = await this.limiter.recordFailure(id, error.marketDataType || 'unknown', failedAt);
      const current = this.models.get(id);
      const hasUsableValue = current?.value !== null && current?.asOf;
      const failedModel = {
        ...current,
        status: hasUsableValue ? 'stale' : 'error',
        statusMessage: hasUsableValue ? '外部更新失败，保留最后一次成功结果' : '外部数据请求失败，且没有可用缓存',
        isStale: Boolean(hasUsableValue),
        lastAttemptAt: limiterState.lastAttemptAt,
        nextAllowedAt: limiterState.nextAllowedAt,
        lastErrorType: limiterState.lastErrorType,
        servedAt: isoNow(failedAt)
      };
      this.models.set(id, validateModel(failedModel));
      await this.logger.log({
        at: isoNow(failedAt), indicatorId: id, provider: source.provider, event: 'fetch', requestSource,
        success: false, errorType: error.marketDataType || 'unknown', dataDate: current?.asOf || null,
        wroteNewData: false, nextRetryAt: limiterState.nextAllowedAt
      });
      return { ok: false, statusCode: 502, reason: error.marketDataType || 'fetch-failed', indicator: this.getIndicator(id) };
    } finally {
      this.limiter.end(id);
    }
  }

  getIndicator(id, range = '1Y') {
    const model = this.models.get(id);
    if (!model) return null;
    const history = filterHistory(model.history || [], range, model.asOf, 240);
    const robustHistory = Array.isArray(model.robustHistory)
      ? filterHistory(model.robustHistory, range, model.asOf, 240)
      : undefined;
    return { ...model, history, ...(robustHistory ? { robustHistory } : {}), requestedRange: range, servedAt: isoNow(this.now()) };
  }

  getIndicatorHistory(id, range = '1Y') {
    const model = this.models.get(id);
    if (!model) return null;
    if (range !== 'ALL') {
      const ranged = this.getIndicator(id, range);
      return { metricId: ranged.id, range, history: ranged.history, historyStart: ranged.historyStart, historyEnd: ranged.historyEnd, status: ranged.status, provider: ranged.provider, sourceLabel: ranged.sourceLabel, seriesType: ranged.seriesType || null, adjustmentStatus: ranged.adjustmentStatus || null, excludedConflictDateCount: ranged.excludedConflictDateCount || 0, limitations: ranged.limitations || [] };
    }
    const history = (model.history || []).map(point => ({ date: point.date, value: point.value }));
    return {
      metricId: model.id,
      range,
      history,
      historyStart: history[0]?.date || null,
      historyEnd: history.at(-1)?.date || null,
      status: model.status,
      provider: model.provider,
      sourceLabel: model.sourceLabel,
      seriesType: model.seriesType || null,
      adjustmentStatus: model.adjustmentStatus || null,
      excludedConflictDateCount: model.excludedConflictDateCount || 0, limitations: model.limitations || []
    };
  }

  getIndicators(range = '1Y') {
    return this.indicators.map(indicator => this.getIndicator(indicator.id, range));
  }

  getStatus() {
    return {
      enabled: this.config.enabled,
      mode: this.productionMode ? 'production-six-metrics' : this.config.selfCalculatedMvp ? 'self-calculated-mvp' : 'legacy-online',
      timezone: this.config.timezone,
      permissions: {
        cboe: this.config.permissions.cboe ? 'confirmed' : 'not-confirmed',
        secEdgar: this.config.permissions.secEdgar ? 'configured-and-opted-in' : 'disabled-or-user-agent-missing',
        cftc: this.config.permissions.cftc ? 'approved' : 'disabled'
      },
      providers: (this.config.providerRegistry?.providers || []).map(provider => ({
        providerId: provider.providerId,
        technicalStatus: provider.technicalStatus,
        complianceStatus: provider.complianceStatus,
        enabled: provider.enabled,
        effectiveEnabled: isProviderEffectivelyEnabled(provider)
      })),
      fredApiKeyConfigured: this.config.fredApiKeyConfigured,
      requestState: this.limiter.snapshot(),
      cacheErrors: Object.fromEntries(this.cacheErrors),
      indicators: this.indicators.map(indicator => ({ id: indicator.id, status: this.models.get(indicator.id)?.status || 'error' })),
      servedAt: isoNow(this.now())
    };
  }

  async getDataAcquisitionStatus(scheduler = null) {
    const models = [...this.models.values()];
    const diagnostics = {
      fred: this.productionCoordinator?.providerStatus('fred') || null,
      worldperatio: this.productionCoordinator?.providerStatus('worldperatio') || null,
      ishares: this.productionCoordinator?.providerStatus('ishares-soxx') || null, naaim: this.productionCoordinator?.providerStatus('naaim') || null
    };
    const nextScheduledAt = scheduler?.nextScheduledAt?.() || null;
    const providerDefinitions = [
      { providerId: 'fred', displayName: 'FRED', domain: 'fred.stlouisfed.org', sourceType: 'official_csv', networkAccessEnabled: true, updateMode: 'scheduled_daily', ids: ['vix', 'vxn', 'nasdaq100_index', 'sp500_index'], note: '数据通过FRED取得，原始来源以各系列标注为准。' },
      { providerId: 'worldperatio', displayName: 'WorldPEratio', domain: 'worldperatio.com', sourceType: 'public_webpage', networkAccessEnabled: true, updateMode: 'scheduled_daily', ids: ['nasdaq100_pe', 'sp500_pe'], note: '第三方公开参考数据，不代表指数编制机构官方估值。' },
      { providerId: 'ishares', displayName: 'iShares / BlackRock', domain: 'ishares.com', sourceType: 'official_workbook_local_import', networkAccessEnabled: false, updateMode: 'manual_import', ids: ['soxx_price'], note: 'SOXX数据来自官方工作簿的本地人工导入，网站不会自动访问iShares。' },
      { providerId: 'naaim', displayName: 'NAAIM', domain: 'naaim.org', sourceType: 'official_workbook_local_import', networkAccessEnabled: false, updateMode: 'manual_import', frequency: 'weekly', ids: ['naaim_exposure'], note: '官方Excel由用户人工下载并导入。服务器不会自动访问NAAIM或MacroMicro。' }
    ];
    const metricMeta = {
      vix: { sourceDataset: 'VIXCLS', sourcePageLabel: 'FRED VIXCLS', accessMethod: 'official_csv', limitations: ['原始来源为Cboe'] },
      vxn: { sourceDataset: 'VXNCLS', sourcePageLabel: 'FRED VXNCLS', accessMethod: 'official_csv', limitations: ['原始来源为Cboe'] },
      nasdaq100_index: { sourceDataset: 'NASDAQ100', sourcePageLabel: 'FRED NASDAQ100', accessMethod: 'official_csv', limitations: [] },
      sp500_index: { sourceDataset: 'SP500', sourcePageLabel: 'FRED SP500', accessMethod: 'official_csv', limitations: [] },
      nasdaq100_pe: { sourceDataset: '/index/nasdaq-100/', sourcePageLabel: 'WorldPEratio Nasdaq-100', accessMethod: 'public_webpage', limitations: ['QQQ-based第三方公开参考', 'PE时间曲线从本站首次成功采集日期开始积累'] },
      sp500_pe: { sourceDataset: '/index/sp-500/', sourcePageLabel: 'WorldPEratio S&P 500', accessMethod: 'public_webpage', limitations: ['SPY-based第三方公开参考', 'PE时间曲线从本站首次成功采集日期开始积累'] },
      soxx_price: { sourceDataset: 'iShares SOXX Data Download', sourcePageLabel: 'SOXX NAV 官方工作簿', accessMethod: 'official_workbook_local_import', limitations: ['NAV，不是交易所市场价格', 'seriesType = nav', 'adjustmentStatus = provider_adjusted'] },
      naaim_exposure: { sourceDataset: 'NAAIM Exposure Index workbook', sourcePageLabel: 'NAAIM官方Excel', accessMethod: 'official_workbook_local_import', limitations: ['NAAIM官方工作簿中有2个早期同日冲突日期，本站已将这些日期从正式序列中排除。'] }
    };
    const datasets = providerDefinitions.flatMap(provider => provider.ids.map(id => {
      const model = this.models.get(id) || {};
      const diagnostic = diagnostics[provider.providerId]?.metrics?.[id] || {};
      const meta = metricMeta[id];
      return {
        metricId: id, label: model.displayName || model.label || id, providerId: provider.providerId,
        sourceDataset: meta.sourceDataset, sourcePageLabel: meta.sourcePageLabel, sourceUrl: model.sourceUrl || null,
        accessMethod: meta.accessMethod, updateMode: provider.updateMode, frequency: provider.frequency || model.frequency || 'daily', isRealtime: false,
        networkFetchEnabled: provider.networkAccessEnabled, status: provider.providerId === 'ishares' && model.status === 'fresh' ? 'manual' : (model.status || 'unavailable'),
        latestValue: Number.isFinite(Number(model.value)) ? Number(model.value) : null, unit: model.unit || null,
        sourceDataDate: model.sourceDataDate || model.asOf || null, fetchedAt: model.fetchedAt || model.updatedAt || null,
        lastAttemptAt: diagnostic.lastAttemptAt || (provider.providerId === 'ishares' ? diagnostics.ishares?.lastLoadedAt || null : null),
        lastSuccessAt: model.lastSuccessAt || model.fetchedAt || null, nextScheduledAt: provider.updateMode === 'scheduled_daily' ? nextScheduledAt : null,
        historyAvailable: Boolean(model.historyAvailable), historyStart: model.historyStart || null, historyEnd: model.historyEnd || null,
        seriesType: model.seriesType || (id === 'soxx_price' ? 'nav' : null), adjustmentStatus: model.adjustmentStatus || (id === 'soxx_price' ? 'provider_adjusted' : null), excludedConflictDateCount: model.excludedConflictDateCount || 0, limitations: [...(model.limitations || []), ...meta.limitations]
      };
    }));
    const providers = providerDefinitions.map(provider => {
      const entries = datasets.filter(item => item.providerId === provider.providerId);
      const diagnostic = diagnostics[provider.providerId];
      const state = entries.some(item => item.status === 'error') ? 'error' : entries.some(item => item.status === 'stale') ? 'stale' : ['ishares','naaim'].includes(provider.providerId) ? 'manual' : entries.some(item => item.status === 'unavailable') ? 'unavailable' : 'fresh';
      return { ...provider, isRealtime: false, schedule: { enabled: provider.updateMode === 'scheduled_daily', timezone: this.config.timezone, time: '07:30' }, status: state,
        lastAttemptAt: entries.map(item => item.lastAttemptAt).filter(Boolean).sort().at(-1) || null, lastSuccessAt: entries.map(item => item.lastSuccessAt).filter(Boolean).sort().at(-1) || null,
        nextScheduledAt: provider.updateMode === 'scheduled_daily' ? nextScheduledAt : null, attemptsToday: Math.max(0, ...entries.map(item => Number(diagnostic?.metrics?.[item.metricId]?.attempts) || 0)),
        dailyRequestBudget: provider.networkAccessEnabled ? 2 * entries.length : 0, lastErrorCategory: entries.map(item => diagnostic?.metrics?.[item.metricId]?.lastError?.type).find(Boolean) || diagnostics.ishares?.lastError || null,
        datasets: entries, excludedConflictDateCount: Math.max(0, ...entries.map(item => Number(item.excludedConflictDateCount) || 0)), note: provider.note };
    });
    const recentRuns = (await this.audit.read()).slice(-20).reverse();
    const allFresh = datasets.every(item => ['fresh', 'manual'].includes(item.status));
    return {
      generatedAt: isoNow(this.now()), service: { mode: this.productionMode ? 'production-six-metrics' : 'other', status: 'ready', startedAt: null, uptimeSeconds: null },
      scheduler: scheduler?.getStatus?.() || { enabled: false, timezone: this.config.timezone, time: '07:30', nextScheduledAt: null, running: false, currentProviderId: null, startupCatchupEnabled: true, lastCycleStartedAt: null, lastCycleCompletedAt: null, lastCycleResult: 'not_available' },
      summary: { enabledProviderCount: providers.length, enabledDatasetCount: datasets.length, dailyNetworkDatasetCount: datasets.filter(item => item.networkFetchEnabled).length, localImportDatasetCount: datasets.filter(item => !item.networkFetchEnabled).length, realtimeProviderCount: 0, schedulerStatus: scheduler?.running ? 'running' : allFresh ? 'normal' : 'partial' },
      realtime: { enabled: false, message: '当前网站没有实时行情源。FRED和WorldPEratio按日检查，SOXX使用本地导入的官方NAV数据。' },
      providers, datasets, recentRuns,
      storage: { runtimeDataIgnored: true, gitTracksRealMarketData: false, rawHtmlStored: false, credentialsUsed: false, externalApiExposed: false, message: '真实市场数据、运行缓存和采集记录仅保存在服务器本地runtime-data目录，不进入Git仓库。' }
    };
  }
}

module.exports = { MarketDataService, ONLINE_DECISIONS, demoModel, errorModel, unavailableModel };
