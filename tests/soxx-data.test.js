'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createHttpServer } = require('../server');
const {
  EtfPriceProvider,
  normalizeSoxxRows,
  parseSoxxCsv,
  parseSpreadsheetMl,
  validateStoredSoxx
} = require('../server/data-sources/etf-price-provider');
const { importSoxxHistory } = require('../tools/market-data/import-soxx-history');

const NOW = new Date('2099-01-10T00:00:00Z');
const options = { seriesType: 'nav', adjustmentStatus: 'provider_adjusted', now: NOW };
const rows = [
  { Date: '2024-03-06', Value: 100, Symbol: 'SOXX' },
  { Date: '2024-03-07', Value: 101, Symbol: 'SOXX' },
  { Date: '2024-03-08', Value: 99, Symbol: 'SOXX' }
];

function spreadsheetXml() {
  return `<?xml version="1.0"?><ss:Workbook xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><ss:Worksheet ss:Name="Disclaimers"><ss:Table><ss:Row><ss:Cell><ss:Data ss:Type="String">iShares Semiconductor ETF</ss:Data></ss:Cell></ss:Row></ss:Table></ss:Worksheet><ss:Worksheet ss:Name="Historical"><ss:Table><ss:Row><ss:Cell><ss:Data ss:Type="String">As Of</ss:Data></ss:Cell><ss:Cell><ss:Data ss:Type="String">NAV per Share</ss:Data></ss:Cell><ss:Cell><ss:Data ss:Type="String">Ex-Dividends</ss:Data></ss:Cell><ss:Cell><ss:Data ss:Type="String">Shares Outstanding</ss:Data></ss:Cell></ss:Row><ss:Row><ss:Cell><ss:Data ss:Type="String">2024-03-06</ss:Data></ss:Cell><ss:Cell><ss:Data ss:Type="Number">100</ss:Data></ss:Cell></ss:Row><ss:Row><ss:Cell><ss:Data ss:Type="String">2024-03-07</ss:Data></ss:Cell><ss:Cell><ss:Data ss:Type="Number">101</ss:Data></ss:Cell></ss:Row></ss:Table></ss:Worksheet></ss:Workbook>`;
}

test('SOXX identity is exact and rejects SOX, SOXL and SOXS', () => {
  assert.equal(normalizeSoxxRows(rows, options).values.length, 3);
  for (const symbol of ['SOX', 'SOXL', 'SOXS']) assert.throws(() => normalizeSoxxRows(rows.map(row => ({ ...row, Symbol: symbol })), options), /non-SOXX/);
});

test('CSV parser requires an explicit and consistent price series column', () => {
  assert.equal(parseSoxxCsv('Date,Close,Symbol\n2024-03-06,100,SOXX\n', 'market_price')[0].Value, '100');
  assert.equal(parseSoxxCsv('Date,Adjusted Close,Symbol\n2024-03-06,100,SOXX\n', 'adjusted_market_price')[0].Value, '100');
  assert.equal(parseSoxxCsv('Date,NAV,Symbol\n2024-03-06,100,SOXX\n', 'nav')[0].Value, '100');
  assert.throws(() => parseSoxxCsv('Date,Close,Adjusted Close\n2024-03-06,100,99\n', 'nav'), /exactly one/);
  assert.throws(() => parseSoxxCsv('Close\n100\n', 'market_price'), /required header/i);
});

test('official SpreadsheetML parser selects only the exact Historical NAV worksheet', () => {
  const parsed = parseSpreadsheetMl(spreadsheetXml());
  assert.deepEqual(parsed.map(row => row.NAV), ['100', '101']);
  assert.throws(() => parseSpreadsheetMl(spreadsheetXml().replace('NAV per Share', 'Closing Price')), /fields changed/);
  assert.throws(() => parseSpreadsheetMl(spreadsheetXml().replace('iShares Semiconductor ETF', 'SOX Index')), /does not identify/);
});

test('normalization sorts, deduplicates identical rows and excludes weekend carry values', () => {
  const result = normalizeSoxxRows([rows[1], rows[0], rows[0], { Date: '2024-03-09', Value: 99, Symbol: 'SOXX' }], options);
  assert.deepEqual(result.values.map(point => point.date), ['2024-03-06', '2024-03-07']);
  assert.equal(result.diagnostics.duplicateCount, 1);
  assert.equal(result.diagnostics.weekendExcludedCount, 1);
});

test('normalization rejects conflicts, missing values, pre-inception dates and future dates', () => {
  assert.throws(() => normalizeSoxxRows([rows[0], { ...rows[0], Value: 102 }, rows[1]], options), /conflicting/);
  assert.throws(() => normalizeSoxxRows([{ ...rows[0], Value: null }, rows[1]], options), /missing value/);
  assert.throws(() => normalizeSoxxRows([{ Date: '2001-07-09', Value: 10 }, { Date: '2001-07-10', Value: 10 }], options), /predates/);
  assert.throws(() => normalizeSoxxRows([{ Date: '2100-01-04', Value: 10 }, { Date: '2100-01-05', Value: 10 }], options), /future/);
});

test('split validation rejects discontinuities and never re-adjusts provider-adjusted data', () => {
  assert.throws(() => normalizeSoxxRows([{ ...rows[0], Value: 300 }, { ...rows[1], Value: 100 }], options), /split-like/);
  const result = normalizeSoxxRows(rows, options);
  assert.deepEqual(result.values.map(point => point.value), [100, 101, 99]);
  assert.equal(result.diagnostics.splitCheckStatus, 'known_split_continuity_verified');
  assert.throws(() => normalizeSoxxRows(rows, { ...options, seriesType: 'market_price', adjustmentStatus: 'unadjusted' }), /cannot span/);
});

test('stored model metadata must match its normalized history', () => {
  const model = { metricId: 'soxx_price', symbol: 'SOXX', seriesType: 'nav', adjustmentStatus: 'provider_adjusted', firstDate: '2024-03-06', lastDate: '2024-03-08', rowCount: 3, values: rows.map(row => ({ date: row.Date, value: row.Value })) };
  assert.equal(validateStoredSoxx(model).rowCount, 3);
  assert.throws(() => validateStoredSoxx({ ...model, symbol: 'SOX' }), /identity/);
  assert.throws(() => validateStoredSoxx({ ...model, rowCount: 4 }), /metadata/);
});

test('local CSV import is atomic, idempotent and never converts missing values to zero', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soxx-import-test-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const relative = path.join('runtime-data', 'imports', 'soxx', 'soxx-daily.csv');
  const inputPath = path.join(rootDir, relative);
  await fs.mkdir(path.dirname(inputPath), { recursive: true });
  await fs.writeFile(inputPath, 'Date,NAV,Symbol\n2024-03-06,100,SOXX\n2024-03-07,101,SOXX\n');
  const args = { file: relative, 'series-type': 'nav', 'adjustment-status': 'provider_adjusted', source: 'local-csv', now: NOW, rootDir };
  assert.equal((await importSoxxHistory(args)).changed, true);
  assert.equal((await importSoxxHistory(args)).changed, false);
  const targetDir = path.join(rootDir, 'runtime-data', 'market-data', 'production', 'etf');
  assert.deepEqual((await fs.readdir(targetDir)).filter(name => name.endsWith('.tmp')), []);
  const stored = JSON.parse(await fs.readFile(path.join(targetDir, 'soxx.json'), 'utf8'));
  assert.deepEqual(stored.values.map(point => point.value), [100, 101]);
  await fs.writeFile(inputPath, 'Date,NAV,Symbol\n2024-03-06,,SOXX\n2024-03-07,101,SOXX\n');
  await assert.rejects(importSoxxHistory(args), /missing value/);
});

test('ETF provider isolates invalid local updates and never enables network requests', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soxx-provider-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'etf', 'soxx.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const model = { metricId: 'soxx_price', symbol: 'SOXX', provider: 'iShares / BlackRock', seriesType: 'nav', adjustmentStatus: 'provider_adjusted', firstDate: '2024-03-06', lastDate: '2024-03-08', rowCount: 3, values: rows.map(row => ({ date: row.Date, value: row.Value })) };
  await fs.writeFile(file, JSON.stringify(model));
  const provider = await new EtfPriceProvider({ productionRoot: root, now: () => NOW }).init();
  assert.equal((await provider.read()).rowCount, 3);
  await fs.writeFile(file, '{broken');
  assert.equal((await provider.refresh()).ok, true);
  assert.equal((await provider.read()).rowCount, 3);
  assert.equal(provider.getStatus().networkRequestsEnabled, false);
  assert.equal(provider.getStatus().lastError, 'invalid_local_soxx_data');
});

test('SOXX detail and full-history APIs preserve series metadata without internal paths', async t => {
  const model = { id: 'soxx_price', value: 99, history: rows.map(row => ({ date: row.Date, value: row.Value })), historyStart: '2024-03-06', historyEnd: '2024-03-08', status: 'fresh', provider: 'iShares / BlackRock', sourceLabel: 'iShares / BlackRock', seriesType: 'nav', adjustmentStatus: 'provider_adjusted', limitations: ['NAV only'] };
  const service = { getIndicator: id => id === 'soxx_price' ? model : null, getIndicatorHistory: id => id === 'soxx_price' ? { metricId: id, range: 'ALL', history: model.history, status: model.status, provider: model.provider, sourceLabel: model.sourceLabel, seriesType: model.seriesType, adjustmentStatus: model.adjustmentStatus, limitations: model.limitations } : null, getStatus: () => ({ ok: true }) };
  const server = createHttpServer(service);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const detail = await fetch(`${base}/api/market-data/metrics/soxx_price`).then(response => response.json());
  const history = await fetch(`${base}/api/market-data/metrics/soxx_price/history?range=ALL`).then(response => response.json());
  assert.equal(detail.seriesType, 'nav');
  assert.equal(history.history.length, 3);
  assert.equal(history.adjustmentStatus, 'provider_adjusted');
  assert.doesNotMatch(JSON.stringify({ detail, history }), /runtime-data|sha256|contentHash|stack/i);
});

test('SOXX remains optional on drawdown UI and absent from the six-card homepage contract', async () => {
  const root = path.join(__dirname, '..');
  const [app, indicators] = await Promise.all([
    fs.readFile(path.join(root, 'public', 'app.js'), 'utf8'),
    fs.readFile(path.join(root, 'public', 'data', 'indicators.json'), 'utf8').then(JSON.parse)
  ]);
  assert.equal(indicators.length, 6);
  assert.equal(indicators.some(item => item.id === 'soxx_price'), false);
  assert.match(app, /optional: true/);
  assert.match(app, /drawdownDatasetCache\.get\(id\)\.length >= 2/);
  assert.match(app, /id === primaryId \? ' disabled'/);
  for (const preset of ['1Y', '3Y', '5Y', '10Y', '15Y', '20Y', 'ALL']) assert.match(app, new RegExp(`'${preset}'`));
});
