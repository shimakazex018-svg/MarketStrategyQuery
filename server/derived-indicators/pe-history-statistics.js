'use strict';

function quantile(sorted, probability) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function summarize(sorted) {
  if (!sorted.length) return null;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / sorted.length;
  return {
    mean,
    median: quantile(sorted, 0.5),
    stdDev: Math.sqrt(variance),
    q25: quantile(sorted, 0.25),
    q75: quantile(sorted, 0.75)
  };
}

function valueOf(entry) {
  return typeof entry === 'number' ? entry : Number(entry?.value ?? entry?.pe);
}

function calculatePeHistoryStats(entries, { minSampleSize = 10, trimFraction = 0.1 } = {}) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
  if (!Number.isInteger(minSampleSize) || minSampleSize < 1) throw new TypeError('minSampleSize must be a positive integer');
  if (!Number.isFinite(trimFraction) || trimFraction < 0 || trimFraction >= 0.5) throw new TypeError('trimFraction must be in [0, 0.5)');
  const values = entries.map(valueOf).filter(value => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  const rawStats = summarize(values);
  if (values.length < minSampleSize) {
    return {
      algorithmVersion: 'PE-HISTORY-TRIM10-v1',
      status: 'insufficient_sample',
      rawSampleCount: entries.length,
      validSampleCount: values.length,
      trimmedSampleCount: 0,
      rawStats,
      trimmedStats: null
    };
  }
  const trimCount = Math.floor(values.length * trimFraction);
  const trimmed = values.slice(trimCount, values.length - trimCount);
  return {
    algorithmVersion: 'PE-HISTORY-TRIM10-v1',
    status: 'ok',
    rawSampleCount: entries.length,
    validSampleCount: values.length,
    trimmedSampleCount: trimmed.length,
    excludedLowCount: trimCount,
    excludedHighCount: trimCount,
    rawStats,
    trimmedStats: summarize(trimmed)
  };
}

module.exports = { calculatePeHistoryStats, quantile, summarize };
