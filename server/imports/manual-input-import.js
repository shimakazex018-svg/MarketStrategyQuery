'use strict';

const { isIsoDate } = require('../market-data/schema');
const { importManifest, parseCsv } = require('./csv-parser');

const METHODOLOGIES = new Set(['forward_12_months', 'next_fiscal_year', 'other']);
const REQUIRED_HEADERS = Object.freeze(['value', 'asOf', 'sourceName', 'sourceReference', 'methodology', 'notes', 'enteredAt']);

function validateManualForwardPe(record) {
  if (!record || typeof record !== 'object') throw new TypeError('manual Forward PE record must be an object');
  const value = Number(record.value);
  if (!Number.isFinite(value) || value <= 0) throw new TypeError('manual Forward PE value must be a positive finite number');
  if (!isIsoDate(record.asOf)) throw new TypeError('manual Forward PE asOf is invalid');
  if (!METHODOLOGIES.has(record.methodology)) throw new TypeError('manual Forward PE methodology is invalid');
  for (const field of ['sourceName', 'sourceReference', 'notes']) {
    if (typeof record[field] !== 'string') throw new TypeError(`manual Forward PE ${field} must be text`);
  }
  if (!record.sourceName.trim() || !record.sourceReference.trim()) {
    throw new TypeError('manual Forward PE sourceName and sourceReference are required');
  }
  const enteredAt = new Date(record.enteredAt);
  if (Number.isNaN(enteredAt.valueOf())) throw new TypeError('manual Forward PE enteredAt is invalid');
  return {
    value,
    asOf: record.asOf,
    sourceName: record.sourceName.trim(),
    sourceReference: record.sourceReference.trim(),
    methodology: record.methodology,
    notes: record.notes.trim(),
    enteredAt: enteredAt.toISOString(),
    status: 'manual'
  };
}

function importManualForwardPeCsv(input, options = {}) {
  const parsed = parseCsv(input, { ...options, requiredHeaders: REQUIRED_HEADERS, maxRows: options.maxRows ?? 100 });
  const records = parsed.records.map(validateManualForwardPe);
  const keys = new Set();
  for (const record of records) {
    const key = `${record.asOf}:${record.methodology}`;
    if (keys.has(key)) throw new TypeError(`duplicate manual Forward PE record ${key}`);
    keys.add(key);
  }
  const sourceName = records.length === 1 ? records[0].sourceName : 'multiple user-declared sources';
  return { records, manifest: importManifest(input, { importedAt: options.importedAt, sourceName, rowCount: records.length }) };
}

function manualForwardPeState(record, { now = new Date(), staleAfterDays = 45 } = {}) {
  const normalized = validateManualForwardPe(record);
  const ageDays = ((now instanceof Date ? now : new Date(now)).valueOf() - new Date(`${normalized.asOf}T00:00:00Z`).valueOf()) / 86_400_000;
  return { ...normalized, stale: ageDays > staleAfterDays, ageDays: Math.max(0, Math.floor(ageDays)) };
}

module.exports = { METHODOLOGIES, importManualForwardPeCsv, manualForwardPeState, validateManualForwardPe };
