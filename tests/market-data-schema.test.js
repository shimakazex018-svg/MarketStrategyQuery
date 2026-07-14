'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { availableRanges, filterHistory, normalizeHistory, validateModel } = require('../server/market-data/schema');

function dailyHistory(start, count) {
  const first = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(first.valueOf() + index * 86_400_000).toISOString().slice(0, 10),
    value: 10 + index / 10
  }));
}

test('normalizes history in date order and rejects duplicates or invalid values', () => {
  const normalized = normalizeHistory([
    { date: '2024-01-03', value: 12 },
    { date: '2024-01-02', value: '11.5' }
  ]);
  assert.deepEqual(normalized.map(point => point.date), ['2024-01-02', '2024-01-03']);
  assert.throws(() => normalizeHistory([{ date: '2024-01-02', value: 1 }, { date: '2024-01-02', value: 2 }]), /duplicate/);
  assert.throws(() => normalizeHistory([{ date: '2024-01-02', value: Number.NaN }]), /invalid value/);
  assert.throws(() => normalizeHistory([{ date: 'not-a-date', value: 2 }]), /invalid date/);
});

test('filters ranges and caps chart points without inventing history', () => {
  const history = dailyHistory('2014-01-01', 4_000);
  const oneMonth = filterHistory(history, '1M', history.at(-1).date, 240);
  const tenYears = filterHistory(history, '10Y', history.at(-1).date, 240);
  assert.ok(oneMonth.length >= 30 && oneMonth.length <= 33);
  assert.equal(tenYears.length, 240);
  assert.equal(tenYears.at(-1).date, history.at(-1).date);
  assert.deepEqual(availableRanges(history), ['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y']);
});

test('validates state and latest date consistency', () => {
  const valid = validateModel({ id: 'vix', status: 'fresh', value: 12, asOf: '2024-01-03', history: [
    { date: '2024-01-02', value: 11 }, { date: '2024-01-03', value: 12 }
  ] });
  assert.equal(valid.value, 12);
  assert.throws(() => validateModel({ id: 'vix', status: 'unknown', value: 1, asOf: null, history: [] }), /status/);
  assert.throws(() => validateModel({ id: 'vix', status: 'fresh', value: 1, asOf: '2024-01-02', history: [{ date: '2024-01-03', value: 1 }] }), /latest/);
});
