'use strict';

const { isIsoDate } = require('../market-data/schema');
const { importManifest, parseCsv } = require('./csv-parser');

const REQUIRED_HEADERS = Object.freeze(['ticker', 'weight', 'asOf']);
const OPTIONAL_FIELDS = Object.freeze(['name', 'cusip', 'isin', 'shares', 'marketValue', 'sourceName', 'sourceReference', 'cik']);

function normalizeTicker(value) {
  const ticker = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(ticker)) throw new TypeError(`invalid ticker ${value}`);
  return ticker;
}

function importHoldingsCsv(input, options = {}) {
  const parsed = parseCsv(input, { ...options, requiredHeaders: REQUIRED_HEADERS });
  const seen = new Set();
  const rawWeights = parsed.records.map(record => Number(record.weight));
  if (rawWeights.some(weight => !Number.isFinite(weight) || weight < 0 || weight > 100)) throw new TypeError('holdings contain an invalid weight');
  const usesPercentage = rawWeights.some(weight => weight > 1);
  const scale = usesPercentage ? 100 : 1;
  const warnings = [];
  const records = parsed.records.map((record, index) => {
    const ticker = normalizeTicker(record.ticker);
    if (seen.has(ticker)) throw new TypeError(`duplicate holding ${ticker}`);
    seen.add(ticker);
    const weight = Number(record.weight) / scale;
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new TypeError(`invalid weight for ${ticker}`);
    const asOf = record.asOf || null;
    if (asOf && !isIsoDate(asOf)) throw new TypeError(`invalid asOf for ${ticker}`);
    if (!asOf && !options.allowMissingAsOf) throw new TypeError(`invalid asOf for ${ticker}`);
    const sourceName = record.sourceName || options.sourceName || '用户本地CSV（未声明原始来源）';
    const normalized = { ticker, weight, originalWeight: Number(record.weight), asOf, sourceName, row: index + 2 };
    for (const field of OPTIONAL_FIELDS) {
      if (record[field] !== undefined && record[field] !== '') normalized[field] = record[field];
    }
    normalized.sourceName = sourceName;
    return normalized;
  });

  const dates = new Set(records.map(record => record.asOf).filter(Boolean));
  if (dates.size > 1) throw new TypeError('holdings must share one asOf date');
  if (records.some(record => !record.asOf)) warnings.push('weight_date_missing');
  const sourceNames = new Set(records.map(record => record.sourceName));
  if (sourceNames.size > 1) warnings.push('multiple_source_names');
  const totalWeight = records.reduce((sum, record) => sum + record.weight, 0);
  const originalWeightTotal = rawWeights.reduce((sum, weight) => sum + weight, 0);
  const tolerance = options.weightTolerance ?? 0.02;
  const weightTotalValid = Math.abs(totalWeight - 1) <= tolerance;
  if ((options.strictWeightTotal ?? false) && !weightTotalValid) {
    throw new RangeError(`holding weights total ${totalWeight}; expected 1 within tolerance ${tolerance}`);
  }
  if (!weightTotalValid) warnings.push('weights_do_not_total_one');
  return {
    records,
    asOf: dates.size === 1 && records.every(record => record.asOf) ? [...dates][0] : null,
    totalWeight,
    originalWeightTotal,
    inputWeightScale: usesPercentage ? 'percent_0_to_100' : 'decimal_0_to_1',
    weightTotalValid,
    warnings,
    manifest: importManifest(input, { importedAt: options.importedAt, sourceName: sourceNames.size === 1 ? records[0].sourceName : 'multiple user-declared sources', rowCount: records.length })
  };
}

module.exports = { OPTIONAL_FIELDS, importHoldingsCsv, normalizeTicker };
