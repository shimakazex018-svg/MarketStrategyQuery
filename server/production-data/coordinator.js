'use strict';

const path = require('path');
const { EtfPriceProvider, SOXX_METRIC_ID } = require('../data-sources/etf-price-provider');
const { NaaimExposureProvider, NAAIM_METRIC_ID } = require('../data-sources/naaim-exposure-provider');
const { NaaimOfficialUpdater } = require('../data-sources/naaim-official-updater');
const { FredProvider, FRED_SERIES } = require('../data-sources/fred-provider');
const { PE_TARGETS, WorldPERatioProductionProvider } = require('../data-sources/worldperatio-production');
const { RuntimeImportStore } = require('../imports/runtime-import-store');
const { calculateMarketSignals } = require('../derived-indicators/market-signals');
const { calculateRealizedVolatility, rollingRealizedVolatility } = require('../derived-indicators/realized-volatility');
const { calculateVolatilityPercentiles } = require('../derived-indicators/volatility-percentile');
const { DEFAULT_RULES } = require('../derived-indicators/technical-indicators');
const { availableRanges } = require('../market-data/schema');

const PRODUCTION_METRIC_IDS = Object.freeze(['nasdaq100_pe', 'sp500_pe', 'vix', 'vxn', 'nasdaq100_index', 'sp500_index']);
const ANALYSIS_METRIC_IDS = Object.freeze([SOXX_METRIC_ID, NAAIM_METRIC_ID]);
const LOCAL_SIGNAL_IDS = Object.freeze([
  'qqq-vs-ma200', 'qqq-momentum-20', 'qqq-momentum-120', 'qqq-52w-high-distance', 'qqq-52w-max-drawdown',
  'soxx-relative-qqq', 'qqq-rv20', 'qqq-rv20-percentile', 'qqq-ema-5', 'qqq-ema-20', 'qqq-ema-60', 'qqq-ema-200',
  'qqq-rsi', 'qqq-macd', 'qqq-macd-histogram', 'qqq-volume-relative', 'qqq-return-25', 'qqq-current-drawdown',
  'follow-through-day', 'top-risk-rsi', 'top-risk-volume', 'top-risk-macd', 'bottom-candidate-rsi', 'bottom-candidate-volume'
]);
const SIGNAL_GROUPS = Object.freeze(['valuation', 'trend_momentum', 'fear_positioning', 'macro_credit', 'semiconductor']);
const EXISTING_SIGNAL_REFERENCES = Object.freeze([
  { id: 'nasdaq100_pe', group: 'valuation' },
  { id: 'sp500_pe', group: 'valuation' },
  { id: 'nasdaq100_index', group: 'trend_momentum' },
  { id: 'sp500_index', group: 'trend_momentum' },
  { id: 'vix', group: 'fear_positioning' },
  { id: 'vxn', group: 'fear_positioning' },
  { id: 'naaim_exposure', group: 'fear_positioning' },
  { id: 'soxx_price', group: 'semiconductor' }
]);
const VALUE_STATUSES = new Set(['fresh', 'stale', 'manual', 'provisional', 'quality_warning']);
const SOURCE_LABELS = Object.freeze({ nasdaq100_pe: 'WorldPEratio · QQQ-based reference', sp500_pe: 'WorldPEratio · SPY-based reference', vix: 'FRED / Cboe', vxn: 'FRED / Cboe', nasdaq100_index: 'FRED', sp500_index: 'FRED', soxx_price: 'iShares / BlackRock', naaim_exposure: 'NAAIM 官方Excel本地导入' });

function entryName(entry, id) { return entry?.displayName || entry?.name || id; }

function localUnavailable(entry, message = 'Local OHLCV CSV is unavailable; no value was substituted.', now = new Date()) {
  const id = entry?.id || 'local-signal';
  return {
    id, metricId: id, displayName: entryName(entry, id), label: entryName(entry, id), value: null, unit: entry?.unit || '',
    asOf: null, sourceDataDate: null, fetchedAt: null, updatedAt: null, provider: 'local-csv', source: 'Local normalized OHLCV CSV', sourceLabel: 'Local normalized OHLCV CSV', sourceUrl: null,
    frequency: 'daily on input change', status: 'unavailable', statusMessage: message, historyAvailable: false, historyStart: null, historyEnd: null,
    availableRanges: [], history: [], limitations: entry?.limitations || [], qualityStatus: 'unavailable', dataQuality: { status: 'unavailable', qualityFlags: [] }, isDemo: false, isStale: false, servedAt: now.toISOString()
  };
}

function localModel(entry, value, history, context = {}) {
  const finiteValue = value === null || value === undefined ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
  const cleanHistory = (Array.isArray(history) ? history : []).filter(point => point && /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(Number(point.value))).map(point => ({ date: point.date, value: Number(point.value) }));
  const asOf = context.asOf || cleanHistory.at(-1)?.date || null;
  const qualityFlags = [...new Set([...(context.quality?.qualityFlags || []), ...(context.qualityFlags || [])])];
  const status = context.status || (finiteValue === null ? 'insufficient_coverage' : qualityFlags.length ? 'quality_warning' : 'fresh');
  return {
    id: entry.id, metricId: entry.id, displayName: entryName(entry, entry.id), label: entryName(entry, entry.id), value: finiteValue, unit: context.unit || entry.unit || '%',
    asOf, sourceDataDate: asOf, fetchedAt: context.calculatedAt || null, updatedAt: context.calculatedAt || null, lastSuccessAt: finiteValue === null ? null : context.calculatedAt || null,
    provider: 'local-csv', source: context.source || 'Local normalized OHLCV CSV', sourceLabel: context.source || 'Local normalized OHLCV CSV', sourceUrl: null,
    sourceType: 'self-calculated-local', frequency: entry.frequency || 'daily on input change', status, statusMessage: context.statusMessage || (status === 'quality_warning' ? 'Local value is available with explicit quality warnings.' : status === 'insufficient_coverage' ? 'Not enough observations for this formula.' : 'Derived from the latest local input.'),
    availableRanges: availableRanges(cleanHistory), historyStart: cleanHistory[0]?.date || null, historyEnd: cleanHistory.at(-1)?.date || null, history: cleanHistory, historyAvailable: cleanHistory.length > 0,
    qualityStatus: qualityFlags.length ? 'quality_warning' : 'ok', qualityFlags, dataQuality: { ...(context.quality || {}), qualityFlags }, algorithmVersion: context.algorithmVersion || entry.formulaVersion || null,
    formulaVersion: entry.formulaVersion || null, signalState: context.signalState || null, triggered: context.triggered ?? null, direction: context.direction || null, evidence: context.evidence || null, trigger: context.trigger || null,
    details: context.details || null, limitations: entry.limitations || [], isDemo: false, isStale: status === 'stale', servedAt: new Date(context.calculatedAt || new Date()).toISOString()
  };
}

class ProductionDataCoordinator {
  constructor({ rootDir, definitions, catalog = [], signalRules = DEFAULT_RULES, fetchImpl = global.fetch, now = () => new Date(), timezone = 'Asia/Shanghai' }) {
    this.rootDir = rootDir; this.runtimeRoot = path.join(rootDir, 'runtime-data'); this.productionRoot = path.join(rootDir, 'runtime-data', 'market-data', 'production'); this.definitions = definitions; this.catalog = Array.isArray(catalog) ? catalog : (catalog?.entries || []); this.signalRules = signalRules; this.now = now;
    this.fred = new FredProvider({ productionRoot: this.productionRoot, fetchImpl, now, timezone });
    this.worldperatio = new WorldPERatioProductionProvider({ productionRoot: this.productionRoot, fetchImpl, now, timezone });
    this.etfPrice = new EtfPriceProvider({ productionRoot: this.productionRoot, now, timezone });
    this.naaim = new NaaimExposureProvider({ productionRoot: this.productionRoot, now, timezone });
    this.naaimUpdater = new NaaimOfficialUpdater({ rootDir, fetchImpl, now, timezone });
    this.importStore = new RuntimeImportStore(this.runtimeRoot);
    this.models = new Map();
    this.localSignalModels = new Map();
    this.localImportStatus = { status: 'unavailable', sourceFile: null, source: null, asOf: null, error: null, qualityFlags: [] };
  }
  async init() { await Promise.all([this.fred.init(), this.worldperatio.init(), this.etfPrice.init(), this.naaim.init()]); await this.reload(); return this; }
  definition(id) { const catalogEntry = this.catalog.find(item => item.id === id); return this.definitions.find(item => item.id === id) || (catalogEntry ? { id, name: entryName(catalogEntry, id), unit: catalogEntry.unit || '' } : (id === SOXX_METRIC_ID ? { id, name: 'SOXX半导体ETF', unit: 'usd' } : { id, name: id, unit: '' })); }
  unavailable(id) { const definition = this.definition(id); const provider = id === SOXX_METRIC_ID ? 'iShares / BlackRock' : id.endsWith('_pe') ? 'WorldPEratio' : 'FRED'; return { id, metricId: id, displayName: definition.name, label: definition.name, value: null, unit: definition.unit || '', asOf: null, sourceDataDate: null, fetchedAt: null, provider, source: SOURCE_LABELS[id], sourceLabel: SOURCE_LABELS[id], sourceUrl: null, frequency: 'daily', status: 'unavailable', statusMessage: '该指标当前没有可用的正式运行数据', historyAvailable: false, historyStart: null, historyEnd: null, availableRanges: [], history: [], limitations: [], isDemo: false, isStale: false };
  }
  async loadFred(id) {
    const data = await this.fred.read(id); if (!data) return this.unavailable(id);
    const history = (data.values || []).filter(point => point.value !== null).map(point => ({ date: point.date, value: Number(point.value) }));
    if (!history.length) return this.unavailable(id); const latest = history.at(-1); const prior = history.at(-2); const failed = Boolean(this.fred.state.metrics[id]?.lastError);
    const definition = this.definition(id);
    return { id, metricId: id, displayName: definition.name, label: definition.name, value: latest.value, unit: definition.unit, asOf: latest.date, sourceDataDate: latest.date, fetchedAt: data.fetchedAt, updatedAt: data.fetchedAt, provider: 'FRED', source: SOURCE_LABELS[id], sourceLabel: SOURCE_LABELS[id], sourceUrl: `https://fred.stlouisfed.org/series/${FRED_SERIES[id].seriesId}`, frequency: 'daily', status: failed ? 'stale' : 'fresh', statusMessage: failed ? '数据可能已延迟，正在显示最后成功数据' : '正式运行数据', historyAvailable: true, historyStart: history[0].date, historyEnd: latest.date, availableRanges: availableRanges(history), history, change: prior ? latest.value - prior.value : null, limitations: ['数据可能存在延迟或修订'], isDemo: false, isStale: failed, lastSuccessAt: this.fred.state.metrics[id]?.lastSuccessAt || data.fetchedAt };
  }
  async loadPe(id) {
    const data = await this.worldperatio.read(id); if (!data) return this.unavailable(id);
    const snapshots = await this.worldperatio.readHistory(id); const history = snapshots.map(point => ({ date: point.sourceDataDate, value: Number(point.value) })).filter(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.value));
    const failed = Boolean(this.worldperatio.state.metrics[id]?.lastError); const definition = this.definition(id); const previous = history.at(-2);
    return { id, metricId: id, displayName: definition.name, label: definition.name, value: Number(data.currentPE), unit: definition.unit, asOf: data.sourceDataDate, sourceDataDate: data.sourceDataDate, fetchedAt: data.fetchedAt, updatedAt: data.fetchedAt, provider: 'WorldPEratio', source: SOURCE_LABELS[id], sourceLabel: SOURCE_LABELS[id], sourceUrl: data.sourceUrl || PE_TARGETS[id].url, frequency: 'daily snapshot', status: failed ? 'stale' : 'fresh', statusMessage: failed ? '数据可能已延迟，正在显示最后成功数据' : '第三方公开参考数据', historyAvailable: history.length > 0, historyStart: history[0]?.date || null, historyEnd: history.at(-1)?.date || null, availableRanges: availableRanges(history), history, change: previous ? Number(data.currentPE) - previous.value : null, valuationLabel: data.valuationLabel || null, historicalStatistics: data.historicalStatistics || {}, historyType: 'snapshot_history', snapshotCount: history.length, limitations: ['第三方公开参考，不代表指数编制机构官方估值', 'PE历史曲线从本站首次成功采集日期开始积累'], isDemo: false, isStale: failed, lastSuccessAt: this.worldperatio.state.metrics[id]?.lastSuccessAt || data.fetchedAt };
  }
  async loadSoxx() {
    const data = await this.etfPrice.read(); if (!data) return this.unavailable(SOXX_METRIC_ID);
    const history = data.values.map(point => ({ date: point.date, value: Number(point.value) })); const latest = history.at(-1); const prior = history.at(-2);
    return { id: SOXX_METRIC_ID, metricId: SOXX_METRIC_ID, displayName: 'SOXX半导体ETF', label: 'SOXX半导体ETF', value: latest.value, unit: 'usd', asOf: latest.date, sourceDataDate: latest.date, fetchedAt: data.fetchedAt, updatedAt: data.fetchedAt, provider: data.provider, source: data.sourceLabel || SOURCE_LABELS[SOXX_METRIC_ID], sourceLabel: data.sourceLabel || SOURCE_LABELS[SOXX_METRIC_ID], sourceUrl: data.sourceUrl, frequency: 'daily', status: this.etfPrice.lastError ? 'stale' : 'fresh', statusMessage: this.etfPrice.lastError ? '数据可能已延迟，正在显示最后成功数据' : '本地导入的官方基金数据', historyAvailable: true, historyStart: history[0].date, historyEnd: latest.date, availableRanges: availableRanges(history), history, change: prior ? latest.value - prior.value : null, seriesType: data.seriesType, adjustmentStatus: data.adjustmentStatus, currency: data.currency, limitations: data.limitations || [], isDemo: false, isStale: Boolean(this.etfPrice.lastError), lastSuccessAt: data.fetchedAt };
  }
  async loadNaaim() { const data = await this.naaim.read(); if (!data) return this.unavailable(NAAIM_METRIC_ID); const history = data.values.map(point => ({ date: point.date, value: Number(point.value) })); const d = data.derived || {}; const status = this.naaim.getStatus(); return { id: NAAIM_METRIC_ID, metricId: NAAIM_METRIC_ID, displayName: data.label, label: data.label, value: d.latestValue, unit: '敞口指数点', asOf: d.sourceDataDate, sourceDataDate: d.sourceDataDate, fetchedAt: status.lastDownloadedAt || null, updatedAt: data.importedAt, provider: 'NAAIM', source: SOURCE_LABELS[NAAIM_METRIC_ID], sourceLabel: SOURCE_LABELS[NAAIM_METRIC_ID], sourceUrl: 'https://naaim.org/programs/naaim-exposure-index/', frequency: 'weekly', status: this.naaim.lastError ? 'stale' : 'fresh', statusMessage: '官方周频工作簿自动检查，保留人工导入', historyAvailable: true, historyStart: data.firstDate, historyEnd: data.lastDate, availableRanges: ['6M', '1Y', '3Y', '5Y', '10Y', 'ALL'], history, change: d.weekOverWeekChange, fourWeekAverage: d.fourWeekAverage, oneYearPercentile: d.oneYearPercentile, allHistoryPercentile: d.allHistoryPercentile, oneYearLow: d.oneYearLow, oneYearHigh: d.oneYearHigh, allHistoryLow: d.allHistoryLow, allHistoryHigh: d.allHistoryHigh, importedAt: data.importedAt, rowCount: data.rowCount, excludedConflictDateCount: data.validation?.excludedConflictDates?.length || 0, limitations: data.limitations || [], isDemo: false, isStale: Boolean(this.naaim.lastError), lastSuccessAt: status.lastSuccessAt || data.importedAt, lastAttemptAt: status.lastAttemptAt || null, nextScheduledAt: null, updateResult: status.result || null, accessState: status.accessState || 'public_official_workbook' }; }
  async reloadLocalSignals() {
    const imports = await this.importStore.load();
    const priceImport = imports.prices;
    const data = priceImport.data;
    const records = data?.records || [];
    const qqq = records.filter(record => record.ticker === 'QQQ');
    const soxx = records.filter(record => record.ticker === 'SOXX');
    this.localSignalModels.clear();
    this.localImportStatus = {
      status: priceImport.status, sourceFile: priceImport.sourceFile || null, source: data?.manifest?.sourceName || null,
      asOf: qqq.at(-1)?.date || null, error: priceImport.error || null, qualityFlags: [...(data?.qualityWarnings || [])],
      gapCount: data?.gapCount || 0, observationCount: qqq.length, supportedTickers: [...new Set(records.map(record => record.ticker))]
    };
    if (priceImport.status !== 'fresh' || qqq.length < 2) return this.localSignalModels;
    try {
      const calculatedAt = this.now().toISOString();
      const calculated = calculateMarketSignals(qqq, soxx, { rules: this.signalRules }).technical;
      const rv = qqq.length >= 21 ? calculateRealizedVolatility(qqq, { validStatus: 'fresh', calculatedAt: this.now() }) : null;
      const rvHistory = qqq.length >= 21 ? rollingRealizedVolatility(qqq, 20) : [];
      const percentile = rvHistory.length ? calculateVolatilityPercentiles(rvHistory, { validStatus: 'fresh' }) : { value: null, status: 'insufficient_coverage', horizons: {} };
      const percentileHistory = rvHistory.map((point, index) => ({ date: point.date, value: calculateVolatilityPercentiles(rvHistory.slice(0, index + 1), { validStatus: 'fresh' }).value })).filter(point => point.value !== null);
      const quality = {
        ...calculated.quality,
        qualityFlags: [...new Set([...(calculated.quality.qualityFlags || []), ...(data?.qualityWarnings || [])])],
        sourceFile: priceImport.sourceFile || null, priceBasis: data?.priceBasis || 'adjusted_close'
      };
      const entry = id => this.catalog.find(item => item.id === id) || { id, displayName: id, formulaVersion: calculated.algorithmVersion, limitations: [] };
      const add = (id, value, history, context = {}) => this.localSignalModels.set(id, localModel(entry(id), value, history, { ...context, source: data.manifest.sourceName, asOf: calculated.asOf, calculatedAt, quality }));
      add('qqq-vs-ma200', calculated.histories['qqq-vs-ma200'].at(-1)?.value ?? null, calculated.histories['qqq-vs-ma200'], { unit: '%', algorithmVersion: 'RISK-SIGNAL-MAPPINGS-v1-LINEAR' });
      add('qqq-momentum-20', calculated.histories['qqq-momentum-20'].at(-1)?.value ?? null, calculated.histories['qqq-momentum-20'], { unit: '%', algorithmVersion: 'RETURN-DRAWDOWN-v1-TRADING-DAY' });
      add('qqq-momentum-120', calculated.histories['qqq-momentum-120'].at(-1)?.value ?? null, calculated.histories['qqq-momentum-120'], { unit: '%', algorithmVersion: 'RETURN-DRAWDOWN-v1-TRADING-DAY' });
      add('qqq-52w-high-distance', calculated.histories['qqq-52w-high-distance'].at(-1)?.value ?? null, calculated.histories['qqq-52w-high-distance'], { unit: '%', algorithmVersion: 'RETURN-DRAWDOWN-v1-TRADING-DAY' });
      add('qqq-52w-max-drawdown', calculated.drawdown.maximum52Week, calculated.histories['qqq-52w-max-drawdown'], { unit: '%', algorithmVersion: 'RETURN-DRAWDOWN-v1-TRADING-DAY' });
      add('soxx-relative-qqq', calculated.relativeStrength.value, calculated.histories['soxx-relative-qqq'], { unit: '%', algorithmVersion: 'RISK-SIGNAL-MAPPINGS-v1-LINEAR', statusMessage: soxx.length < 2 ? 'SOXX local OHLCV is unavailable.' : undefined });
      if (rv) add('qqq-rv20', rv.value, rvHistory, { unit: '%', algorithmVersion: rv.algorithmVersion });
      if (rv) add('qqq-rv20-percentile', percentile.value, percentileHistory, { unit: '%ile', algorithmVersion: percentile.algorithmVersion, details: percentile.horizons });
      for (const period of [5, 20, 60, 200]) add(`qqq-ema-${period}`, calculated.ema[period].at(-1)?.value ?? null, calculated.ema[period], { unit: '', algorithmVersion: 'EMA-v1-SMOOTHED-INITIAL-SMA' });
      add('qqq-rsi', calculated.rsi.value, calculated.rsi.history, { unit: '', algorithmVersion: 'RSI-v1-WILDER', details: { period: calculated.rsi.period, thresholdStatus: 'provisional' } });
      add('qqq-macd', calculated.macd.value, calculated.macd.history.filter(point => point.macd !== null).map(point => ({ date: point.date, value: point.macd })), { unit: '', algorithmVersion: 'MACD-v1-EMA-12-26-9', details: calculated.macd });
      add('qqq-macd-histogram', calculated.macd.histogram.current, calculated.histories['qqq-macd-histogram'], { unit: '', algorithmVersion: 'MACD-v1-EMA-12-26-9', details: calculated.macd.histogram });
      add('qqq-volume-relative', calculated.volume.current?.relativeMean ?? null, calculated.histories['qqq-volume-relative'], { unit: 'x', algorithmVersion: 'VOLUME-RELATIVE-v1-20D-MEAN-MEDIAN-PERCENTILE', details: calculated.volume.current });
      add('qqq-return-25', calculated.returns.value, calculated.histories['qqq-return-25'], { unit: '%', algorithmVersion: 'RETURN-DRAWDOWN-v1-TRADING-DAY' });
      add('qqq-current-drawdown', calculated.drawdown.current, calculated.histories['qqq-current-drawdown'], { unit: '%', algorithmVersion: 'RETURN-DRAWDOWN-v1-TRADING-DAY' });
      add('follow-through-day', calculated.followThroughDay.value, calculated.followThroughDay.history, { unit: 'state', algorithmVersion: calculated.followThroughDay.algorithmVersion, signalState: calculated.followThroughDay.status, details: calculated.followThroughDay, evidence: calculated.followThroughDay.invalidationReason || `rally attempt ${calculated.followThroughDay.rallyAttemptDate || 'unavailable'}`, trigger: `gain >= ${calculated.rules.followThroughDay.minimumGainPercent}% and volume confirmation` });
      for (const id of ['top-risk-rsi', 'top-risk-volume', 'top-risk-macd', 'bottom-candidate-rsi', 'bottom-candidate-volume']) {
        const signal = calculated.signals[id];
        add(id, signal.value, [], { unit: 'state', algorithmVersion: 'SIGNALS-v1-PROVISIONAL-THRESHOLDS', signalState: signal.signalState, triggered: signal.triggered, evidence: signal.evidence, trigger: signal.trigger, status: signal.value === null ? 'insufficient_coverage' : undefined });
      }
    } catch (error) {
      this.localImportStatus = { ...this.localImportStatus, status: 'error', error: { type: 'derived_calculation_failed', message: error.message } };
    }
    return this.localSignalModels;
  }
  getLocalSignalModel(id) { return LOCAL_SIGNAL_IDS.includes(id) ? (this.localSignalModels.get(id) || localUnavailable(this.catalog.find(item => item.id === id), this.localImportStatus.error ? 'Local OHLCV import or derivation failed.' : 'Local OHLCV CSV is not available.', this.now())) : null; }
  existingSignalReference(reference) {
    const entry = this.catalog.find(item => item.id === reference.id);
    const model = this.models.get(reference.id);
    if (!entry || !model || !VALUE_STATUSES.has(model.status) || !Number.isFinite(Number(model.value))) return null;
    const referenceUrls = Array.isArray(entry.referenceUrls) && entry.referenceUrls.length ? entry.referenceUrls : model.sourceUrl ? [model.sourceUrl] : [];
    return {
      id: model.id, metricId: model.id, displayName: model.displayName || entry.displayName, label: model.label || model.displayName || entry.displayName,
      value: Number(model.value), unit: model.unit || '', asOf: model.asOf || null, sourceDataDate: model.sourceDataDate || model.asOf || null,
      provider: model.provider || entry.provider, source: model.source || entry.source, sourceLabel: model.sourceLabel || model.source || entry.source,
      sourceUrl: model.sourceUrl || referenceUrls[0] || null, referenceUrls, frequency: model.frequency || entry.frequency, status: model.status,
      statusMessage: model.statusMessage || '复用现有内部市场数据模型；未新增采集。', historyAvailable: false, historyStart: null, historyEnd: null,
      availableRanges: [], history: [], qualityStatus: model.qualityStatus || (model.qualityFlags?.length ? 'quality_warning' : 'ok'),
      qualityFlags: model.qualityFlags || [], dataQuality: model.dataQuality || null, isDemo: false, isStale: Boolean(model.isStale),
      displayMode: 'existing_reference', referenceGroup: reference.group, trigger: '现有内部指标摘要；不重复采集', evidence: model.statusMessage || '现有内部 API 状态'
    };
  }
  externalReference(entry) {
    const referenceUrls = Array.isArray(entry.referenceUrls) ? entry.referenceUrls.filter(url => /^https:\/\//.test(url)) : [];
    if (entry.implementationStatus !== 'external_blocked' || entry.displayStatus !== 'link_only' || referenceUrls.length === 0) return null;
    return {
      id: entry.id, metricId: entry.id, displayName: entry.displayName, label: entry.displayName, value: null, unit: '', asOf: null,
      sourceDataDate: null, provider: entry.provider, source: entry.source, sourceLabel: entry.source, sourceUrl: referenceUrls[0], referenceUrls,
      frequency: entry.frequency, status: 'external_reference_only', statusMessage: '仅保留公开来源链接；未抓取、未缓存、未展示指标数值。',
      historyAvailable: false, historyStart: null, historyEnd: null, availableRanges: [], history: [], qualityStatus: 'unavailable', qualityFlags: [],
      isDemo: false, isStale: false, displayMode: 'external_reference', referenceGroup: entry.uiGroup,
      trigger: '不抓取、不缓存、不伪造数值', evidence: entry.blockingReason || '来源与许可尚未批准。', limitations: entry.limitations || [], dataNeeds: entry.dataNeeds || []
    };
  }
  getSignals() {
    const entries = this.catalog.filter(item => LOCAL_SIGNAL_IDS.includes(item.id) && item.displayStatus === 'visible_when_local_ohlcv_available');
    const localIndicators = entries.map(entry => this.getLocalSignalModel(entry.id)).filter(model => model && model.value !== null && VALUE_STATUSES.has(model.status));
    const existingIndicators = EXISTING_SIGNAL_REFERENCES.map(reference => this.existingSignalReference(reference)).filter(Boolean);
    const references = this.catalog.map(entry => this.externalReference(entry)).filter(Boolean);
    const indicators = [...existingIndicators, ...localIndicators];
    const items = [...indicators, ...references];
    const groups = Object.fromEntries(SIGNAL_GROUPS.map(group => [group, items.filter(item => item.referenceGroup === group || this.catalog.find(entry => entry.id === item.id)?.uiGroup === group)]));
    const message = localIndicators.length
      ? 'Existing internal metrics are summarized alongside values derived from local normalized OHLCV input.'
      : existingIndicators.length
        ? 'Existing internal metrics are summarized; local OHLCV-derived signals remain unavailable and no zero or demo value is used.'
        : 'No reliable internal or local OHLCV-derived signal is available; no zero or demo value is used.';
    return { mode: 'internal-and-local', status: indicators.length ? 'ready' : this.localImportStatus.status, available: indicators.length > 0, indicators, references, groups, input: this.localImportStatus, message };
  }
  async reload() { for (const id of PRODUCTION_METRIC_IDS) this.models.set(id, id.endsWith('_pe') ? await this.loadPe(id) : await this.loadFred(id)); this.models.set(SOXX_METRIC_ID, await this.loadSoxx()); this.models.set(NAAIM_METRIC_ID, await this.loadNaaim()); await this.reloadLocalSignals(); return this.models; }
  async refresh(id) { if (LOCAL_SIGNAL_IDS.includes(id)) { await this.reloadLocalSignals(); return { ok: true, reason: 'local_reload', externalRequestCount: 0, indicator: this.getLocalSignalModel(id) }; } const result = id === SOXX_METRIC_ID ? await this.etfPrice.refresh() : id === NAAIM_METRIC_ID ? await this.naaim.refresh() : id.endsWith('_pe') ? await this.worldperatio.refresh(id) : await this.fred.refresh(id); await this.reload(); return { ...result, indicator: this.models.get(id) }; }
  async updateNaaimOfficial(options) { const result = await this.naaimUpdater.update(options); await this.naaim.reload(); await this.reload(); return result; }
  async refreshAll() { const results = {}; for (const id of PRODUCTION_METRIC_IDS) results[id] = await this.refresh(id); return results; }
  providerStatus(id) { return id === 'fred' ? this.fred.getStatus() : id === 'worldperatio' ? this.worldperatio.getStatus() : id === 'ishares-soxx' ? this.etfPrice.getStatus() : id === 'naaim' ? this.naaim.getStatus() : id === 'local-csv' ? this.localImportStatus : null; }
}

module.exports = { ANALYSIS_METRIC_IDS, EXISTING_SIGNAL_REFERENCES, LOCAL_SIGNAL_IDS, PRODUCTION_METRIC_IDS, ProductionDataCoordinator, SIGNAL_GROUPS, SOURCE_LABELS, localModel, localUnavailable };
