'use strict';

const path = require('path');
const { EtfPriceProvider, SOXX_METRIC_ID } = require('../data-sources/etf-price-provider');
const { NaaimExposureProvider, NAAIM_METRIC_ID } = require('../data-sources/naaim-exposure-provider');
const { NaaimOfficialUpdater } = require('../data-sources/naaim-official-updater');
const { FredProvider, FRED_SERIES } = require('../data-sources/fred-provider');
const { PE_TARGETS, WorldPERatioProductionProvider } = require('../data-sources/worldperatio-production');
const { availableRanges } = require('../market-data/schema');

const PRODUCTION_METRIC_IDS = Object.freeze(['nasdaq100_pe', 'sp500_pe', 'vix', 'vxn', 'nasdaq100_index', 'sp500_index']);
const ANALYSIS_METRIC_IDS = Object.freeze([SOXX_METRIC_ID, NAAIM_METRIC_ID]);
const SOURCE_LABELS = Object.freeze({ nasdaq100_pe: 'WorldPEratio · QQQ-based reference', sp500_pe: 'WorldPEratio · SPY-based reference', vix: 'FRED / Cboe', vxn: 'FRED / Cboe', nasdaq100_index: 'FRED', sp500_index: 'FRED', soxx_price: 'iShares / BlackRock', naaim_exposure: 'NAAIM 官方Excel本地导入' });

class ProductionDataCoordinator {
  constructor({ rootDir, definitions, fetchImpl = global.fetch, now = () => new Date(), timezone = 'Asia/Shanghai' }) {
    this.rootDir = rootDir; this.productionRoot = path.join(rootDir, 'runtime-data', 'market-data', 'production'); this.definitions = definitions; this.now = now;
    this.fred = new FredProvider({ productionRoot: this.productionRoot, fetchImpl, now, timezone });
    this.worldperatio = new WorldPERatioProductionProvider({ productionRoot: this.productionRoot, fetchImpl, now, timezone });
    this.etfPrice = new EtfPriceProvider({ productionRoot: this.productionRoot, now, timezone });
    this.naaim = new NaaimExposureProvider({ productionRoot: this.productionRoot, now, timezone });
    this.naaimUpdater = new NaaimOfficialUpdater({ rootDir, fetchImpl, now, timezone });
    this.models = new Map();
  }
  async init() { await Promise.all([this.fred.init(), this.worldperatio.init(), this.etfPrice.init(), this.naaim.init()]); await this.reload(); return this; }
  definition(id) { return this.definitions.find(item => item.id === id) || (id === SOXX_METRIC_ID ? { id, name: 'SOXX半导体ETF', unit: 'usd' } : { id, name: id, unit: '' }); }
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
  async reload() { for (const id of PRODUCTION_METRIC_IDS) this.models.set(id, id.endsWith('_pe') ? await this.loadPe(id) : await this.loadFred(id)); this.models.set(SOXX_METRIC_ID, await this.loadSoxx()); this.models.set(NAAIM_METRIC_ID, await this.loadNaaim()); return this.models; }
  async refresh(id) { const result = id === SOXX_METRIC_ID ? await this.etfPrice.refresh() : id === NAAIM_METRIC_ID ? await this.naaim.refresh() : id.endsWith('_pe') ? await this.worldperatio.refresh(id) : await this.fred.refresh(id); await this.reload(); return { ...result, indicator: this.models.get(id) }; }
  async updateNaaimOfficial(options) { const result = await this.naaimUpdater.update(options); await this.naaim.reload(); await this.reload(); return result; }
  async refreshAll() { const results = {}; for (const id of PRODUCTION_METRIC_IDS) results[id] = await this.refresh(id); return results; }
  providerStatus(id) { return id === 'fred' ? this.fred.getStatus() : id === 'worldperatio' ? this.worldperatio.getStatus() : id === 'ishares-soxx' ? this.etfPrice.getStatus() : id === 'naaim' ? this.naaim.getStatus() : null; }
}

module.exports = { ANALYSIS_METRIC_IDS, PRODUCTION_METRIC_IDS, ProductionDataCoordinator, SOURCE_LABELS };
