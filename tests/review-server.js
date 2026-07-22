'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHttpServer } = require('../server');

const rootDir = path.join(__dirname, '..');
const port = Number(process.env.PORT || 48215);
const allowedStates = new Set(['loading', 'fresh', 'provisional', 'quality_warning', 'insufficient_coverage', 'stale', 'error', 'unavailable', 'manual']);
const reviewState = allowedStates.has(process.env.REVIEW_STATE) ? process.env.REVIEW_STATE : 'fresh';
const reviewSoxxAvailable = process.env.REVIEW_SOXX !== 'unavailable';
const definitions = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'data', 'indicators.json'), 'utf8'));

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

function models(range = '1Y') {
  return definitions.map(definition => ({ ...modelFor(definition), requestedRange: range, servedAt: new Date().toISOString() }));
}

const service = {
  getIndicators: range => models(range),
  getIndicator: (id, range) => id === 'soxx_price' ? (reviewSoxxAvailable ? soxxModel() : null) : models(range).find(model => model.id === id) || null,
  getIndicatorHistory: (id, range) => {
    const model = id === 'soxx_price' ? (reviewSoxxAvailable ? soxxModel() : null) : models(range).find(item => item.id === id);
    return model ? { metricId: id, range, history: model.history, historyStart: model.historyStart, historyEnd: model.historyEnd || model.history.at(-1)?.date || null, status: model.status, provider: model.provider || null, sourceLabel: model.sourceLabel || model.source, seriesType: model.seriesType || null, adjustmentStatus: model.adjustmentStatus || null, limitations: model.limitations || [] } : null;
  },
  getStatus: () => ({ enabled: false, timezone: 'Asia/Shanghai', reviewFixture: true, indicators: models().map(({ id, status }) => ({ id, status })), servedAt: new Date().toISOString() }),
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

const server = createHttpServer(service);
server.listen(port, '127.0.0.1', () => console.log(`Review fixture (${reviewState}) running on http://127.0.0.1:${port}`));
