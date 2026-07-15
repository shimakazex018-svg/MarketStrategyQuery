'use strict';

const CANDIDATE_CONTRACTS = Object.freeze([
  { contractCode: '209742', name: 'E-mini Nasdaq-100', selectionStatus: 'selected_primary' },
  { contractCode: '209747', name: 'Micro E-mini Nasdaq-100', selectionStatus: 'diagnostic_candidate' }
]);

const ALGORITHM_VERSION = 'NASDAQ-TFF-POSITIONING-v1-209742';

function percentileRank(values, current) {
  if (!values.length || !Number.isFinite(current)) return null;
  return values.filter(value => value <= current).length / values.length * 100;
}

function positioningForRow(row, contractCode) {
  const fields = ['assetManagerLong', 'assetManagerShort', 'leveragedFundsLong', 'leveragedFundsShort', 'openInterest'];
  const values = Object.fromEntries(fields.map(field => [field, Number(row[field])]));
  if (fields.some(field => !Number.isFinite(values[field]) || values[field] < 0) || values.openInterest <= 0) return null;
  const assetManagerNet = values.assetManagerLong - values.assetManagerShort;
  const leveragedFundsNet = values.leveragedFundsLong - values.leveragedFundsShort;
  return {
    contractCode,
    reportDate: row.reportDate || null,
    publishedAt: row.publishedAt || null,
    assetManagerNet,
    assetManagerNetRatio: assetManagerNet / values.openInterest,
    leveragedFundsNet,
    leveragedFundsNetRatio: leveragedFundsNet / values.openInterest,
    openInterest: values.openInterest
  };
}

function calculateCotPositioning(rows, { contractCode } = {}) {
  if (!Array.isArray(rows)) throw new TypeError('COT rows must be an array');
  if (!CANDIDATE_CONTRACTS.some(contract => contract.contractCode === contractCode)) {
    return { status: 'insufficient_coverage', value: null, reason: 'target_contract_not_selected', candidates: CANDIDATE_CONTRACTS };
  }
  const row = rows
    .filter(item => String(item.contractCode) === contractCode)
    .sort((left, right) => String(left.reportDate || '').localeCompare(String(right.reportDate || '')))
    .at(-1);
  if (!row) return { status: 'insufficient_coverage', value: null, reason: 'target_contract_missing', contractCode };
  const current = positioningForRow(row, contractCode);
  if (!current) {
    return { status: 'insufficient_coverage', value: null, reason: 'invalid_position_fields', contractCode };
  }
  const history = rows
    .filter(item => String(item.contractCode) === contractCode)
    .map(item => positioningForRow(item, contractCode))
    .filter(Boolean)
    .sort((left, right) => left.reportDate.localeCompare(right.reportDate));
  const horizons = {};
  for (const years of [1, 3, 5]) {
    const cutoff = new Date(`${current.reportDate}T00:00:00Z`);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
    const sample = history.filter(item => item.reportDate >= cutoff.toISOString().slice(0, 10));
    horizons[`${years}Y`] = {
      percentile: percentileRank(sample.map(item => item.assetManagerNetRatio), current.assetManagerNetRatio),
      observationCount: sample.length,
      actualStart: sample[0]?.reportDate || null
    };
  }
  horizons.ALL = {
    percentile: percentileRank(history.map(item => item.assetManagerNetRatio), current.assetManagerNetRatio),
    observationCount: history.length,
    actualStart: history[0]?.reportDate || null
  };
  return {
    status: 'fresh',
    value: current.assetManagerNetRatio * 100,
    unit: '% OI',
    defaultMetric: 'asset_manager_net_ratio',
    algorithmVersion: ALGORITHM_VERSION,
    contractCode,
    reportType: 'TFF_futures_only',
    ...current,
    assetManagerNetShareOfOpenInterest: current.assetManagerNetRatio,
    leveragedFundsNetShareOfOpenInterest: current.leveragedFundsNetRatio,
    horizons,
    history: history.map(item => ({ date: item.reportDate, value: item.assetManagerNetRatio * 100 })),
    disclaimer: '基于CFTC Traders in Financial Futures报告构建，只反映报告期货市场中的聚合持仓，不代表基金经理实际股票仓位。'
  };
}

module.exports = { ALGORITHM_VERSION, CANDIDATE_CONTRACTS, calculateCotPositioning, percentileRank, positioningForRow };
