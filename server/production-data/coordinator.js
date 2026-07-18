'use strict';

const path = require('path');
const { FredProvider, FRED_SERIES } = require('../data-sources/fred-provider');
const { PE_TARGETS, WorldPERatioProductionProvider } = require('../data-sources/worldperatio-production');
const { availableRanges } = require('../market-data/schema');

const PRODUCTION_METRIC_IDS = Object.freeze(['nasdaq100_pe', 'sp500_pe', 'vix', 'vxn', 'nasdaq100_index', 'sp500_index']);
const SOURCE_LABELS = Object.freeze({ nasdaq100_pe: 'WorldPEratio · QQQ-based reference', sp500_pe: 'WorldPEratio · SPY-based reference', vix: 'FRED / Cboe', vxn: 'FRED / Cboe', nasdaq100_index: 'FRED', sp500_index: 'FRED' });

class ProductionDataCoordinator {
  constructor({ rootDir, definitions, fetchImpl = global.fetch, now = () => new Date(), timezone = 'Asia/Shanghai' }) {
    this.rootDir = rootDir; this.productionRoot = path.join(rootDir, 'runtime-data', 'market-data', 'production'); this.definitions = definitions; this.now = now;
    this.fred = new FredProvider({ productionRoot: this.productionRoot, fetchImpl, now, timezone });
    this.worldperatio = new WorldPERatioProductionProvider({ productionRoot: this.productionRoot, fetchImpl, now, timezone });
    this.models = new Map();
  }
  async init() { await Promise.all([this.fred.init(), this.worldperatio.init()]); await this.reload(); return this; }
  definition(id) { return this.definitions.find(item => item.id === id) || { id, name: id, unit: '' }; }
  unavailable(id) { const definition = this.definition(id); return { id, metricId: id, displayName: definition.name, label: definition.name, value: null, unit: definition.unit || '', asOf: null, sourceDataDate: null, fetchedAt: null, provider: id.endsWith('_pe') ? 'WorldPEratio' : 'FRED', source: SOURCE_LABELS[id], sourceLabel: SOURCE_LABELS[id], sourceUrl: null, frequency: 'daily', status: 'unavailable', statusMessage: '该指标当前没有可用的正式运行数据', historyAvailable: false, historyStart: null, historyEnd: null, availableRanges: [], history: [], limitations: [], isDemo: false, isStale: false };
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
  async reload() { for (const id of PRODUCTION_METRIC_IDS) this.models.set(id, id.endsWith('_pe') ? await this.loadPe(id) : await this.loadFred(id)); return this.models; }
  async refresh(id) { const result = id.endsWith('_pe') ? await this.worldperatio.refresh(id) : await this.fred.refresh(id); await this.reload(); return { ...result, indicator: this.models.get(id) }; }
  async refreshAll() { const results = {}; for (const id of PRODUCTION_METRIC_IDS) results[id] = await this.refresh(id); return results; }
  providerStatus(id) { return id === 'fred' ? this.fred.getStatus() : id === 'worldperatio' ? this.worldperatio.getStatus() : null; }
}

module.exports = { PRODUCTION_METRIC_IDS, ProductionDataCoordinator, SOURCE_LABELS };
