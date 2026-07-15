'use strict';

const VALID_STATUSES = new Set(['loading', 'fresh', 'stale', 'error', 'demo', 'unavailable', 'insufficient_coverage', 'manual', 'provisional', 'quality_warning']);
const RANGE_DAYS = Object.freeze({ '1M': 31, '3M': 93, '6M': 186, '1Y': 366, '3Y': 1_096, '5Y': 1_827, '10Y': 3_653 });
const RANGE_KEYS = Object.freeze(Object.keys(RANGE_DAYS));

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function normalizeHistory(history, { min = -Infinity, max = Infinity } = {}) {
  if (!Array.isArray(history)) throw new TypeError('history must be an array');
  const byDate = new Map();
  for (const point of history) {
    if (!point || !isIsoDate(point.date)) throw new TypeError('history contains an invalid date');
    const value = Number(point.value);
    if (!Number.isFinite(value) || value < min || value > max) throw new TypeError('history contains an invalid value');
    if (byDate.has(point.date)) throw new TypeError(`history contains duplicate date ${point.date}`);
    byDate.set(point.date, { date: point.date, value });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function sampleHistory(history, maxPoints = 240) {
  if (history.length <= maxPoints) return history;
  const sampled = [];
  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round(index * (history.length - 1) / (maxPoints - 1));
    const point = history[sourceIndex];
    if (sampled.at(-1)?.date !== point.date) sampled.push(point);
  }
  return sampled;
}

function filterHistory(history, rangeKey, endDate, maxPoints = 240) {
  const key = RANGE_DAYS[rangeKey] ? rangeKey : '1Y';
  if (!history.length) return [];
  const end = new Date(`${endDate || history.at(-1).date}T23:59:59Z`);
  const cutoff = new Date(end.valueOf() - RANGE_DAYS[key] * 86_400_000).toISOString().slice(0, 10);
  return sampleHistory(history.filter(point => point.date >= cutoff), maxPoints);
}

function availableRanges(history) {
  if (!history.length) return [];
  const first = new Date(`${history[0].date}T00:00:00Z`).valueOf();
  const last = new Date(`${history.at(-1).date}T00:00:00Z`).valueOf();
  const spanDays = Math.max(0, (last - first) / 86_400_000);
  return RANGE_KEYS.filter(key => spanDays >= RANGE_DAYS[key] * 0.9);
}

function validateModel(model) {
  if (!model || typeof model !== 'object') throw new TypeError('model must be an object');
  if (!/^[a-z0-9-]+$/.test(model.id || '')) throw new TypeError('model.id is invalid');
  if (!VALID_STATUSES.has(model.status)) throw new TypeError('model.status is invalid');
  if (model.value !== null && !Number.isFinite(Number(model.value))) throw new TypeError('model.value is invalid');
  if (model.asOf !== null && !isIsoDate(model.asOf)) throw new TypeError('model.asOf is invalid');
  const history = normalizeHistory(model.history || []);
  if (history.length && model.asOf !== history.at(-1).date) throw new TypeError('model.asOf must match latest history date');
  return { ...model, value: model.value === null ? null : Number(model.value), history };
}

module.exports = {
  RANGE_DAYS,
  RANGE_KEYS,
  VALID_STATUSES,
  availableRanges,
  filterHistory,
  isIsoDate,
  normalizeHistory,
  sampleHistory,
  validateModel
};
