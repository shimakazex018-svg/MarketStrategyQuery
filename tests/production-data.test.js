'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { FredProvider, parseFredCsv } = require('../server/data-sources/fred-provider');
const { mergePeSnapshot, parseWorldPERatioPage } = require('../server/data-sources/worldperatio-production');
const { ANALYSIS_METRIC_IDS, PRODUCTION_METRIC_IDS, ProductionDataCoordinator } = require('../server/production-data/coordinator');
const { createHttpServer } = require('../server');
const { MarketDataService } = require('../server/market-data/service');
const { MarketDataScheduler } = require('../server/market-data/scheduler');
const { validateFred, validatePe, validateSnapshots } = require('../tools/market-data/import-successful-data');

const definitions = PRODUCTION_METRIC_IDS.map(id => ({ id, name: id, unit: id.endsWith('_pe') ? 'x' : '' }));
async function write(filePath, value) { await fs.mkdir(path.dirname(filePath), { recursive: true }); await fs.writeFile(filePath, `${JSON.stringify(value)}\n`); }

async function fixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'production-data-test-')); const production = path.join(root, 'runtime-data', 'market-data', 'production');
  const fredValues = [{ date: '2098-12-31', value: null }, { date: '2099-01-01', value: 10 }, { date: '2099-01-02', value: 11 }];
  for (const [file, seriesId] of [['vix', 'VIXCLS'], ['vxn', 'VXNCLS'], ['nasdaq100', 'NASDAQ100'], ['sp500', 'SP500']]) await write(path.join(production, 'fred', `${file}.json`), { provider: 'FRED', seriesId, fetchedAt: '2099-01-03T00:00:00Z', values: fredValues });
  for (const [key, label] of [['nasdaq100', 'Nasdaq-100'], ['sp500', 'S&P 500']]) {
    await write(path.join(production, 'worldperatio', `${key}-pe.json`), { provider: 'WorldPEratio', target: label, currentPE: 25, sourceDataDate: '2099-01-02', fetchedAt: '2099-01-03T00:00:00Z', historicalStatistics: { '1y': { average: 20, standardDeviation: 2 }, '5y': { average: 19, standardDeviation: 3 }, '10y': { average: 18, standardDeviation: 4 }, '20y': { average: 17, standardDeviation: 5 } }, valuationLabel: 'synthetic', sourceUrl: 'https://example.invalid' });
    await write(path.join(production, 'snapshots', `${key}-pe-history.json`), [{ sourceDataDate: '2099-01-02', value: 25, fetchedAt: '2099-01-03T00:00:00Z' }]);
  }
  await write(path.join(production, 'state', 'fred-state.json'), { provider: 'FRED', metrics: {} }); await write(path.join(production, 'state', 'worldperatio-state.json'), { provider: 'WorldPEratio', metrics: {} });
  await write(path.join(production, 'etf', 'soxx.json'), { metricId: 'soxx_price', symbol: 'SOXX', name: 'iShares Semiconductor ETF', provider: 'iShares / BlackRock', seriesType: 'nav', adjustmentStatus: 'provider_adjusted', currency: 'USD', sourceUrl: 'https://www.ishares.com/us/products/239705/SOXX', fetchedAt: '2099-01-03T00:00:00Z', firstDate: '2099-01-01', lastDate: '2099-01-02', rowCount: 2, limitations: ['synthetic test fixture'], values: [{ date: '2099-01-01', value: 100 }, { date: '2099-01-02', value: 101 }] });
  return root;
}

test('production coordinator keeps six public metrics plus the isolated SOXX analysis metric', async t => {
  const root = await fixtureRoot(); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const coordinator = await new ProductionDataCoordinator({ rootDir: root, definitions, now: () => new Date('2099-01-03T00:00:00Z') }).init();
  assert.deepEqual([...coordinator.models.keys()], [...PRODUCTION_METRIC_IDS, ...ANALYSIS_METRIC_IDS]);
  assert.equal(coordinator.models.get('vix').history.length, 2);
  assert.equal(coordinator.models.get('nasdaq100_pe').history.length, 1);
  assert.equal(coordinator.models.get('nasdaq100_pe').historicalStatistics['1y'].average, 20);
  assert.equal(coordinator.models.has('forward-pe'), false);
  assert.equal(coordinator.models.get('soxx_price').seriesType, 'nav');
});

test('production API provides summary, detail and history without paths or internal stacks', async t => {
  const root = await fixtureRoot(); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const coordinator = await new ProductionDataCoordinator({ rootDir: root, definitions, now: () => new Date('2099-01-03T00:00:00Z') }).init();
  const service = { getStatus: () => ({ mode: 'production-six-metrics' }), getIndicators: () => PRODUCTION_METRIC_IDS.map(id => coordinator.models.get(id)), getIndicator: id => coordinator.models.get(id) || null, refresh: async () => ({ ok: false }) };
  const server = createHttpServer(service); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const summary = await fetch(`${base}/api/market-data/summary`).then(response => response.json()); assert.equal(summary.indicators.length, 6);
  const detail = await fetch(`${base}/api/market-data/metrics/vix`).then(response => response.json()); assert.equal(detail.id, 'vix');
  const history = await fetch(`${base}/api/market-data/metrics/vix/history`).then(response => response.json()); assert.equal(history.history.length, 2);
  const soxx = await fetch(`${base}/api/market-data/metrics/soxx_price`).then(response => response.json()); assert.equal(soxx.seriesType, 'nav');
  assert.doesNotMatch(JSON.stringify({ summary, detail, history }), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(JSON.stringify({ summary, detail, history }), /stack|sha256|contentHash/i);
});

test('FRED parser preserves missing values and provider enforces same-day success budget', async t => {
  const parsed = parseFredCsv('observation_date,VIXCLS\n2099-01-01,.\n2099-01-02,12.5\n', 'VIXCLS', '2099-01-03T00:00:00Z'); assert.equal(parsed.values[0].value, null);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fred-provider-test-')); t.after(() => fs.rm(root, { recursive: true, force: true })); let requests = 0;
  const provider = await new FredProvider({ productionRoot: root, now: () => new Date('2099-01-03T00:00:00Z'), fetchImpl: async () => { requests += 1; return new Response('observation_date,VIXCLS\n2099-01-02,12.5\n'); }, sleep: async () => {} }).init();
  assert.equal((await provider.refresh('vix')).ok, true); assert.equal((await provider.refresh('vix')).reason, 'already-successful-today'); assert.equal(requests, 1);
});

test('WorldPEratio parser separates statistics from snapshots and records same-date revisions', () => {
  const html = '<h1>Nasdaq-100</h1><p>P/E Ratio 25.5 2 January 2099</p><p>Last 1Y 20 2</p><p>Last 5Y 19 3</p><p>Last 10Y 18 4</p><p>Last 20Y 17 5</p><p>current P/E can be considered Fair</p>';
  const parsed = parseWorldPERatioPage(html, { key: 'nasdaq100', url: 'https://example.invalid', targetPattern: /Nasdaq-100/ }, '2099-01-03T00:00:00Z');
  assert.equal(parsed.historicalStatistics['1y'].average, 20); assert.equal(Object.hasOwn(parsed, 'history'), false);
  const merged = mergePeSnapshot([{ sourceDataDate: '2099-01-02', value: 25 }], { sourceDataDate: '2099-01-02', value: 26, fetchedAt: '2099-01-03T00:00:00Z' }); assert.equal(merged.revisions.length, 1); assert.equal(merged.points.length, 1);
  assert.equal(merged.points[0].revisions[0].previousValue, 25);
});

test('offline import validators reject conflicts and never convert null to zero', () => {
  const fred = validateFred({ seriesId: 'VIXCLS', fetchedAt: '2099-01-03T00:00:00Z', values: [{ date: '2099-01-01', value: null }, { date: '2099-01-02', value: 12 }] }, 'VIXCLS'); assert.equal(fred.values[0].value, null);
  const pe = validatePe({ sourceDataDate: '2099-01-02', currentPE: 25, average1Y: 20, stdDev1Y: 2, average5Y: 19, stdDev5Y: 3, average10Y: 18, stdDev10Y: 4, average20Y: 17, stdDev20Y: 5 }, 'Synthetic'); assert.equal(pe.historyType, 'snapshot_history');
  assert.throws(() => validateSnapshots([{ sourceDataDate: '2099-01-02', value: 25 }, { sourceDataDate: '2099-01-02', value: 26 }], 'Synthetic'), /conflicts/);
});

test('frontend publishes only six current metrics and disables legacy indicator routes', async () => {
  const root = path.join(__dirname, '..'); const indicators = JSON.parse(await fs.readFile(path.join(root, 'public', 'data', 'indicators.json'), 'utf8')); const app = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.deepEqual(indicators.map(item => item.id), PRODUCTION_METRIC_IDS);
  for (const hidden of ['Forward PE', 'QQQ RV20', '自建风险偏好', '机构仓位']) assert.equal(indicators.some(item => item.name.includes(hidden)), false);
  assert.match(app, /function indicatorInfoMeta\(/); assert.match(app, /metric-info-button/); assert.match(app, /数据来源与口径/);
  assert.match(app, /interactive-history-chart/); assert.match(app, /pointermove/); assert.match(app, /indicator-dialog-portal/);
});

test('one provider failure marks only its metric stale', async t => {
  const root = await fixtureRoot(); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const coordinator = await new ProductionDataCoordinator({ rootDir: root, definitions, now: () => new Date('2099-01-03T00:00:00Z') }).init();
  coordinator.fred.state.metrics.vix = { lastError: { type: 'network-error', at: '2099-01-03T00:00:00Z' } }; await coordinator.reload();
  assert.equal(coordinator.models.get('vix').status, 'stale'); assert.equal(coordinator.models.get('vxn').status, 'fresh'); assert.equal(coordinator.models.get('nasdaq100_pe').status, 'fresh');
});

test('production scheduler runs six network metrics then only the local SOXX reload after 07:30', async () => {
  const calls = []; const service = { productionMode: true, indicators: definitions, refresh: async id => { calls.push(id); }, config: {} };
  const scheduler = new MarketDataScheduler(service, { now: () => new Date('2099-01-03T00:00:00Z'), timezone: 'Asia/Shanghai' });
  await scheduler.tick(); await scheduler.tick(); assert.deepEqual(calls, [...PRODUCTION_METRIC_IDS, 'soxx_price']);
  const startupCalls = [];
  await MarketDataService.prototype.refreshExpiredOnStartup.call({ productionMode: true, config: { timezone: 'Asia/Shanghai' }, now: () => new Date('2099-01-03T00:00:00Z'), refresh: async id => { startupCalls.push(id); } });
  assert.deepEqual(startupCalls, [...PRODUCTION_METRIC_IDS, ...ANALYSIS_METRIC_IDS]);
});
