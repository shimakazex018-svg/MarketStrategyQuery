'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseCsv } = require('../server/imports/csv-parser');
const { importHoldingsCsv } = require('../server/imports/holdings-import');
const { importPricesCsv } = require('../server/imports/prices-import');
const { RuntimeImportStore } = require('../server/imports/runtime-import-store');
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
  assert.equal(result.inputWeightScale, 'decimal_0_to_1');
  assert.equal(result.manifest.sha256.length, 64);
  const warning = importHoldingsCsv(csv.replace('0.4', '0.2'));
  assert.deepEqual(warning.warnings, ['weights_do_not_total_one']);
  assert.throws(() => importHoldingsCsv(csv.replace('0.4', '0.2'), { strictWeightTotal: true }), /weights total/);
  assert.throws(() => importHoldingsCsv(`${csv}\nAAA,0.1,2026-01-02,SYNTHETIC`, { strictWeightTotal: false }), /duplicate holding/);
});

test('holdings import accepts 0-100 weights, optional provenance fields and provisional missing dates', () => {
  const percent = [
    'ticker,weight,asOf,name,cusip,sourceReference',
    'AAA,60,2026-01-02,Alpha,000000001,local-export-1',
    'BBB,40,2026-01-02,Beta,000000002,local-export-1'
  ].join('\n');
  const normalized = importHoldingsCsv(percent, { sourceName: 'USER_AUTHORIZED_EXPORT' });
  assert.equal(normalized.inputWeightScale, 'percent_0_to_100');
  assert.equal(normalized.originalWeightTotal, 100);
  assert.equal(normalized.records[0].weight, 0.6);
  assert.equal(normalized.records[0].cusip, '000000001');

  const missingDate = importHoldingsCsv(percent.replaceAll('2026-01-02', ''), {
    sourceName: 'USER_AUTHORIZED_EXPORT', allowMissingAsOf: true
  });
  assert.equal(missingDate.asOf, null);
  assert.ok(missingDate.warnings.includes('weight_date_missing'));
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

test('runtime import store auto-detects local CSV files and keeps failures isolated', async t => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-import-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new RuntimeImportStore(root);
  await store.init();
  await fs.writeFile(path.join(store.directories.holdings, 'qqq.csv'), [
    'ticker,weight,asOf',
    'AAA,55,2026-01-02',
    'BBB,45,2026-01-02'
  ].join('\n'));
  await fs.writeFile(path.join(store.directories.prices, 'prices.csv'), [
    'ticker,date,adjustedClose,sourceName',
    'AAA,2026-01-02,100,USER_EXPORT',
    'BBB,2026-01-02,50,USER_EXPORT'
  ].join('\n'));
  await fs.writeFile(path.join(store.directories.forwardPe, 'bad.csv'), 'bad,data\n1,2\n');
  const result = await store.load();
  assert.equal(result.holdings.status, 'fresh');
  assert.equal(result.holdings.data.inputWeightScale, 'percent_0_to_100');
  assert.equal(result.prices.status, 'fresh');
  assert.equal(result.forwardPe.status, 'error');
  assert.match(result.forwardPe.error.message, /required header/);
  const normalized = JSON.parse(await fs.readFile(path.join(root, 'normalized', 'holdings.json'), 'utf8'));
  assert.equal(normalized.data.manifest.sha256.length, 64);
});
