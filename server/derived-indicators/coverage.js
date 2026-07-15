'use strict';

function summarizeWeightedCoverage(components, predicate) {
  if (!Array.isArray(components) || !components.length) throw new TypeError('components must be a non-empty array');
  const totalWeight = components.reduce((sum, component) => {
    const weight = Number(component.weight);
    if (!Number.isFinite(weight) || weight < 0) throw new TypeError(`invalid weight for ${component.ticker || 'component'}`);
    return sum + weight;
  }, 0);
  if (!(totalWeight > 0)) throw new TypeError('total component weight must be positive');
  const covered = components.filter(predicate);
  const coveredWeight = covered.reduce((sum, component) => sum + Number(component.weight), 0);
  return {
    totalWeight,
    coveredWeight,
    coverageRatio: coveredWeight / totalWeight,
    missingWeight: Math.max(0, totalWeight - coveredWeight),
    coveredCount: covered.length,
    totalCount: components.length,
    missingTickers: components.filter(component => !predicate(component)).map(component => component.ticker)
  };
}

function finiteNumber(value) {
  return Number.isFinite(Number(value));
}

module.exports = { finiteNumber, summarizeWeightedCoverage };

