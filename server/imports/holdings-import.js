'use strict';

const { isIsoDate } = require('../market-data/schema');
const { importManifest, parseCsv } = require('./csv-parser');

const REQUIRED_HEADERS = Object.freeze(['ticker', 'weight', 'asOf', 'sourceName']);

function normalizeTicker(value) {
  const ticker = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(ticker)) throw new TypeError(`invalid ticker ${value}`);
  return ticker;
}

function importHoldingsCsv(input, options = {}) {
  const parsed = parseCsv(input, { ...options, requiredHeaders: REQUIRED_HEADERS });
  const seen = new Set();
  const records = parsed.records.map((record, index) => {
    const ticker = normalizeTicker(record.ticker);
    if (seen.has(ticker)) throw new TypeError(`duplicate holding ${ticker}`);
    seen.add(ticker);
    const weight = Number(record.weight);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1) throw new TypeError(`invalid weight for ${ticker}`);
    if (!isIsoDate(record.asOf)) throw new TypeError(`invalid asOf for ${ticker}`);
    if (!record.sourceName) throw new TypeError(`missing sourceName for ${ticker}`);
    return { ticker, weight, asOf: record.asOf, sourceName: record.sourceName, row: index + 2 };
  });

  const dates = new Set(records.map(record => record.asOf));
  if (dates.size !== 1) throw new TypeError('holdings must share one asOf date');
  const sourceNames = new Set(records.map(record => record.sourceName));
  if (sourceNames.size !== 1) throw new TypeError('holdings must share one sourceName');
  const totalWeight = records.reduce((sum, record) => sum + record.weight, 0);
  const tolerance = options.weightTolerance ?? 0.005;
  const weightTotalValid = Math.abs(totalWeight - 1) <= tolerance;
  if ((options.strictWeightTotal ?? true) && !weightTotalValid) {
    throw new RangeError(`holding weights total ${totalWeight}; expected 1 within tolerance ${tolerance}`);
  }
  return {
    records,
    asOf: records[0].asOf,
    totalWeight,
    weightTotalValid,
    warnings: weightTotalValid ? [] : ['weights_do_not_total_one'],
    manifest: importManifest(input, { importedAt: options.importedAt, sourceName: records[0].sourceName, rowCount: records.length })
  };
}

module.exports = { importHoldingsCsv, normalizeTicker };

