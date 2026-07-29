'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const {
  deriveNaaimStatistics, normalizeNaaimRows, validateStoredNaaim
} = require('../server/data-sources/naaim-exposure-provider');
const { importNaaimExposure, resolveNaaimInput } = require('../tools/market-data/import-naaim-exposure');

const NOW = new Date('2026-07-29T00:00:00Z');

function zip(entries) {
  const files = entries.map(({ name, text }) => {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(text);
    return { nameBuffer, data, compressed: zlib.deflateRawSync(data) };
  });
  let offset = 0;
  const locals = files.map(file => {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8);
    header.writeUInt32LE(file.compressed.length, 18); header.writeUInt32LE(file.data.length, 22); header.writeUInt16LE(file.nameBuffer.length, 26);
    file.offset = offset; offset += header.length + file.nameBuffer.length + file.compressed.length;
    return Buffer.concat([header, file.nameBuffer, file.compressed]);
  });
  const centralStart = offset;
  const central = files.map(file => {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(8, 10);
    header.writeUInt32LE(file.compressed.length, 20); header.writeUInt32LE(file.data.length, 24); header.writeUInt16LE(file.nameBuffer.length, 28); header.writeUInt32LE(file.offset, 42);
    return Buffer.concat([header, file.nameBuffer]);
  });
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, ...central, end]);
}

function workbook({ header = 'NAAIM Number Mean/Average', rows = [], extra = '', macro = false, external = false } = {}) {
  const rowXml = [["Date", header, 'Bearish', 'Quart1', 'Quart2', 'Quart3', 'Bullish', 'Deviation'], ...rows]
    .map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, index) => `<c r="${String.fromCharCode(65 + index)}${rowIndex + 1}" t="inlineStr"><is><t>${value ?? ''}</t></is></c>`).join('')}</row>`).join('');
  const entries = [
    { name: '[Content_Types].xml', text: '<Types/>' },
    { name: 'xl/workbook.xml', text: '<workbook xmlns:r="r"><sheets><sheet name="Exposure History" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>${external ? '<Relationship Id="rId2" Target="https://example.invalid" TargetMode="External"/>' : ''}</Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', text: `<worksheet><sheetData>${rowXml}</sheetData></worksheet>` }
  ];
  if (macro) entries.push({ name: 'xl/vbaProject.bin', text: 'not executed' });
  if (extra) entries.push({ name: 'xl/worksheets/sheet2.xml', text: extra });
  return zip(entries);
}

async function temporaryWorkbook(t, options) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'naaim-import-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const relative = path.join('runtime-data', 'imports', 'naaim', 'naaim-exposure-index.xlsx');
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, workbook(options));
  return { root, relative, file };
}

test('NAAIM import recognizes a local Excel workbook and explicit core/optional columns', async t => {
  const fixture = await temporaryWorkbook(t, { rows: [['2026-07-01', '95', '10', '40', '90', '130', '170', '20'], ['2026-07-08', '105', '11', '41', '100', '140', '171', '21']] });
  const result = await importNaaimExposure({ file: fixture.relative, rootDir: fixture.root, now: NOW });
  assert.equal(result.changed, true);
  assert.deepEqual(result.workbookSheets, ['Exposure History']);
  assert.equal(result.selectedSheet, 'Exposure History');
  assert.equal(result.firstDate, '2026-07-01');
  assert.equal(result.lastDate, '2026-07-08');
  assert.equal(result.rowCount, 2);
  const stored = JSON.parse(await fs.readFile(path.join(fixture.root, 'runtime-data', 'market-data', 'production', 'naaim', 'naaim-exposure.json'), 'utf8'));
  assert.equal(stored.networkFetchEnabled, false);
  assert.equal(stored.values[0].median, 90);
  assert.doesNotMatch(JSON.stringify(stored), /imports[\\/]|Users|token|cookie/i);
});

test('NAAIM normalizer sorts rows, removes identical duplicates, permits negative and leveraged values without interpolation', () => {
  const result = normalizeNaaimRows([
    { date: '2026-07-15', value: 150 }, { date: '2026-07-01', value: -50 },
    { date: '2026-07-01', value: -50 }, { date: '2026-07-29', value: 105 }
  ], { now: NOW });
  assert.deepEqual(result.values.map(point => point.date), ['2026-07-01', '2026-07-15', '2026-07-29']);
  assert.equal(result.diagnostics.duplicateCount, 1);
  assert.equal(result.diagnostics.weeklyGapCount, 2);
  assert.equal(result.values[0].value, -50);
});

test('NAAIM normalizer rejects missing, conflicts, future dates and out-of-range values without replacing prior data', () => {
  assert.throws(() => normalizeNaaimRows([{ date: '2026-07-01', value: null }], { now: NOW }), /missing/);
  assert.throws(() => normalizeNaaimRows([{ date: '2026-07-01', value: 10 }, { date: '2026-07-01', value: 11 }], { now: NOW }), /conflicting/);
  assert.throws(() => normalizeNaaimRows([{ date: '2026-08-01', value: 10 }], { now: NOW }), /future/);
  assert.throws(() => normalizeNaaimRows([{ date: '2026-07-01', value: 201 }], { now: NOW }), /-200 to 200/);
});

test('NAAIM import rejects missing core headers, macros, external links, oversized paths and traversal', async t => {
  const missing = await temporaryWorkbook(t, { header: 'Not Mean', rows: [['2026-07-01', '10']] });
  await assert.rejects(importNaaimExposure({ file: missing.relative, rootDir: missing.root, now: NOW }), /missing explicit/);
  const macro = await temporaryWorkbook(t, { macro: true, rows: [['2026-07-01', '10']] });
  await assert.rejects(importNaaimExposure({ file: macro.relative, rootDir: macro.root, now: NOW }), /macros/);
  const external = await temporaryWorkbook(t, { external: true, rows: [['2026-07-01', '10']] });
  await assert.rejects(importNaaimExposure({ file: external.relative, rootDir: external.root, now: NOW }), /external links/);
  assert.throws(() => resolveNaaimInput('../outside.xlsx', missing.root), /inside runtime-data/);
  assert.throws(() => resolveNaaimInput(path.join('runtime-data', 'imports', 'naaim', 'file.csv'), missing.root), /\.xlsx/);
});

test('NAAIM repeated import is atomic and idempotent while a failed replacement preserves the last success', async t => {
  const fixture = await temporaryWorkbook(t, { rows: [['2026-07-01', '90'], ['2026-07-08', '100'], ['2026-07-15', '110'], ['2026-07-22', '120']] });
  const args = { file: fixture.relative, rootDir: fixture.root, now: NOW };
  assert.equal((await importNaaimExposure(args)).changed, true);
  assert.equal((await importNaaimExposure(args)).changed, false);
  await fs.writeFile(fixture.file, workbook({ rows: [['2026-07-01', '300']] }));
  await assert.rejects(importNaaimExposure(args), /-200 to 200/);
  const stored = JSON.parse(await fs.readFile(path.join(fixture.root, 'runtime-data', 'market-data', 'production', 'naaim', 'naaim-exposure.json'), 'utf8'));
  assert.equal(stored.lastDate, '2026-07-22');
  assert.equal((await fs.readdir(path.dirname(path.join(fixture.root, 'runtime-data', 'market-data', 'production', 'naaim', 'naaim-exposure.json')))).filter(name => name.endsWith('.tmp')).length, 0);
});

test('NAAIM derived values distinguish four-week, one-year and all-history percentile', () => {
  const values = [50, 75, 100, 125, 150].map((value, index) => ({ date: `2026-0${index + 1}-01`, value }));
  const derived = deriveNaaimStatistics(values);
  assert.equal(derived.weekOverWeekChange, 25);
  assert.equal(derived.fourWeekAverage, 112.5);
  assert.equal(derived.oneYearPercentile, 100);
  assert.equal(derived.allHistoryLow, 50);
  const stored = validateStoredNaaim({ metricId: 'naaim_exposure', provider: 'NAAIM', frequency: 'weekly', networkFetchEnabled: false, firstDate: values[0].date, lastDate: values.at(-1).date, rowCount: values.length, values });
  assert.equal(stored.derived.latestValue, 150);
});
