'use strict';

const { normalizeHistory } = require('../market-data/schema');

const ALGORITHM_VERSION = 'RV20-PERCENTILE-v1-INCLUSIVE';
const HORIZONS = Object.freeze([1, 3, 5, 10]);

function percentileRank(values, current) {
  if (!values.length || !Number.isFinite(Number(current))) return null;
  return values.filter(value => value <= Number(current)).length / values.length * 100;
}

function calculateVolatilityPercentiles(input, options = {}) {
  const history = normalizeHistory(input, { min: 0 });
  if (!history.length) return { status: 'insufficient_coverage', value: null, horizons: {}, algorithmVersion: ALGORITHM_VERSION };
  const current = history.at(-1);
  const minObservations = options.minObservations ?? 20;
  const horizons = {};
  for (const years of options.horizons || HORIZONS) {
    const cutoff = new Date(`${current.date}T00:00:00Z`);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
    const sample = history.filter(point => point.date >= cutoff.toISOString().slice(0, 10));
    const actualStart = sample[0]?.date || null;
    const actualDays = actualStart
      ? (new Date(`${current.date}T00:00:00Z`) - new Date(`${actualStart}T00:00:00Z`)) / 86_400_000
      : 0;
    horizons[`${years}Y`] = {
      value: sample.length >= minObservations ? percentileRank(sample.map(point => point.value), current.value) : null,
      observationCount: sample.length,
      actualStart,
      actualEnd: current.date,
      fullHorizonAvailable: actualDays >= years * 365 * 0.9
    };
  }
  const defaultHorizon = options.defaultHorizon || '1Y';
  const value = horizons[defaultHorizon]?.value ?? null;
  return {
    status: value === null ? 'insufficient_coverage' : (options.validStatus || 'demo'),
    value,
    currentRv20: current.value,
    asOf: current.date,
    defaultHorizon,
    horizons,
    algorithmVersion: ALGORITHM_VERSION,
    inputStart: history[0].date,
    inputEnd: current.date
  };
}

module.exports = { ALGORITHM_VERSION, HORIZONS, calculateVolatilityPercentiles, percentileRank };

