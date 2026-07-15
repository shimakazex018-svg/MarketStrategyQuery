'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  calculateRealizedVolatility,
  rollingRealizedVolatility
} = require('../server/derived-indicators/realized-volatility');
const { calculateVolatilityPercentiles } = require('../server/derived-indicators/volatility-percentile');
const { COMPONENTS, calculateRiskAppetite } = require('../server/derived-indicators/risk-appetite');
const { CANDIDATE_CONTRACTS, calculateCotPositioning } = require('../server/derived-indicators/cot-positioning');
const { runDerivedCalculations } = require('../server/derived-indicators/runner');
const { validateModel } = require('../server/market-data/schema');

function syntheticPrices(count, start = '2023-01-02') {
  const date = new Date(`${start}T00:00:00Z`);
  let price = 300;
  const points = [];
  while (points.length < count) {
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) {
      const index = points.length;
      price *= Math.exp(0.0004 + Math.sin(index / 7) * 0.006 + Math.cos(index / 19) * 0.003);
      points.push({ date: date.toISOString().slice(0, 10), adjustedClose: Number(price.toFixed(6)) });
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return points;
}

test('realized volatility calculates RV10/RV20/RV60 from adjusted close log returns', () => {
  const result = calculateRealizedVolatility(syntheticPrices(80), { calculatedAt: '2026-01-01T00:00:00Z' });
  assert.equal(result.status, 'demo');
  assert.ok(result.values.rv10 > 0);
  assert.ok(result.values.rv20 > 0);
  assert.ok(result.values.rv60 > 0);
  assert.equal(result.value, result.values.rv20);
  assert.equal(result.priceBasis, 'adjusted_close');
  assert.equal(result.missingDatePolicy, 'use_observed_trading_days_without_imputation');
});

test('realized volatility rejects date disorder and reports insufficient samples without imputation', () => {
  assert.equal(calculateRealizedVolatility(syntheticPrices(20)).status, 'insufficient_coverage');
  const disorder = syntheticPrices(25);
  [disorder[2], disorder[3]] = [disorder[3], disorder[2]];
  assert.throws(() => calculateRealizedVolatility(disorder), /strictly ascending/);
  const gap = syntheticPrices(30);
  gap.splice(10, 5);
  assert.ok(calculateRealizedVolatility(gap).gapCount >= 1);
});

test('RV20 percentile reports actual available horizons and never invents longer history', () => {
  const rvHistory = rollingRealizedVolatility(syntheticPrices(600), 20);
  const result = calculateVolatilityPercentiles(rvHistory);
  assert.equal(result.status, 'demo');
  assert.ok(result.value >= 0 && result.value <= 100);
  assert.equal(result.horizons['1Y'].fullHorizonAvailable, true);
  assert.equal(result.horizons['3Y'].fullHorizonAvailable, false);
  assert.equal(result.horizons['10Y'].fullHorizonAvailable, false);
  assert.equal(result.horizons['10Y'].actualStart, rvHistory[0].date);
  assert.equal(calculateVolatilityPercentiles(rvHistory.slice(0, 10)).status, 'insufficient_coverage');
});

test('risk appetite equal-weight model adjusts risk-off direction and exposes contributions', () => {
  const scores = [80, 70, 60, 20, 30, 75, 65];
  const inputs = COMPONENTS.map((component, index) => ({ id: component.id, score: scores[index], asOf: '2026-01-02' }));
  const result = calculateRiskAppetite(inputs);
  assert.equal(result.status, 'demo');
  assert.ok(Math.abs(result.value - 71.4285714286) < 1e-8);
  assert.equal(result.components.find(component => component.id === 'qqq-max-drawdown').adjustedScore, 80);
  assert.ok(Math.abs(result.components.reduce((sum, component) => sum + component.weight, 0) - 1) < 1e-12);
  assert.equal(result.algorithmVersion, 'RISK-APPETITE-v1-EW');
});

test('risk appetite excludes missing inputs, rejects out-of-range scores and gates low coverage', () => {
  const five = COMPONENTS.slice(0, 5).map(component => ({ id: component.id, score: 50, asOf: '2026-01-02' }));
  assert.equal(calculateRiskAppetite(five).status, 'demo');
  assert.equal(calculateRiskAppetite(five.slice(0, 4)).status, 'insufficient_coverage');
  assert.throws(() => calculateRiskAppetite([{ id: COMPONENTS[0].id, score: 101 }]), /between 0 and 100/);
});

test('CFTC positioning selects 209742 and calculates net ratios with historical percentiles', () => {
  assert.deepEqual(CANDIDATE_CONTRACTS.map(contract => contract.contractCode), ['209742', '209747']);
  assert.equal(CANDIDATE_CONTRACTS[0].selectionStatus, 'selected_primary');
  assert.equal(calculateCotPositioning([], { contractCode: '209742' }).reason, 'target_contract_missing');
  const rows = Array.from({ length: 60 }, (_, index) => ({
    contractCode: '209742',
    reportDate: new Date(Date.UTC(2025, 0, 7 + index * 7)).toISOString().slice(0, 10),
    publishedAt: '2026-01-09T20:30:00.000Z',
    assetManagerLong: 100 + index, assetManagerShort: 40,
    leveragedFundsLong: 20, leveragedFundsShort: 70, openInterest: 500
  }));
  const result = calculateCotPositioning(rows, { contractCode: '209742' });
  assert.equal(result.status, 'fresh');
  assert.equal(result.assetManagerNet, 119);
  assert.equal(result.leveragedFundsNet, -50);
  assert.ok(Math.abs(result.value - 23.8) < 1e-10);
  assert.equal(result.defaultMetric, 'asset_manager_net_ratio');
  assert.equal(result.history.length, 60);
  assert.equal(result.horizons['1Y'].percentile, 100);
});

test('derived calculation runner isolates one indicator failure from others', () => {
  const result = runDerivedCalculations({
    good: () => ({ status: 'demo', value: 1 }),
    bad: () => { throw new Error('fixture failure'); },
    alsoGood: () => ({ status: 'manual', value: 2 })
  });
  assert.equal(result.good.value, 1);
  assert.equal(result.bad.status, 'error');
  assert.equal(result.alsoGood.value, 2);
});

test('unified schema accepts manual and insufficient coverage without using zero placeholders', () => {
  assert.equal(validateModel({ id: 'forward-pe', status: 'manual', value: 20, asOf: null, history: [] }).status, 'manual');
  assert.equal(validateModel({ id: 'qqq-pe', status: 'insufficient_coverage', value: null, asOf: null, history: [] }).value, null);
});
