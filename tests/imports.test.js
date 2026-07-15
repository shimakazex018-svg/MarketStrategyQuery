'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseCsv } = require('../server/imports/csv-parser');
const { importHoldingsCsv } = require('../server/imports/holdings-import');
const { importPricesCsv } = require('../server/imports/prices-import');
const {
  importManualForwardPeCsv,
  manualForwardPeState,
  validateManualForwardPe
} = require('../server/imports/manual-input-import');

test('bounded CSV parser handles quoted UTF-8 fields and rejects malformed input', () => {
  const parsed = parseCsv('name,notes\n示例,"quoted, value"\n', { requiredHeaders: ['name', 'notes'] });
  assert.deepEqual(parsed.records, [{ name: '示例', notes: 'quoted, value' }]);
  assert.throws(() => parseCsv('a,b\n1,"open'), /unclosed/);
  assert.throws(() => parseCsv('a,a\n1,2'), /duplicate headers/);
  assert.throws(() => parseCsv('a\n12345', { maxFieldLength: 4 }), /maxFieldLength/);
  assert.throws(() => parseCsv('a\n1', { requiredHeaders: ['missing'] }), /missing required header/);
});

test('holdings import normalizes tickers, checks duplicates and verifies total weight', () => {
  const csv = [
    'ticker,weight,asOf,sourceName',
    'aaa,0.6,2026-01-02,SYNTHETIC',
    'BBB,0.4,2026-01-02,SYNTHETIC'
  ].join('\n');
  const result = importHoldingsCsv(csv, { importedAt: '2026-01-03T00:00:00Z' });
  assert.equal(result.records[0].ticker, 'AAA');
  assert.equal(result.totalWeight, 1);
  assert.equal(result.manifest.sha256.length, 64);
  assert.throws(() => importHoldingsCsv(csv.replace('0.4', '0.2')), /weights total/);
  const warning = importHoldingsCsv(csv.replace('0.4', '0.2'), { strictWeightTotal: false });
  assert.deepEqual(warning.warnings, ['weights_do_not_total_one']);
  assert.throws(() => importHoldingsCsv(`${csv}\nAAA,0.1,2026-01-02,SYNTHETIC`, { strictWeightTotal: false }), /duplicate holding/);
});

test('price import rejects duplicates, missing or abnormal prices and per-ticker date disorder', () => {
  const valid = [
    'ticker,date,adjustedClose,sourceName',
    'QQQ,2026-01-02,500,SYNTHETIC',
    'QQQ,2026-01-05,505,SYNTHETIC'
  ].join('\n');
  assert.equal(importPricesCsv(valid).records.length, 2);
  assert.throws(() => importPricesCsv(valid.replace('505', '0')), /adjustedClose/);
  assert.throws(() => importPricesCsv(`${valid}\nQQQ,2026-01-05,506,SYNTHETIC`), /duplicate price/);
  assert.throws(() => importPricesCsv(valid.replace('2026-01-05', '2026-01-01')), /ascending date order/);
  assert.throws(() => importPricesCsv(valid.replace(',505,', ',,')), /adjustedClose/);
});

test('manual Forward PE validates methodology, provenance, duplicates and staleness', () => {
  const record = validateManualForwardPe({
    value: 24.5,
    asOf: '2026-01-02',
    sourceName: 'USER_DECLARED_SOURCE',
    sourceReference: 'local-note-1',
    methodology: 'forward_12_months',
    notes: 'Manual research entry',
    enteredAt: '2026-01-03T00:00:00Z'
  });
  assert.equal(record.status, 'manual');
  assert.equal(manualForwardPeState(record, { now: new Date('2026-03-15T00:00:00Z'), staleAfterDays: 45 }).stale, true);
  assert.throws(() => validateManualForwardPe({ ...record, methodology: 'mixed' }), /methodology/);
  assert.throws(() => validateManualForwardPe({ ...record, sourceReference: '' }), /required/);

  const header = 'value,asOf,sourceName,sourceReference,methodology,notes,enteredAt';
  const row = '24.5,2026-01-02,USER_SOURCE,ref-1,forward_12_months,Manual,2026-01-03T00:00:00Z';
  assert.throws(() => importManualForwardPeCsv(`${header}\n${row}\n${row}`), /duplicate manual/);
});
