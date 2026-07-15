'use strict';

const CANDIDATE_CONTRACTS = Object.freeze([
  { contractCode: '209742', name: 'E-mini Nasdaq-100', selectionStatus: 'candidate_unconfirmed' },
  { contractCode: '209747', name: 'Micro E-mini Nasdaq-100', selectionStatus: 'candidate_unconfirmed' }
]);

function calculateCotPositioning(rows, { contractCode } = {}) {
  if (!Array.isArray(rows)) throw new TypeError('COT rows must be an array');
  if (!CANDIDATE_CONTRACTS.some(contract => contract.contractCode === contractCode)) {
    return { status: 'insufficient_coverage', value: null, reason: 'target_contract_not_selected', candidates: CANDIDATE_CONTRACTS };
  }
  const row = rows.find(item => String(item.contractCode) === contractCode);
  if (!row) return { status: 'insufficient_coverage', value: null, reason: 'target_contract_missing', contractCode };
  const fields = ['assetManagerLong', 'assetManagerShort', 'leveragedFundsLong', 'leveragedFundsShort', 'openInterest'];
  const values = Object.fromEntries(fields.map(field => [field, Number(row[field])]));
  if (fields.some(field => !Number.isFinite(values[field]) || values[field] < 0) || values.openInterest <= 0) {
    return { status: 'insufficient_coverage', value: null, reason: 'invalid_position_fields', contractCode };
  }
  const assetManagerNet = values.assetManagerLong - values.assetManagerShort;
  const leveragedFundsNet = values.leveragedFundsLong - values.leveragedFundsShort;
  return {
    status: 'demo',
    value: null,
    defaultMetric: null,
    contractCode,
    reportType: 'TFF_futures_only',
    reportDate: row.reportDate || null,
    publishedAt: row.publishedAt || null,
    assetManagerNet,
    assetManagerNetShareOfOpenInterest: assetManagerNet / values.openInterest,
    leveragedFundsNet,
    leveragedFundsNetShareOfOpenInterest: leveragedFundsNet / values.openInterest,
    openInterest: values.openInterest,
    disclaimer: '基于CFTC期货持仓分类构建的代理指标，只反映报告期货市场中的聚合头寸。'
  };
}

module.exports = { CANDIDATE_CONTRACTS, calculateCotPositioning };

