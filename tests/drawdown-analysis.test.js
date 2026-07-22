'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  alignComparisonSeries,
  calculateAnnualReturns,
  calculateDrawdownDistribution,
  calculateDrawdownSeries,
  calculateDrawdownSummary,
  createDatasetCache,
  detectDrawdownEpisodes,
  filterSeriesByDateRange,
  normalizeSeries
} = require('../public/drawdown-analysis');

function series(values, start = '2098-01-01') {
  const first = new Date(`${start}T00:00:00Z`);
  return values.map((value, index) => ({
    date: new Date(first.valueOf() + index * 86_400_000).toISOString().slice(0, 10),
    value
  }));
}

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `expected ${actual} to be close to ${expected}`);
}

test('monotonic gains keep every drawdown at zero', () => {
  assert.deepEqual(calculateDrawdownSeries(series([10, 11, 12])).map(point => point.drawdown), [0, 0, 0]);
});

test('one complete drawdown reports peak, trough, recovery and trading-day durations', () => {
  const [episode] = detectDrawdownEpisodes(series([100, 90, 80, 95, 100]));
  assertClose(episode.maximumDrawdown, -0.2);
  assert.deepEqual({ ...episode, maximumDrawdown: -0.2 }, {
    peakDate: '2098-01-01', troughDate: '2098-01-03', recoveryDate: '2098-01-05',
    peakValue: 100, troughValue: 80, maximumDrawdown: -0.2,
    declineTradingDays: 2, recoveryTradingDays: 2, totalTradingDays: 4, status: 'recovered'
  });
});

test('ongoing drawdown keeps recovery fields null and reports current duration', () => {
  const [episode] = detectDrawdownEpisodes(series([100, 90, 85]));
  assert.equal(episode.status, 'ongoing');
  assert.equal(episode.recoveryDate, null);
  assert.equal(episode.recoveryTradingDays, null);
  assert.equal(episode.totalTradingDays, 2);
});

test('multiple drawdowns are non-overlapping complete cycles', () => {
  const episodes = detectDrawdownEpisodes(series([100, 90, 100, 95, 80, 105]));
  assert.equal(episodes.length, 2);
  assert.deepEqual(episodes.map(item => [item.peakDate, item.recoveryDate]), [
    ['2098-01-01', '2098-01-03'], ['2098-01-03', '2098-01-06']
  ]);
});

test('summary identifies the rolling peak responsible for the deepest trough', () => {
  const summary = calculateDrawdownSummary(series([100, 110, 99, 77, 100, 111]));
  assertClose(summary.maximumDrawdown, -0.3);
  assert.equal(summary.maximumEpisode.peakDate, '2098-01-02');
  assert.equal(summary.maximumEpisode.troughDate, '2098-01-04');
});

test('summary calculates interval return and current drawdown from the selected interval', () => {
  const summary = calculateDrawdownSummary(series([100, 120, 90]));
  assertClose(summary.intervalReturn, -0.1);
  assert.equal(summary.currentDrawdown, -0.25);
});

test('threshold filtering can use the signed maximum drawdown without duplicates', () => {
  const episodes = detectDrawdownEpisodes(series([100, 94, 100, 80, 100, 70]));
  assert.equal(episodes.filter(item => item.maximumDrawdown <= -0.15).length, 2);
});

test('drawdown distribution counts each episode exactly once and preserves empty buckets', () => {
  const distribution = calculateDrawdownDistribution([
    { maximumDrawdown: -0.05 }, { maximumDrawdown: -0.10 }, { maximumDrawdown: -0.15 },
    { maximumDrawdown: -0.20 }, { maximumDrawdown: -0.30 }, { maximumDrawdown: -0.35 }
  ]);
  assert.deepEqual(distribution.map(bucket => bucket.count), [1, 1, 1, 1, 2]);
});

test('annual returns use first and last valid observation and label current year YTD', () => {
  const result = calculateAnnualReturns([
    { date: '2098-01-02', value: 100 }, { date: '2098-12-31', value: 110 },
    { date: '2099-01-02', value: 200 }, { date: '2099-07-01', value: 180 }
  ], 2099);
  assertClose(result[0].return, 0.1);
  assert.equal(result[0].isYtd, false);
  assertClose(result[1].return, -0.1);
  assert.equal(result[1].label, '2099 YTD');
});

test('a year with one observation has a null return instead of zero', () => {
  assert.equal(calculateAnnualReturns([{ date: '2099-01-02', value: 100 }], 2099)[0].return, null);
});

test('normalization sorts dates and deduplicates identical observations', () => {
  assert.deepEqual(normalizeSeries([
    { date: '2098-01-02', value: 11 }, { date: '2098-01-01', value: 10 }, { date: '2098-01-02', value: 11 }
  ]), [{ date: '2098-01-01', value: 10 }, { date: '2098-01-02', value: 11 }]);
});

test('normalization rejects conflicting duplicate dates', () => {
  assert.throws(() => normalizeSeries([
    { date: '2098-01-01', value: 10 }, { date: '2098-01-01', value: 11 }
  ]), /conflicting values/);
});

test('normalization drops null observations without converting them to zero', () => {
  assert.deepEqual(normalizeSeries([
    { date: '2098-01-01', value: null }, { date: '2098-01-02', value: 10 }
  ]), [{ date: '2098-01-02', value: 10 }]);
});

test('comparison normalization starts both series on their first common date', () => {
  const aligned = alignComparisonSeries(
    [{ date: '2098-01-01', value: 10 }, { date: '2098-01-02', value: 20 }],
    [{ date: '2098-01-02', value: 40 }, { date: '2098-01-03', value: 60 }]
  );
  assert.equal(aligned.startDate, '2098-01-02');
  assert.equal(aligned.primary[0].normalizedValue, 100);
  assert.equal(aligned.comparison[0].normalizedValue, 100);
});

test('date filtering rejects start dates after end dates', () => {
  assert.throws(() => filterSeriesByDateRange(series([1, 2]), '2098-01-02', '2098-01-01'), /must not be after/);
});

test('summary returns null when fewer than two valid points are available', () => {
  assert.equal(calculateDrawdownSummary([{ date: '2098-01-01', value: 10 }]), null);
});

test('dataset cache sends only one request for repeated range calculations', async () => {
  let requests = 0;
  const cache = createDatasetCache(async () => { requests += 1; return series([100, 90, 110]); });
  const first = await cache.load('nasdaq100_index');
  const second = await cache.load('nasdaq100_index');
  filterSeriesByDateRange(first, '2098-01-01', '2098-01-02');
  filterSeriesByDateRange(second, '2098-01-02', '2098-01-03');
  assert.equal(requests, 1);
});
