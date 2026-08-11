'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { importPricesCsv } = require('../server/imports/prices-import');
const { localUnavailable } = require('../server/production-data/coordinator');
const {
  calculateTechnicalIndicators,
  followThroughDay,
  normalizeOhlcvSeries,
  seriesDiagnostics
} = require('../server/derived-indicators/technical-indicators');

function dateFor(index) {
  return new Date(Date.UTC(2025, 0, 2 + index)).toISOString().slice(0, 10);
}

function rows(count = 260, transform = () => {}) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.15 + Math.sin(index / 7) * 2;
    const row = { ticker: 'QQQ', date: dateFor(index), open: close - .4, high: close + 1, low: close - 1, close, adjustedClose: close, volume: 1_000 + (index % 9) * 25 };
    return transform(row, index) || row;
  });
}

function withClose(row, close) {
  return { ...row, open: close - .4, high: close + 1, low: close - 1, close, adjustedClose: close };
}

test('technical fixture calculates EMA, configurable RSI, MACD, relative volume, returns and drawdown', () => {
  const result = calculateTechnicalIndicators(rows());
  assert.equal(result.rsi.period, 14);
  assert.ok(result.ema[5].length > 0);
  assert.ok(result.ema[20].length > 0);
  assert.ok(result.ema[60].length > 0);
  assert.ok(result.ema[200].length > 0);
  assert.ok(Number.isFinite(result.rsi.value));
  assert.ok(Number.isFinite(result.macd.histogram.current));
  assert.ok(Number.isFinite(result.volume.current.relativeMean));
  assert.ok(Number.isFinite(result.volume.current.relativeMedian));
  assert.ok(Number.isFinite(result.volume.current.percentile));
  assert.ok(Number.isFinite(result.returns.value));
  assert.ok(Number.isFinite(result.drawdown.current));
  assert.ok(Number.isFinite(result.drawdown.maximum52Week));
  assert.equal(result.inputAlgorithmVersion, 'OHLCV-LOCAL-CSV-v1');
});

test('RSI thresholds and volume thresholds are explicit provisional signals', () => {
  const overbought = calculateTechnicalIndicators(rows(40, (row, index) => withClose(row, 100 + index * 3)));
  assert.equal(overbought.signals['top-risk-rsi'].signalState, 'triggered');
  assert.equal(overbought.signals['top-risk-rsi'].triggered, true);
  const oversold = calculateTechnicalIndicators(rows(40, (row, index) => withClose(row, 200 - index * 2)));
  assert.equal(oversold.signals['bottom-candidate-rsi'].signalState, 'triggered');
  const volumeBoundary = calculateTechnicalIndicators(rows(22, (row, index) => ({ ...row, volume: index === 21 ? 2_000 : 1_000 })));
  assert.equal(volumeBoundary.volume.current.relativeMean, 2);
  assert.equal(volumeBoundary.signals['top-risk-volume'].signalState, 'triggered');
  assert.equal(volumeBoundary.rules.volume.anomalyMultiplier, 2);
  assert.equal(volumeBoundary.rules.rsi.overbought, 90);
  assert.equal(volumeBoundary.rules.rsi.oversold, 22);
});

test('MACD histogram exposes current value, shrink streak and positive duration comparison', () => {
  const result = calculateTechnicalIndicators(rows(180, (row, index) => {
    const close = 100 + index * .5 + Math.sin(index / 9) * 3;
    return withClose(row, close);
  }));
  const histogram = result.macd.histogram;
  assert.ok(Object.hasOwn(histogram, 'current'));
  assert.ok(Object.hasOwn(histogram, 'shrinkingStreak'));
  assert.ok(Object.hasOwn(histogram, 'positiveDuration'));
  assert.ok(Object.hasOwn(histogram, 'previousPositiveDuration'));
  assert.ok(Object.hasOwn(histogram, 'durationChange'));
  assert.ok(Object.hasOwn(result.signals['top-risk-macd'], 'evidence'));
});

test('Follow-Through Day keeps rally attempt, Day 1 low, candidate window and invalidation evidence', () => {
  const fixture = rows(18, (row, index) => {
    const close = index <= 10 ? 110 - index : 100 + (index - 10) * 1;
    return { ...row, close, adjustedClose: close, open: close - .3, high: close + .8, low: close - .8, volume: index === 14 ? 1_400 : 1_000 };
  });
  const result = followThroughDay(fixture, { rallyLowLookback: 10, candidateStartTradingDay: 4, candidateEndTradingDay: 7, minimumGainPercent: .5, volumeMultiplier: 1.1 });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.rallyAttemptDate, fixture[10].date);
  assert.equal(result.day1Low, 100);
  assert.equal(result.confirmedDate, fixture[14].date);
  assert.equal(result.volumeConfirmed, true);
  assert.ok(result.candidateWindow.start);
});

test('OHLCV validation rejects duplicate dates, missing volume and invalid price bounds while reporting gaps', () => {
  const valid = rows(3);
  assert.throws(() => normalizeOhlcvSeries([valid[0], valid[0]]), /strictly ascending/);
  assert.throws(() => normalizeOhlcvSeries([{ ...valid[0], volume: null }]), /missing a finite/);
  assert.throws(() => normalizeOhlcvSeries([{ ...valid[0], low: valid[0].high + 1 }]), /high\/low price bounds/);
  const gap = normalizeOhlcvSeries([{ ...valid[0], date: '2025-01-02' }, { ...valid[1], date: '2025-01-20' }]);
  assert.equal(seriesDiagnostics(gap).gapCount, 1);
  const csv = ['ticker,date,open,high,low,close,adjustedClose,volume,sourceName,asOf', 'QQQ,2025-01-02,100,101,99,100,100,,SYNTHETIC,2025-01-02'].join('\n');
  assert.throws(() => importPricesCsv(csv), /missing finite OHLCV field/);
});

test('sample-insufficient and unavailable states never become zero placeholders', () => {
  const result = calculateTechnicalIndicators(rows(3));
  assert.equal(result.ema[5].length, 0);
  assert.equal(result.rsi.value, null);
  assert.equal(result.macd.histogram.current, null);
  assert.equal(localUnavailable({ id: 'qqq-rsi', displayName: 'QQQ RSI' }).value, null);
  assert.equal(localUnavailable({ id: 'qqq-rsi', displayName: 'QQQ RSI' }).status, 'unavailable');
});
