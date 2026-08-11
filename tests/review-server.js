'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHttpServer } = require('../server');
const { createPortfolioService } = require('../server/portfolio');
const { loadPortfolioConfig } = require('../server/portfolio/config');
const { writePasswordFile } = require('../server/portfolio/auth');

const rootDir = path.join(__dirname, '..');
const port = Number(process.env.PORT || 48215);
const allowedStates = new Set(['loading', 'fresh', 'provisional', 'quality_warning', 'insufficient_coverage', 'stale', 'error', 'unavailable', 'manual']);
const reviewState = allowedStates.has(process.env.REVIEW_STATE) ? process.env.REVIEW_STATE : 'fresh';
const reviewSoxxAvailable = process.env.REVIEW_SOXX !== 'unavailable';
const definitions = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'data', 'indicators.json'), 'utf8'));
const indicatorCatalog = JSON.parse(fs.readFileSync(path.join(rootDir, 'config', 'indicator-catalog.json'), 'utf8')).entries;

function history(base, amplitude = 3) {
  const points = [];
  const end = new Date('2026-07-13T00:00:00Z');
  for (let index = 0; index < 96; index += 1) {
    const date = new Date(end.valueOf() - (95 - index) * 5 * 86_400_000);
    const value = base + Math.sin(index / 6) * amplitude + Math.cos(index / 13) * amplitude * 0.45;
    points.push({ date: date.toISOString().slice(0, 10), value: Number(value.toFixed(2)) });
  }
  return points;
}

function longHistory(base, amplitude = 20) {
  const points = [];
  const end = new Date('2026-07-13T00:00:00Z');
  for (let index = 0; index < 1800; index += 1) {
    const date = new Date(end.valueOf() - (1799 - index) * 5 * 86_400_000);
    const trend = index * 0.08;
    const value = base + trend + Math.sin(index / 37) * amplitude + Math.cos(index / 83) * amplitude * 0.5;
    points.push({ date: date.toISOString().slice(0, 10), value: Number(Math.max(1, value).toFixed(2)) });
  }
  return points;
}

function baseModel(definition, overrides = {}) {
  return {
    id: definition.id,
    displayName: definition.name,
    value: null,
    unit: definition.unit || '',
    asOf: null,
    source: 'UI验收合成夹具（非真实行情）',
    sourceUrl: null,
    sourceType: 'test-fixture',
    frequency: 'fixture',
    status: 'unavailable',
    statusMessage: definition.unavailableMessage,
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
    ...overrides
  };
}

function peModel(definition) {
  const valueState = ['fresh', 'provisional', 'quality_warning', 'stale'].includes(reviewState);
  const status = reviewState === 'quality_warning' ? 'provisional' : reviewState === 'manual' ? 'fresh' : reviewState;
  const rawHistory = valueState ? history(27.4, 2.5) : [];
  const robustHistory = valueState ? history(26.7, 1.7) : [];
  const financialCoverageWeight = reviewState === 'fresh' ? 0.946 : reviewState === 'quality_warning' ? 0.824 : 0.782;
  const priceCoverageWeight = reviewState === 'fresh' ? 0.982 : reviewState === 'quality_warning' ? 0.873 : 0.846;
  return baseModel(definition, {
    value: valueState ? 28.31 : null,
    secondaryValue: valueState ? 27.42 : null,
    rawPE: valueState ? 28.31 : null,
    robustPE: valueState ? 27.42 : null,
    rawRobustDifference: valueState ? 0.89 : null,
    asOf: valueState ? '2026-07-13' : null,
    status,
    qualityStatus: reviewState === 'quality_warning' ? 'quality_warning' : 'ok',
    statusMessage: status === 'fresh' ? '覆盖率和日期门槛满足，可显示正式自计算结果。'
      : status === 'provisional' ? '初步估算，部分成分数据缺失或日期并非完全一致。'
        : status === 'insufficient_coverage' ? '财务或价格覆盖不足，未输出正式PE。'
          : status === 'loading' ? '正在读取本地输入和运行缓存。'
            : status === 'stale' ? '更新失败，保留最后一次成功结果。'
              : status === 'error' ? '数据处理失败，且没有可用缓存。' : '本地输入尚不完整。',
    updatedAt: valueState ? '2026-07-14T00:10:00.000Z' : null,
    lastSuccessAt: valueState ? '2026-07-14T00:10:00.000Z' : null,
    isStale: status === 'stale',
    availableRanges: valueState ? ['1M', '3M', '6M', '1Y'] : [],
    historyStart: rawHistory[0]?.date || null,
    history: rawHistory,
    robustHistory,
    financialCoverageWeight,
    priceCoverageWeight,
    weightAsOf: '2026-07-10',
    priceAsOf: '2026-07-13',
    financialAsOf: '2026-06-30',
    calculatedAt: valueState ? '2026-07-14T00:10:00.000Z' : null,
    validComponentCount: valueState ? 92 : 61,
    componentCount: 101,
    missingConstituentCount: valueState ? 9 : 40,
    outlierCount: valueState ? 3 : null,
    outlierWeight: valueState ? 0.046 : null,
    affectedConstituents: valueState ? [{ ticker: 'SYN-A', reason: 'positive E/P above upper bound' }, { ticker: 'SYN-B', reason: 'negative E/P below lower bound' }] : [],
    lossMakingCount: valueState ? 7 : null,
    lossMakingWeight: valueState ? 0.052 : null,
    denominatorStability: valueState ? 'stable_positive' : 'not_available',
    algorithmRaw: 'PE-Q1-RAW-v1',
    algorithmRobust: 'PE-Q1-ROBUST-WMAD4-v1',
    qualityFlags: reviewState === 'quality_warning' ? ['outlier_weight_above_10_percent', 'weight_price_date_gap_warning'] : []
  });
}

function modelFor(definition) {
  if (['nasdaq100_pe', 'sp500_pe'].includes(definition.id)) {
    const points = history(definition.id === 'nasdaq100_pe' ? 28 : 24, 2);
    return baseModel(definition, { value: points.at(-1).value, asOf: points.at(-1).date, status: 'fresh', source: 'UI验收合成夹具（非真实行情）', updatedAt: '2026-07-14T00:10:00Z', lastSuccessAt: '2026-07-14T00:10:00Z', historyStart: points[0].date, history: points, historicalStatistics: { '1y': { average: 25, standardDeviation: 2 } } });
  }
  if (['vix', 'vxn', 'nasdaq100_index', 'sp500_index'].includes(definition.id)) {
    const settings = { vix: [18, 5], vxn: [22, 6], nasdaq100_index: [8000, 900], sp500_index: [3200, 350] }[definition.id];
    const points = definition.id.endsWith('_index') ? longHistory(...settings) : history(...settings);
    return baseModel(definition, { value: points.at(-1).value, asOf: points.at(-1).date, status: 'fresh', source: 'UI验收合成夹具（非真实行情）', updatedAt: '2026-07-14T00:10:00Z', lastSuccessAt: '2026-07-14T00:10:00Z', historyStart: points[0].date, history: points, availableRanges: ['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y'] });
  }
  if (definition.id === 'pe') return peModel(definition);
  if (definition.id === 'forward-pe') return baseModel(definition, {
    value: 24.8, asOf: '2026-07-11', status: 'manual', statusMessage: '用户本地人工录入，口径为Forward 12 Months。',
    source: '用户核验的本地记录（UI验收夹具）', updatedAt: '2026-07-11T12:00:00Z', lastSuccessAt: '2026-07-11T12:00:00Z'
  });
  const settings = {
    'qqq-rv20': [18.42, '%', 3.2],
    'qqq-rv20-percentile': [61.3, '%ile', 16],
    'risk-appetite': [67.8, '/100', 11],
    'nasdaq-cot-positioning': [14.7, '% OI', 7]
  }[definition.id];
  const points = history(settings[0], settings[2]);
  const isPartialRiskAppetite = definition.id === 'risk-appetite' && reviewState === 'provisional';
  return baseModel(definition, {
    value: settings[0], unit: settings[1], asOf: '2026-07-13', status: isPartialRiskAppetite ? 'provisional' : 'fresh',
    statusMessage: isPartialRiskAppetite
      ? 'UI验收合成夹具：七项信号中五项可用，缺失分项已明确列出，非真实市场数据。'
      : 'UI验收合成夹具，不代表真实市场数据。',
    updatedAt: '2026-07-14T00:10:00Z', lastSuccessAt: '2026-07-14T00:10:00Z',
    availableRanges: ['1M', '3M', '6M', '1Y'], historyStart: points[0].date, history: points,
    ...(isPartialRiskAppetite ? {
      coverageRatio: 5 / 7,
      availableCount: 5,
      totalCount: 7,
      missingComponents: ['soxx-relative-strength', 'nasdaq-cot-positioning'],
      qualityFlags: ['partial_component_coverage']
    } : {})
  });
}

function soxxModel() {
  const points = longHistory(90, 25);
  return {
    id: 'soxx_price', metricId: 'soxx_price', displayName: 'SOXX半导体ETF', value: points.at(-1).value,
    unit: 'usd', asOf: points.at(-1).date, source: 'UI验收合成夹具（非真实行情）', sourceLabel: 'iShares / BlackRock',
    provider: 'iShares / BlackRock', status: 'fresh', seriesType: 'nav', adjustmentStatus: 'provider_adjusted',
    limitations: ['合成NAV夹具，仅用于视觉验收'], historyStart: points[0].date, historyEnd: points.at(-1).date,
    history: points, isDemo: false, isStale: false
  };
}

function naaimModel() {
  const history = Array.from({ length: 28 }, (_, index) => ({ date: `2026-${String(Math.floor(index / 4) + 1).padStart(2, '0')}-${String((index % 4) * 7 + 1).padStart(2, '0')}`, value: Number((48 + index * 0.55 + Math.sin(index / 3) * 4).toFixed(2)) }));
  return {
    id: 'naaim_exposure', metricId: 'naaim_exposure', displayName: 'NAAIM Exposure Index', value: history.at(-1).value,
    unit: '%', asOf: history.at(-1).date, source: 'UI验收合成夹具（非真实行情）', status: 'fresh', statusMessage: '合成本地导入夹具，不代表真实NAAIM数据。',
    historyStart: history[0].date, historyEnd: history.at(-1).date, history, dataMode: 'synthetic-fixture'
  };
}

const existingSignalGroups = Object.freeze({
  nasdaq100_pe: 'valuation', sp500_pe: 'valuation', nasdaq100_index: 'trend_momentum', sp500_index: 'trend_momentum',
  vix: 'fear_positioning', vxn: 'fear_positioning', naaim_exposure: 'fear_positioning', soxx_price: 'semiconductor'
});

function existingSignalFixtureModels() {
  return Object.entries(existingSignalGroups).map(([id, group]) => {
    const entry = indicatorCatalog.find(item => item.id === id);
    const definition = definitions.find(item => item.id === id) || { id, name: entry?.displayName || id, unit: entry?.unit || '' };
    const model = id === 'naaim_exposure' ? naaimModel() : id === 'soxx_price' ? soxxModel() : modelFor(definition);
    const referenceUrls = entry?.referenceUrls || [];
    return {
      ...model, id, metricId: id, displayName: entry?.displayName || model.displayName, source: 'synthetic-review-fixture', sourceLabel: 'synthetic-review-fixture', provider: 'synthetic-review-fixture',
      sourceUrl: referenceUrls[0] || null, referenceUrls, history: [], historyAvailable: false, historyStart: null, historyEnd: null,
      displayMode: 'existing_reference', referenceGroup: group,
      statusMessage: 'synthetic-review-fixture existing internal summary; no new collection.',
      trigger: 'synthetic-review-fixture existing internal summary', evidence: 'synthetic-review-fixture; existing internal model reused', isDemo: false, isStale: false
    };
  });
}

function externalReferenceFixtureModels() {
  return indicatorCatalog.filter(entry => entry.implementationStatus === 'external_blocked' && entry.displayStatus === 'link_only' && Array.isArray(entry.referenceUrls) && entry.referenceUrls.length > 0).map(entry => ({
    id: entry.id, metricId: entry.id, displayName: entry.displayName, label: entry.displayName, value: null, unit: '', asOf: null,
    source: 'synthetic-review-fixture', sourceLabel: 'synthetic-review-fixture', provider: 'synthetic-review-fixture', sourceUrl: entry.referenceUrls[0], referenceUrls: entry.referenceUrls,
    status: 'external_reference_only', statusMessage: 'synthetic-review-fixture source-only entry; no fetch, cache, or value.', history: [], historyAvailable: false,
    qualityStatus: 'unavailable', qualityFlags: [], displayMode: 'external_reference', referenceGroup: entry.uiGroup,
    trigger: 'synthetic-review-fixture; do not fetch', evidence: entry.blockingReason || 'Source link only; no approved data acquisition.', dataNeeds: entry.dataNeeds || [], limitations: entry.limitations || [], isDemo: false, isStale: false
  }));
}

function signalFixtureModels() {
  const definitionsById = new Map(indicatorCatalog.map(entry => [entry.id, entry]));
  const fixtureValues = {
    'qqq-vs-ma200': [4.8, '%'], 'qqq-momentum-20': [3.4, '%'], 'qqq-momentum-120': [11.2, '%'], 'qqq-52w-high-distance': [-1.8, '%'],
    'qqq-52w-max-drawdown': [14.6, '%'], 'soxx-relative-qqq': [2.1, '%'], 'qqq-rv20': [19.3, '%'], 'qqq-rv20-percentile': [63.2, '%ile'],
    'qqq-ema-5': [501.4, ''], 'qqq-ema-20': [497.8, ''], 'qqq-ema-60': [486.1, ''], 'qqq-ema-200': [455.6, ''], 'qqq-rsi': [67.4, ''],
    'qqq-macd': [4.2, ''], 'qqq-macd-histogram': [0.72, ''], 'qqq-volume-relative': [1.38, 'x'], 'qqq-return-25': [3.1, '%'], 'qqq-current-drawdown': [-1.8, '%']
  };
  const models = Object.entries(fixtureValues).map(([id, [value, unit]], index) => {
    const entry = definitionsById.get(id) || { id, displayName: id, limitations: [] };
    const points = history(value, Math.max(.3, Math.abs(value) * .08));
    return { id, metricId: id, displayName: entry.displayName, value, unit, asOf: points.at(-1).date, source: 'synthetic-review-fixture', sourceLabel: 'synthetic-review-fixture', provider: 'synthetic-review-fixture', status: 'fresh', statusMessage: 'Synthetic review fixture; not real market data.', historyStart: points[0].date, history: points, historyAvailable: true, qualityStatus: 'ok', qualityFlags: [], signalState: null, direction: value >= 0 ? 'positive' : 'negative', trigger: 'synthetic-review-fixture rule', evidence: 'synthetic-review-fixture evidence', limitations: entry.limitations || [], formulaVersion: entry.formulaVersion || null, isDemo: false, isStale: false, requestedRange: '1Y', servedAt: new Date().toISOString(), fixtureIndex: index };
  });
  const state = { id: 'follow-through-day', metricId: 'follow-through-day', displayName: definitionsById.get('follow-through-day')?.displayName || 'Follow-Through Day status', value: 1, unit: 'state', asOf: '2026-07-13', source: 'synthetic-review-fixture', sourceLabel: 'synthetic-review-fixture', provider: 'synthetic-review-fixture', status: 'fresh', statusMessage: 'Synthetic review fixture; not real market data.', history: [{ date: '2026-07-13', value: 1 }], historyStart: '2026-07-13', historyAvailable: true, signalState: 'confirmed', trigger: 'synthetic-review-fixture rule', evidence: 'synthetic-review-fixture rally attempt and volume confirmation', limitations: ['Synthetic review fixture only.'], isDemo: false, isStale: false };
  const topBottom = ['top-risk-rsi', 'top-risk-volume', 'top-risk-macd', 'bottom-candidate-rsi', 'bottom-candidate-volume'].map((id, index) => ({ id, metricId: id, displayName: definitionsById.get(id)?.displayName || id, value: index === 1 ? 1 : 0, unit: 'state', asOf: '2026-07-13', source: 'synthetic-review-fixture', sourceLabel: 'synthetic-review-fixture', provider: 'synthetic-review-fixture', status: 'fresh', statusMessage: 'Synthetic review fixture; not real market data.', history: [], historyAvailable: false, signalState: index === 1 ? 'triggered' : 'clear', trigger: 'synthetic-review-fixture provisional threshold', evidence: 'synthetic-review-fixture evidence', limitations: ['Synthetic review fixture only.'], isDemo: false, isStale: false }));
  return [...models, state, ...topBottom];
}

function models(range = '1Y') {
  return definitions.map(definition => ({ ...modelFor(definition), requestedRange: range, servedAt: new Date().toISOString() }));
}

const service = {
  getIndicators: range => models(range),
  getIndicator: (id, range) => id === 'naaim_exposure' ? naaimModel() : id === 'soxx_price' ? (reviewSoxxAvailable ? soxxModel() : null) : models(range).find(model => model.id === id) || signalFixtureModels().find(model => model.id === id) || null,
  getIndicatorHistory: (id, range) => {
    if (id === 'naaim_exposure') { const model = naaimModel(); return { metricId: id, range, history: model.history, historyStart: model.historyStart, historyEnd: model.historyEnd, status: model.status, provider: 'synthetic-fixture', sourceLabel: model.source, limitations: ['合成夹具，仅用于视觉验收'] }; }
    const model = id === 'soxx_price' ? (reviewSoxxAvailable ? soxxModel() : null) : models(range).find(item => item.id === id) || signalFixtureModels().find(item => item.id === id);
    return model ? { metricId: id, range, history: model.history, historyStart: model.historyStart, historyEnd: model.historyEnd || model.history.at(-1)?.date || null, status: model.status, provider: model.provider || null, sourceLabel: model.sourceLabel || model.source, seriesType: model.seriesType || null, adjustmentStatus: model.adjustmentStatus || null, limitations: model.limitations || [] } : null;
  },
  getIndicatorCatalog: () => indicatorCatalog,
  getSignals: () => {
    const indicators = [...existingSignalFixtureModels(), ...signalFixtureModels()];
    const references = externalReferenceFixtureModels();
    const items = [...indicators, ...references];
    const groups = Object.fromEntries(['valuation', 'trend_momentum', 'fear_positioning', 'macro_credit', 'semiconductor'].map(group => [group, items.filter(model => model.referenceGroup === group || indicatorCatalog.find(entry => entry.id === model.id)?.uiGroup === group)]));
    return { mode: 'synthetic-review-fixture', status: 'ready', available: true, indicators, references, groups, input: { status: 'fresh', source: 'synthetic-review-fixture', asOf: '2026-07-13', qualityFlags: [] }, message: 'synthetic-review-fixture; no real market data.' };
  },
  getStatus: () => ({ enabled: false, timezone: 'Asia/Shanghai', reviewFixture: true, indicators: models().map(({ id, status }) => ({ id, status })), servedAt: new Date().toISOString() }),
  getDataAcquisitionStatus: async () => ({
    summary: { enabledProviderCount: 0, enabledDatasetCount: 0, schedulerStatus: 'review-fixture', dailyNetworkDatasetCount: 0, localImportDatasetCount: 0, realtimeProviderCount: 0 },
    providers: [], datasets: [], recentRuns: [],
    scheduler: { enabled: false, timezone: 'Asia/Shanghai', time: '07:30', startupCatchupEnabled: false, running: false, lastCycleResult: 'review-fixture' },
    realtime: { enabled: false, message: 'UI验收合成夹具（非真实行情）；未启用实时数据。' },
    storage: { message: 'UI验收合成夹具不读取正式运行缓存。', runtimeDataIgnored: true, gitTracksRealMarketData: false, rawHtmlStored: false, credentialsUsed: false }
  }),
  getProviderDiagnosticStatus: id => id === 'worldperatio' ? {
    providerId: id, enabled: true, status: 'fresh', complianceStatus: 'approved_with_conditions', attemptsToday: 1
  } : null,
  getProviderLatest: id => id === 'worldperatio' ? {
    providerId: id, status: 'fresh', sourceUrl: 'https://worldperatio.com/index/nasdaq-100/', sourceDataDate: '2099-01-15',
    currentPE: 42.42, valuationLabel: 'Fair', fetchedAt: '2099-01-16T01:00:00.000Z'
  } : null,
  getProviderHistory: id => id === 'worldperatio' ? {
    providerId: id, status: 'fresh', seriesAvailability: 'summary_statistics_only', publishedSeries: [],
    snapshots: [{ sourceDataDate: '2099-01-15', currentPE: 42.42, fetchedAt: '2099-01-16T01:00:00.000Z', parseVersion: 'WPR-PARSE-v1' }]
  } : null,
  getProviderStatistics: id => id === 'worldperatio' ? {
    providerId: id, status: 'fresh', sourceUrl: 'https://worldperatio.com/index/nasdaq-100/', sourceDataDate: '2099-01-15',
    currentPE: 42.42, valuationLabel: 'Fair', deviationFromMean: null, seriesAvailability: 'summary_statistics_only',
    fetchedAt: '2099-01-16T01:00:00.000Z', historicalStats: {
      '1y': { mean: 40.1, stdDev: 2.2 }, '5y': { mean: 31.11, stdDev: 3.33 },
      '10y': { mean: 28.22, stdDev: 4.44 }, '20y': { mean: 23.33, stdDev: 5.55 }
    }
  } : null,
  refresh: async () => ({ ok: false, statusCode: 409, reason: 'review-fixture-read-only' })
};

async function startReviewServer({ port: requestedPort = port, authPassword = null } = {}) {
  let temporaryRuntimeRoot = null;
  let config;
  if (authPassword) {
    temporaryRuntimeRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'market-cycle-review-'));
    const baseConfig = loadPortfolioConfig(rootDir);
    config = {
      ...baseConfig,
      runtimeRoot: temporaryRuntimeRoot,
      databasePath: path.join(temporaryRuntimeRoot, 'portfolio.sqlite'),
      passwordPath: path.join(temporaryRuntimeRoot, 'portfolio-password.json')
    };
    await writePasswordFile(config.passwordPath, authPassword);
  }
  const portfolioService = await createPortfolioService(rootDir, { config, fixtureMode: 'synthetic-review-fixture' });
  if (authPassword) portfolioService.auth.fixtureMode = false;
  const server = createHttpServer(service, null, portfolioService, null);
  server.on('close', () => {
    void portfolioService.close().finally(async () => {
      if (temporaryRuntimeRoot) await fsPromises.rm(temporaryRuntimeRoot, { recursive: true, force: true });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port, portfolioService };
}

if (require.main === module) {
  startReviewServer().then(({ port: listeningPort }) => {
    console.log(`Review fixture (${reviewState}) running on http://127.0.0.1:${listeningPort}`);
  }).catch(error => { console.error(`Review fixture failed: ${error.message}`); process.exitCode = 1; });
}

module.exports = { startReviewServer };
