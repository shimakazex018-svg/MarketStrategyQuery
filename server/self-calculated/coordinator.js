'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { SecCompanyFactsBulkSource } = require('../data-sources/sec-companyfacts-bulk');
const { CftcTffSource, DEFAULT_CONTRACT } = require('../data-sources/cftc-tff');
const { calculateCotPositioning } = require('../derived-indicators/cot-positioning');
const { calculateMarketSignals } = require('../derived-indicators/market-signals');
const { calculateQqqPe } = require('../derived-indicators/qqq-pe');
const { calculateRealizedVolatility, rollingRealizedVolatility } = require('../derived-indicators/realized-volatility');
const { calculateRiskAppetite, COMPONENTS } = require('../derived-indicators/risk-appetite');
const { buildQuarterlyTtm, selectFactSeries } = require('../derived-indicators/sec-facts');
const { calculateVolatilityPercentiles } = require('../derived-indicators/volatility-percentile');
const { RuntimeImportStore, atomicJson } = require('../imports/runtime-import-store');
const { manualForwardPeState } = require('../imports/manual-input-import');
const { availableRanges, validateModel } = require('../market-data/schema');

function unavailableModel(definition, statusMessage, now) {
  return {
    id: definition.id,
    displayName: definition.name,
    value: null,
    unit: definition.unit || '',
    asOf: null,
    source: '本地自计算数据层',
    sourceUrl: null,
    sourceType: 'self-calculated',
    frequency: 'input-dependent',
    status: 'unavailable',
    statusMessage,
    updatedAt: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextAllowedAt: null,
    isDemo: false,
    isStale: false,
    availableRanges: [],
    historyStart: null,
    history: [],
    qualityFlags: [],
    servedAt: now.toISOString()
  };
}

function appendHistory(history, point) {
  const byDate = new Map((Array.isArray(history) ? history : []).map(item => [item.date, item]));
  if (point?.date && Number.isFinite(Number(point.value))) byDate.set(point.date, { date: point.date, value: Number(point.value) });
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function newestByTicker(records) {
  const result = new Map();
  for (const record of records || []) {
    const current = result.get(record.ticker);
    if (!current || record.date > current.date) result.set(record.ticker, record);
  }
  return result;
}

function seriesByTicker(records, ticker) {
  return (records || []).filter(record => record.ticker === ticker).map(record => ({ date: record.date, adjustedClose: record.adjustedClose }));
}

function latestFact(series, asOf) {
  return (series?.facts || [])
    .filter(fact => Number.isFinite(Number(fact.value)) && (!asOf || fact.end <= asOf))
    .sort((left, right) => String(left.end).localeCompare(String(right.end)))
    .at(-1) || null;
}

function factsForCompany(payload) {
  const epsSeries = selectFactSeries(payload, 'dilutedEps');
  const epsTtm = buildQuarterlyTtm(epsSeries.facts);
  const incomeSeries = selectFactSeries(payload, 'netIncome');
  const incomeTtm = buildQuarterlyTtm(incomeSeries.facts);
  const sharesSeries = selectFactSeries(payload, 'dilutedShares');
  const shares = latestFact(sharesSeries, epsTtm.end);
  return {
    ttmEps: epsTtm.value,
    ttmNetIncome: incomeTtm.value,
    dilutedShares: shares?.value ?? null,
    financialAsOf: epsTtm.end || null,
    dilutedSharesAsOf: shares?.end || null,
    mapping: { eps: epsSeries.mapping, income: incomeSeries.mapping, shares: sharesSeries.mapping },
    status: epsTtm.status
  };
}

class SelfCalculatedCoordinator {
  constructor({ rootDir, runtimeRoot = path.join(rootDir, 'runtime-data'), config, cacheStore, definitions, fetchImpl = global.fetch, now = () => new Date() }) {
    this.rootDir = rootDir;
    this.config = config;
    this.cacheStore = cacheStore;
    this.definitions = definitions;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.runtimeRoot = runtimeRoot;
    this.importStore = new RuntimeImportStore(this.runtimeRoot);
    this.secSource = new SecCompanyFactsBulkSource({
      runtimeDir: this.runtimeRoot,
      fetchImpl,
      requestTimeoutMs: config.sec?.requestTimeoutMs,
      maxBytes: config.sec?.maxBytes,
      app: config.sec?.userAgentApp,
      email: config.sec?.userAgentEmail
    });
    this.cftcSource = new CftcTffSource({ runtimeDir: this.runtimeRoot, fetchImpl, requestTimeoutMs: config.requestTimeoutMs, contractCode: DEFAULT_CONTRACT });
    this.models = new Map();
    this.imports = null;
  }

  definition(id) { return this.definitions.find(item => item.id === id); }

  async init() {
    this.imports = await this.importStore.load();
    await this.deriveAll();
    return this;
  }

  async readCompanyFacts(ticker) {
    const filePath = path.join(this.runtimeRoot, 'normalized', 'sec-companyfacts', `${ticker}.json`);
    return fs.readFile(filePath, 'utf8').then(JSON.parse, () => null);
  }

  async previousModel(id) {
    const cached = await this.cacheStore.readIndicator(id);
    return cached.data || null;
  }

  async persist(model) {
    const validated = validateModel(model);
    this.models.set(validated.id, validated);
    await Promise.all([
      this.cacheStore.writeIndicator(validated.id, validated),
      atomicJson(path.join(this.runtimeRoot, 'derived', `${validated.id}.json`), validated)
    ]);
    return validated;
  }

  async derivePe() {
    const definition = this.definition('pe');
    const holdings = this.imports.holdings.data;
    const prices = this.imports.prices.data;
    if (!holdings || !prices) return unavailableModel(definition, '需要本地QQQ持仓CSV和成分股价格CSV', this.now());
    const priceByTicker = newestByTicker(prices.records);
    let lowConfidenceWeight = 0;
    const components = [];
    for (const holding of holdings.records) {
      const companyFacts = await this.readCompanyFacts(holding.ticker);
      const financial = companyFacts ? factsForCompany(companyFacts) : null;
      if (financial?.mapping?.eps?.confidence === 'low') lowConfidenceWeight += holding.weight;
      const price = priceByTicker.get(holding.ticker);
      components.push({
        ticker: holding.ticker,
        weight: holding.weight,
        weightAsOf: holding.asOf,
        price: price?.adjustedClose ?? null,
        priceAsOf: price?.date || null,
        priceCurrency: price?.currency || 'USD',
        ttmEps: financial?.ttmEps ?? null,
        ttmNetIncome: financial?.ttmNetIncome ?? null,
        dilutedShares: financial?.dilutedShares ?? null,
        dilutedSharesAsOf: financial?.dilutedSharesAsOf ?? null,
        financialAsOf: financial?.financialAsOf ?? null,
        financialCurrency: 'USD',
        financialMapping: financial?.mapping || null
      });
    }
    const externalFlags = [];
    if (lowConfidenceWeight > 0.2) externalFlags.push('low_confidence_financial_mapping_weight_high');
    if (!holdings.weightTotalValid) externalFlags.push('holdings_weight_total_warning');
    const result = calculateQqqPe(components, {
      statusPolicy: 'mvp', requireExplicitDates: true, dataNature: 'user_input_and_sec_official',
      calculatedAt: this.now(), qualityFlags: externalFlags
    });
    const previous = await this.previousModel('pe');
    const formalOutput = result.status !== 'insufficient_coverage';
    const history = appendHistory(previous?.history, formalOutput ? { date: result.dataDate, value: result.rawPE } : null);
    const robustHistory = appendHistory(previous?.robustHistory, formalOutput ? { date: result.dataDate, value: result.robustPE } : null);
    const value = result.status === 'insufficient_coverage' ? null : result.rawPE;
    return {
      id: 'pe', displayName: definition.name, value, secondaryValue: result.robustPE, unit: 'x',
      asOf: value === null ? history.at(-1)?.date || null : result.dataDate,
      source: '用户本地QQQ输入 + SEC EDGAR companyfacts', sourceUrl: 'https://www.sec.gov/edgar/sec-api-documentation',
      sourceType: 'self-calculated-official-and-local', frequency: 'daily-when-inputs-change',
      status: result.status, qualityStatus: result.qualityStatus, statusMessage: result.statusMessage || (value === null ? '覆盖不足或分母不稳定，未输出正式PE' : '自计算组合估值'),
      updatedAt: result.calculatedAt, lastAttemptAt: null, lastSuccessAt: value === null ? null : result.calculatedAt,
      nextAllowedAt: null, isDemo: false, isStale: false,
      availableRanges: availableRanges(history), historyStart: history[0]?.date || null, history, robustHistory,
      rawPE: result.rawPE, robustPE: result.robustPE, rawRobustDifference: result.rawRobustDifference,
      financialCoverageWeight: result.financialCoverageWeight, priceCoverageWeight: result.priceCoverageWeight,
      weightAsOf: result.weightAsOf, priceAsOf: result.dataDates.priceAsOf,
      financialAsOf: result.dataDates.financialAsOfEnd, calculatedAt: result.calculatedAt,
      latestEvaluationDate: result.dataDate,
      validComponentCount: result.validComponentCount, componentCount: result.componentCount,
      missingConstituentCount: result.missingConstituentCount, missingTickers: result.missingTickers,
      outlierCount: result.outlierCount, outlierWeight: result.outlierWeight,
      affectedConstituents: result.affectedConstituents, lossMakingCount: result.lossMakingCount,
      lossMakingWeight: result.lossMakingWeight, algorithmRaw: result.algorithmRaw,
      algorithmRobust: result.algorithmRobust, qualityFlags: result.qualityFlags,
      denominatorStability: result.denominatorStability,
      marketCapAggregateDiagnosticPE: result.methods.aggregateMarketCapToEarnings.includingLosses.value,
      excludeLossDiagnosticPE: result.excludeLossDiagnosticPE
    };
  }

  async deriveForwardPe() {
    const definition = this.definition('forward-pe');
    const records = this.imports.forwardPe.data?.records;
    if (!records?.length) return unavailableModel(definition, '尚未导入Forward PE人工记录', this.now());
    const latest = [...records].sort((left, right) => left.asOf.localeCompare(right.asOf) || left.enteredAt.localeCompare(right.enteredAt)).at(-1);
    const state = manualForwardPeState(latest, { now: this.now() });
    return {
      id: 'forward-pe', displayName: definition.name, value: state.value, unit: 'x', asOf: state.asOf,
      source: state.sourceName, sourceUrl: null, sourceReference: state.sourceReference,
      sourceType: 'manual-local-input', frequency: 'manual', status: 'manual',
      statusMessage: state.stale ? '人工录入数据已过期' : '人工录入', updatedAt: state.enteredAt,
      lastAttemptAt: null, lastSuccessAt: state.enteredAt, nextAllowedAt: null,
      isDemo: false, isStale: state.stale, stale: state.stale, ageDays: state.ageDays,
      methodology: state.methodology, notes: state.notes, availableRanges: [], historyStart: null, history: [], qualityFlags: state.stale ? ['manual_input_stale'] : []
    };
  }

  async deriveVolatility() {
    const prices = this.imports.prices.data?.records || [];
    const qqq = seriesByTicker(prices, 'QQQ');
    if (qqq.length < 21) return { rv: unavailableModel(this.definition('qqq-rv20'), '需要至少21个QQQ复权收盘价', this.now()), percentile: unavailableModel(this.definition('qqq-rv20-percentile'), '需要QQQ历史复权价格', this.now()), qqq, rvHistory: [] };
    const rv = calculateRealizedVolatility(qqq, { validStatus: 'fresh', calculatedAt: this.now() });
    const rvHistory = rollingRealizedVolatility(qqq, 20);
    const percentile = calculateVolatilityPercentiles(rvHistory, { validStatus: 'fresh' });
    return {
      qqq, rvHistory,
      rv: {
        id: 'qqq-rv20', displayName: this.definition('qqq-rv20').name, value: rv.value, unit: '%', asOf: rv.inputEnd,
        source: this.imports.prices.data.manifest.sourceName, sourceUrl: null, sourceType: 'self-calculated-local', frequency: 'daily-input',
        status: rv.status, statusMessage: '基于QQQ复权收盘价的20日年化实现波动率', updatedAt: rv.calculatedAt,
        lastAttemptAt: null, lastSuccessAt: rv.calculatedAt, nextAllowedAt: null, isDemo: false, isStale: false,
        availableRanges: availableRanges(rvHistory), historyStart: rvHistory[0]?.date || null, history: rvHistory,
        values: rv.values, observationCount: rv.observationCount, algorithmVersion: rv.algorithmVersion, qualityFlags: rv.gapCount ? ['price_series_has_large_calendar_gaps'] : []
      },
      percentile: {
        id: 'qqq-rv20-percentile', displayName: this.definition('qqq-rv20-percentile').name, value: percentile.value, unit: '%ile', asOf: percentile.asOf,
        source: this.imports.prices.data.manifest.sourceName, sourceUrl: null, sourceType: 'self-calculated-local', frequency: 'daily-input',
        status: percentile.status, statusMessage: percentile.value === null ? '历史样本不足' : '基于实际可用RV20历史的分位', updatedAt: rv.calculatedAt,
        lastAttemptAt: null, lastSuccessAt: percentile.value === null ? null : rv.calculatedAt, nextAllowedAt: null,
        isDemo: false, isStale: false, availableRanges: availableRanges(rvHistory), historyStart: rvHistory[0]?.date || null,
        history: rvHistory, horizons: percentile.horizons, currentRv20: percentile.currentRv20,
        algorithmVersion: percentile.algorithmVersion, qualityFlags: []
      }
    };
  }

  async deriveCot() {
    const definition = this.definition('nasdaq-cot-positioning');
    const filePath = path.join(this.runtimeRoot, 'sources', 'cftc', `${DEFAULT_CONTRACT}.json`);
    const cached = await fs.readFile(filePath, 'utf8').then(JSON.parse, () => null);
    if (!cached?.rows?.length) return unavailableModel(definition, 'CFTC官方TFF数据尚未下载', this.now());
    const result = calculateCotPositioning(cached.rows, { contractCode: DEFAULT_CONTRACT });
    return {
      id: definition.id, displayName: definition.name, value: result.value, unit: result.unit, asOf: result.reportDate,
      source: 'CFTC TFF Futures Only', sourceUrl: cached.sourceUrl, sourceType: 'official-public-data', frequency: 'weekly',
      status: result.status, statusMessage: result.disclaimer, updatedAt: cached.retrievedAt,
      publishedAt: result.publishedAt, lastAttemptAt: cached.retrievedAt, lastSuccessAt: cached.retrievedAt,
      nextAllowedAt: null, isDemo: false, isStale: false, availableRanges: availableRanges(result.history),
      historyStart: result.history[0]?.date || null, history: result.history, qualityFlags: result.publishedAt ? [] : ['publication_time_unavailable'],
      ...result
    };
  }

  async deriveRiskAppetite(volatility, cot) {
    const definition = this.definition('risk-appetite');
    const prices = this.imports.prices.data?.records || [];
    const qqq = volatility.qqq;
    if (qqq.length < 2) return unavailableModel(definition, '需要QQQ历史价格以计算风险偏好分项', this.now());
    const soxx = seriesByTicker(prices, 'SOXX');
    const signals = calculateMarketSignals(qqq, soxx);
    const inputs = [];
    for (const [id, score] of Object.entries(signals.scores)) if (score !== null) inputs.push({ id, score, asOf: signals.asOf });
    const rvPercentile = volatility.percentile.value;
    if (Number.isFinite(rvPercentile)) inputs.push({ id: 'rv20-percentile', score: rvPercentile, asOf: volatility.percentile.asOf });
    const cotPercentile = cot.horizons?.['1Y']?.percentile;
    if (Number.isFinite(cotPercentile)) inputs.push({ id: 'nasdaq-cot-positioning', score: cotPercentile, asOf: cot.asOf });
    const result = calculateRiskAppetite(inputs, { validStatus: inputs.length === COMPONENTS.length ? 'fresh' : 'provisional' });
    return {
      id: definition.id, displayName: definition.name, value: result.value, unit: '/100', asOf: result.inputDate || signals.asOf,
      source: '本地价格派生 + CFTC仓位代理', sourceUrl: null, sourceType: 'self-calculated', frequency: 'input-dependent',
      status: result.status, statusMessage: result.status === 'provisional' ? '部分分项缺失，仅在可用分项间重新等权' : result.status === 'fresh' ? '七项分项全部可用' : '少于5项可用，未输出综合分数',
      updatedAt: this.now().toISOString(), lastAttemptAt: null, lastSuccessAt: result.value === null ? null : this.now().toISOString(),
      nextAllowedAt: null, isDemo: false, isStale: false, availableRanges: [], historyStart: null, history: [],
      algorithmVersion: result.algorithmVersion, coverageRatio: result.coverageRatio, availableCount: result.availableCount,
      totalCount: result.totalCount, missingComponents: result.missingComponents, components: result.components,
      signalMetrics: signals.metrics, signalMappingVersion: signals.algorithmVersion, qualityFlags: result.dateMismatch ? ['component_date_mismatch'] : []
    };
  }

  async deriveAll() {
    const pe = await this.derivePe();
    const forwardPe = await this.deriveForwardPe();
    const volatility = await this.deriveVolatility();
    const cot = await this.deriveCot();
    const risk = await this.deriveRiskAppetite(volatility, cot);
    const models = [pe, forwardPe, volatility.rv, volatility.percentile, risk, cot];
    for (const model of models) await this.persist(model);
    return models;
  }

  async reloadLocalInputs() {
    this.imports = await this.importStore.load();
    return this.deriveAll();
  }

  async refresh(id) {
    if (id === 'pe') {
      if (!this.config.sec?.bulkUpdateEnabled) return { ok: false, statusCode: 409, reason: this.secSource.configured() ? 'sec_bulk_update_disabled' : 'sec_user_agent_missing' };
      const tickers = this.imports.holdings.data?.records?.map(item => item.ticker) || [];
      const sourceResult = await this.secSource.fetchForTickers(tickers, { now: this.now() });
      await this.deriveAll();
      return { ok: ['fresh', 'unchanged'].includes(sourceResult.status), sourceResult };
    }
    if (id === 'nasdaq-cot-positioning') {
      const sourceResult = await this.cftcSource.fetch({ now: this.now() });
      await this.deriveAll();
      return { ok: true, sourceResult };
    }
    await this.reloadLocalInputs();
    return { ok: true, localReload: true };
  }
}

module.exports = { SelfCalculatedCoordinator, appendHistory, factsForCompany, newestByTicker, seriesByTicker, unavailableModel };
