'use strict';

const ALGORITHM_VERSION = 'RISK-APPETITE-v1-EW';

const COMPONENTS = Object.freeze([
  { id: 'qqq-vs-ma200', label: 'QQQ价格相对200日均线', direction: 'higher_is_risk_on' },
  { id: 'qqq-momentum', label: 'QQQ 20日与120日动量', direction: 'higher_is_risk_on' },
  { id: 'qqq-distance-52w-high', label: 'QQQ距离52周高点', direction: 'higher_is_risk_on' },
  { id: 'qqq-max-drawdown', label: 'QQQ最大回撤', direction: 'higher_is_risk_off' },
  { id: 'rv20-percentile', label: 'RV20水平与历史分位', direction: 'higher_is_risk_off' },
  { id: 'soxx-relative-qqq', label: 'SOXX相对QQQ强弱', direction: 'higher_is_risk_on' },
  { id: 'nasdaq-cot-positioning', label: 'Nasdaq期货机构仓位代理', direction: 'higher_is_risk_on' }
]);

function calculateRiskAppetite(inputs, options = {}) {
  if (!Array.isArray(inputs)) throw new TypeError('risk appetite inputs must be an array');
  const inputById = new Map();
  for (const input of inputs) {
    if (!input?.id || inputById.has(input.id)) throw new TypeError('risk appetite inputs contain a missing or duplicate id');
    inputById.set(input.id, input);
  }
  const available = [];
  const missing = [];
  for (const definition of COMPONENTS) {
    const input = inputById.get(definition.id);
    const score = Number(input?.score);
    if (!Number.isFinite(score)) {
      missing.push(definition.id);
      continue;
    }
    if (score < 0 || score > 100) throw new RangeError(`risk appetite score for ${definition.id} must be between 0 and 100`);
    const adjustedScore = definition.direction === 'higher_is_risk_off' ? 100 - score : score;
    available.push({ ...definition, rawScore: score, adjustedScore, asOf: input.asOf || null });
  }
  const minAvailable = options.minAvailable ?? 5;
  const sufficient = available.length >= minAvailable;
  const weight = available.length ? 1 / available.length : 0;
  const components = available.map(component => ({ ...component, weight, contribution: component.adjustedScore * weight }));
  const score = components.reduce((sum, component) => sum + component.contribution, 0);
  const dates = components.map(component => component.asOf).filter(Boolean).sort();
  return {
    status: sufficient ? (options.validStatus || 'demo') : 'insufficient_coverage',
    value: sufficient ? score : null,
    algorithmVersion: ALGORITHM_VERSION,
    coverageRatio: available.length / COMPONENTS.length,
    availableCount: available.length,
    totalCount: COMPONENTS.length,
    missingComponents: missing,
    components,
    inputDate: dates.length ? dates[0] === dates.at(-1) ? dates[0] : null : null,
    dateMismatch: dates.length > 1 && dates[0] !== dates.at(-1),
    weighting: 'equal_weight_among_available_components'
  };
}

module.exports = { ALGORITHM_VERSION, COMPONENTS, calculateRiskAppetite };

