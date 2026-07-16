'use strict';

const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { createHttpServer } = require('../server');
const { calculatePeHistoryStats } = require('../server/derived-indicators/pe-history-statistics');
const { evaluateRobotsResponse, isPathAllowed } = require('../server/data-sources/web-pages/robots-check');
const { fetchPublicPage } = require('../server/data-sources/web-pages/public-page-fetcher');
const { extractWorldPERatio, sha256 } = require('../server/data-sources/web-pages/extraction-validator');
const { loadSnapshotHistory, mergeSnapshot, persistSnapshotHistory } = require('../server/data-sources/web-pages/snapshot-history');
const { WorldPERatioProvider } = require('../server/data-sources/web-pages/worldperatio');

// Synthetic fixture only: values and dates are intentionally unrelated to any live response.
function validHtml({ pe = 42.42, date = '15 January 2099', extra = '', target = true } = {}) {
  return `<!doctype html><html><head><title>Nasdaq 100</title></head><body>
    <h1>${target ? 'Nasdaq 100 Index: current P/E Ratio' : 'S&P 500 Index'}</h1>
    <div>P/E Ratio ${pe} ${date}</div>
    <p>The estimated Price-to-Earnings (P/E) Ratio for ${target ? 'Nasdaq 100' : 'S&P 500'} Index is ${pe}, calculated on ${date}.</p>
    ${target ? '<p>P/E Ratio is calculated on the QQQ Etf, whose benchmark is the Nasdaq 100 Index.</p>' : ''}
    <p>Considering the last 5 years, the current P/E can be considered Fair</p>
    <div>Last 1Y 40.10 2.20 [35.70 37.90 42.30 44.50]</div>
    <div>Last 5Y 31.11 3.33 [24.45 27.78 34.44 37.77]</div>
    <div>Last 10Y 28.22 4.44 [19.34 23.78 32.66 37.10]</div>
    <div>Last 20Y 23.33 5.55 [12.23 17.78 28.88 34.43]</div>
    ${extra}</body></html>`;
}

function registry({ complianceStatus = 'approved', enabled = true, conditionsSatisfied = null } = {}) {
  return {
    providers: [{
      providerId: 'worldperatio', providerName: 'WorldPEratio', complianceStatus,
      conditionsSatisfied: conditionsSatisfied ?? (complianceStatus === 'approved' || complianceStatus === 'approved_with_conditions'),
      selectionStatus: 'selected', enabled, riskAcceptance: 'synthetic_owner_acceptance'
    }]
  };
}

async function tempRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'worldperatio-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function typedError(type, status = null) {
  const error = new Error(`synthetic ${type}`);
  error.webPageType = type;
  error.status = status;
  return error;
}

async function makeProvider(t, {
  responses = [], complianceStatus = 'approved', enabled = true,
  conditionsSatisfied = null,
  robotsText = 'User-agent: *\nDisallow:\n', robotsStatus = 200,
  nowRef = { value: new Date('2099-01-16T01:00:00Z') }
} = {}) {
  const rootDir = await tempRoot(t);
  let calls = 0;
  let robotsCalls = 0;
  const fetchImpl = async url => {
    if (String(url).endsWith('/robots.txt')) {
      robotsCalls += 1;
      return new Response(robotsText, { status: robotsStatus });
    }
    const response = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    if (response instanceof Error) throw response;
    return response;
  };
  const provider = new WorldPERatioProvider({
    rootDir,
    providerRegistry: registry({ complianceStatus, enabled, conditionsSatisfied }),
    fetchImpl,
    now: () => nowRef.value,
    sleep: async () => {},
    retryDelayMs: 0
  });
  await provider.init();
  return { provider, rootDir, nowRef, calls: () => calls, robotsCalls: () => robotsCalls };
}

test('robots allows an empty disallow rule', () => {
  const result = isPathAllowed('User-agent: *\nDisallow:\n', 'https://worldperatio.com/index/nasdaq-100/');
  assert.equal(result.allowed, true);
  assert.equal(result.status, 'allowed');
});

test('robots blocks a matching target path', () => {
  const result = isPathAllowed('User-agent: *\nDisallow: /index/\n', 'https://worldperatio.com/index/nasdaq-100/');
  assert.equal(result.allowed, false);
  assert.equal(result.status, 'blocked');
});

test('missing robots is recorded as missing and permissive', () => {
  assert.deepEqual(evaluateRobotsResponse({ status: 404, targetUrl: 'https://worldperatio.com/index/nasdaq-100/' }), {
    status: 'missing', allowed: true, decisiveRule: null
  });
});

test('server-rendered HTML extracts the target, current PE, date and explicit historical fields', () => {
  const result = extractWorldPERatio(validHtml(), { sourceUrl: 'https://worldperatio.com/index/nasdaq-100/', extractedAt: '2099-01-16T01:00:00.000Z' });
  assert.equal(result.target, 'Nasdaq-100 reference calculated on QQQ ETF');
  assert.equal(result.currentPE, 42.42);
  assert.equal(result.sourceDataDate, '2099-01-15');
  assert.equal(result.historicalMean, 31.11);
  assert.equal(result.historicalMedian, null);
  assert.equal(result.historicalStdDev, 3.33);
  assert.equal(result.historicalRanges['10Y'].mean, 28.22);
  assert.equal(result.historicalStats['1y'].mean, 40.1);
  assert.equal(result.seriesAvailability, 'summary_statistics_only');
  assert.deepEqual(result.publishedHistory, []);
  assert.equal(result.fieldMetadata.currentPE.rawTextFragmentHash.length, 64);
});

test('JavaScript-only shell is classified as requiring browser rendering', () => {
  assert.throws(() => extractWorldPERatio('<html><body><div id="root"></div><script src="app.js"></script></body></html>'), error => error.webPageType === 'browser-required');
});

test('a non-Nasdaq-100 target is rejected', () => {
  assert.throws(() => extractWorldPERatio(validHtml({ target: false })), error => error.webPageType === 'target-not-found');
});

test('missing current PE is treated as a source structure change', () => {
  const html = '<html><body><h1>Nasdaq 100 Index: current P/E Ratio</h1><p>P/E Ratio unavailable</p><p>P/E Ratio is calculated on the QQQ Etf, whose benchmark is the Nasdaq 100 Index.</p></body></html>';
  assert.throws(() => extractWorldPERatio(html), error => error.webPageType === 'source-changed');
});

test('missing source date stops extraction', () => {
  const html = validHtml().replaceAll('42.42 15 January 2099', '42.42').replace(', calculated on 15 January 2099', '');
  assert.throws(() => extractWorldPERatio(html), error => error.webPageType === 'date-missing');
});

test('conflicting current PE candidates are ambiguous', () => {
  const html = validHtml({ extra: '<p>The estimated Price-to-Earnings (P/E) Ratio for Nasdaq 100 Index is 55.55, calculated on 15 January 2099.</p>' });
  assert.throws(() => extractWorldPERatio(html), error => error.webPageType === 'ambiguous');
});

test('extreme current PE is rejected', () => {
  assert.throws(() => extractWorldPERatio(validHtml({ pe: 600 })), error => error.webPageType === 'invalid-value');
});

test('synthetic published chart structure yields a complete dated PE series', () => {
  const script = `<script>const qqqPeChart = { labels: ['2099-01-01','2099-01-02','2099-01-03'], datasets: [{ label: 'Nasdaq 100 P/E', data: [40.1,41.2,42.42] }] };</script>`;
  const result = extractWorldPERatio(validHtml({ extra: script }));
  assert.equal(result.seriesAvailability, 'full_series_available');
  assert.deepEqual(result.publishedHistory, [
    { date: '2099-01-01', value: 40.1 },
    { date: '2099-01-02', value: 41.2 },
    { date: '2099-01-03', value: 42.42 }
  ]);
});

test('summary statistics never fabricate a historical PE series', () => {
  const result = extractWorldPERatio(validHtml());
  assert.equal(result.seriesAvailability, 'summary_statistics_only');
  assert.deepEqual(result.publishedHistory, []);
});

test('public fetcher accepts direct HTML and preserves a fixed response boundary', async () => {
  const result = await fetchPublicPage({ url: 'https://worldperatio.com/index/nasdaq-100/', allowedHosts: ['worldperatio.com'], fetchImpl: async () => new Response(validHtml(), { status: 200 }), maxBytes: 20_000 });
  assert.equal(result.status, 200);
  assert.match(result.text, /Nasdaq 100/);
});

test('public fetcher stops on 403 and 429', async () => {
  await assert.rejects(fetchPublicPage({ url: 'https://worldperatio.com/index/nasdaq-100/', allowedHosts: ['worldperatio.com'], fetchImpl: async () => new Response('forbidden', { status: 403 }) }), error => error.webPageType === 'forbidden');
  await assert.rejects(fetchPublicPage({ url: 'https://worldperatio.com/index/nasdaq-100/', allowedHosts: ['worldperatio.com'], fetchImpl: async () => new Response('slow down', { status: 429 }) }), error => error.webPageType === 'rate-limited');
});

test('public fetcher stops on login and captcha pages', async () => {
  await assert.rejects(fetchPublicPage({ url: 'https://worldperatio.com/index/nasdaq-100/', allowedHosts: ['worldperatio.com'], fetchImpl: async () => new Response('<title>Log in</title><form action="/login">', { status: 200 }) }), error => error.webPageType === 'login-required');
  await assert.rejects(fetchPublicPage({ url: 'https://worldperatio.com/index/nasdaq-100/', allowedHosts: ['worldperatio.com'], fetchImpl: async () => new Response('<div class="captcha">verify</div>', { status: 200 }) }), error => error.webPageType === 'access-challenge');
});

test('pending compliance keeps provider disabled and makes no request', async t => {
  const setup = await makeProvider(t, { responses: [new Response(validHtml())], complianceStatus: 'pending_written_confirmation', enabled: false });
  const result = await setup.provider.refresh();
  assert.equal(result.reason, 'source-not-approved');
  assert.equal(setup.calls(), 0);
  assert.equal(setup.robotsCalls(), 0);
  assert.equal(setup.provider.getStatus().enabled, false);
});

test('successful refresh stores extracted JSON and never stores complete HTML', async t => {
  const setup = await makeProvider(t, { responses: [new Response(validHtml(), { status: 200 })] });
  const result = await setup.provider.refresh();
  assert.equal(result.ok, true);
  assert.equal(result.provider.currentPE, 42.42);
  const files = await fs.readdir(setup.provider.runtimeDir);
  assert.deepEqual(files.sort(), ['history.json', 'history.last-good.json', 'latest.json', 'request-state.json']);
  const saved = await fs.readFile(setup.provider.latestPath, 'utf8');
  assert.doesNotMatch(saved, /<!doctype html>/i);
  assert.equal(JSON.parse(saved).contentHash, sha256(validHtml()));
  assert.equal(result.provider.contentHash, undefined);
  assert.equal(result.provider.fieldMetadata, undefined);
  assert.equal(setup.robotsCalls(), 1);
});

test('approved-with-conditions requires satisfied conditions before any request', async t => {
  const blocked = await makeProvider(t, {
    responses: [new Response(validHtml())], complianceStatus: 'approved_with_conditions', conditionsSatisfied: false
  });
  assert.equal((await blocked.provider.refresh()).reason, 'source-not-approved');
  assert.equal(blocked.robotsCalls(), 0);
  assert.equal(blocked.calls(), 0);

  const allowed = await makeProvider(t, {
    responses: [new Response(validHtml())], complianceStatus: 'approved_with_conditions', conditionsSatisfied: true
  });
  assert.equal((await allowed.provider.refresh()).ok, true);
  assert.equal(allowed.robotsCalls(), 1);
  assert.equal(allowed.calls(), 1);
});

test('timeout is retried once and then succeeds', async t => {
  const setup = await makeProvider(t, { responses: [typedError('total-timeout'), new Response(validHtml(), { status: 200 })] });
  const result = await setup.provider.refresh();
  assert.equal(result.ok, true);
  assert.equal(setup.calls(), 2);
  assert.equal(setup.provider.getStatus().attemptsToday, 2);
});

test('403 is not retried', async t => {
  const setup = await makeProvider(t, { responses: [new Response('forbidden', { status: 403 })] });
  const result = await setup.provider.refresh();
  assert.equal(result.reason, 'forbidden');
  assert.equal(setup.calls(), 1);
});

test('robots prohibition stops before the target request', async t => {
  const setup = await makeProvider(t, { responses: [new Response(validHtml())], robotsText: 'User-agent: *\nDisallow: /index/\n' });
  const result = await setup.provider.refresh();
  assert.equal(result.reason, 'robots-blocked');
  assert.equal(setup.robotsCalls(), 1);
  assert.equal(setup.calls(), 0);
});

test('ordinary network failure is not retried', async t => {
  const setup = await makeProvider(t, { responses: [typedError('network'), new Response(validHtml())] });
  const result = await setup.provider.refresh();
  assert.equal(result.reason, 'network');
  assert.equal(setup.calls(), 1);
});

test('daily request limit prevents a third request', async t => {
  const setup = await makeProvider(t, { responses: [typedError('connect-timeout'), typedError('total-timeout'), new Response(validHtml())] });
  const first = await setup.provider.refresh();
  assert.equal(first.ok, false);
  const second = await setup.provider.refresh();
  assert.equal(second.reason, 'source-daily-limit');
  assert.equal(setup.calls(), 2);
});

test('a successful normal request cannot be repeated on the same day', async t => {
  const setup = await makeProvider(t, { responses: [new Response(validHtml()), new Response(validHtml())] });
  assert.equal((await setup.provider.refresh()).ok, true);
  assert.equal((await setup.provider.refresh()).reason, 'source-daily-limit');
  assert.equal(setup.calls(), 1);
});

test('last successful cache becomes stale after next-day failure', async t => {
  const setup = await makeProvider(t, { responses: [new Response(validHtml()), typedError('connect-timeout'), typedError('total-timeout')] });
  assert.equal((await setup.provider.refresh()).ok, true);
  setup.nowRef.value = new Date('2099-01-17T01:00:00Z');
  assert.equal((await setup.provider.refresh()).ok, false);
  assert.equal(setup.provider.getLatest().status, 'stale');
  assert.equal(setup.provider.getLatest().currentPE, 42.42);
});

test('content hash changes when the page content changes', async t => {
  const firstHtml = validHtml();
  const secondHtml = validHtml({ pe: 43.21, date: '16 January 2099' });
  const setup = await makeProvider(t, { responses: [new Response(firstHtml), new Response(secondHtml)] });
  await setup.provider.refresh();
  const firstHash = setup.provider.latest.contentHash;
  setup.nowRef.value = new Date('2099-01-17T01:00:00Z');
  await setup.provider.refresh();
  assert.notEqual(setup.provider.latest.contentHash, firstHash);
});

test('snapshot history appends, deduplicates dates and skips unchanged values', async t => {
  const rootDir = await tempRoot(t);
  const historyPath = path.join(rootDir, 'history.json');
  const backupPath = path.join(rootDir, 'history.last-good.json');
  const first = { sourceDataDate: '2099-01-15', currentPE: 42.42, fetchedAt: '2099-01-16T01:00:00.000Z', parseVersion: 'WPR-PARSE-v1' };
  const added = mergeSnapshot([], first);
  assert.equal(added.changed, true);
  await persistSnapshotHistory({ historyPath, backupPath, points: added.points });
  assert.equal(mergeSnapshot(added.points, first).reason, 'same-source-date');
  assert.equal(mergeSnapshot(added.points, { ...first, sourceDataDate: '2099-01-16' }).reason, 'value-unchanged');
  const second = mergeSnapshot(added.points, { ...first, sourceDataDate: '2099-01-16', currentPE: 43.21 });
  assert.equal(second.changed, true);
  assert.deepEqual(second.points.map(point => point.sourceDataDate), ['2099-01-15', '2099-01-16']);
});

test('corrupt snapshot history is isolated and recovered from last-good data', async t => {
  const rootDir = await tempRoot(t);
  const historyPath = path.join(rootDir, 'history.json');
  const backupPath = path.join(rootDir, 'history.last-good.json');
  const points = [{ sourceDataDate: '2099-01-15', currentPE: 42.42, fetchedAt: '2099-01-16T01:00:00.000Z', parseVersion: 'WPR-PARSE-v1' }];
  await persistSnapshotHistory({ historyPath, backupPath, points });
  await fs.writeFile(historyPath, '{broken', 'utf8');
  const loaded = await loadSnapshotHistory({ historyPath, backupPath, now: () => new Date('2099-01-17T00:00:00Z') });
  assert.equal(loaded.recovered, true);
  assert.deepEqual(loaded.points, points);
  assert.match(path.basename(loaded.isolatedPath), /^history\.json\.corrupt-/);
});

test('external reference cache cannot overwrite the self-calculated PE cache', async t => {
  const setup = await makeProvider(t, { responses: [new Response(validHtml())] });
  const selfCache = path.join(setup.rootDir, 'runtime-data', 'market-data', 'latest', 'pe.json');
  await fs.mkdir(path.dirname(selfCache), { recursive: true });
  await fs.writeFile(selfCache, '{"algorithmVersion":"PE-Q1-RAW-v1"}\n');
  await setup.provider.refresh();
  assert.equal(JSON.parse(await fs.readFile(selfCache, 'utf8')).algorithmVersion, 'PE-Q1-RAW-v1');
});

test('Trim 10% removes one low and one high value from ten valid samples', () => {
  const result = calculatePeHistoryStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
  assert.equal(result.status, 'ok');
  assert.equal(result.excludedLowCount, 1);
  assert.equal(result.excludedHighCount, 1);
  assert.equal(result.trimmedSampleCount, 8);
  assert.equal(result.trimmedStats.mean, 5.5);
});

test('Trim 10% reports insufficient sample and filters non-positive values', () => {
  const result = calculatePeHistoryStats([1, 2, 3, 4, 5, 0, -2, Infinity]);
  assert.equal(result.status, 'insufficient_sample');
  assert.equal(result.rawSampleCount, 8);
  assert.equal(result.validSampleCount, 5);
  assert.equal(result.trimmedStats, null);
});

test('historical statistics are input-order invariant', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100, 20, 30];
  assert.deepEqual(calculatePeHistoryStats(values), calculatePeHistoryStats([...values].reverse()));
});

test('provider diagnostic API exposes status and latest without touching indicator routes', async t => {
  const service = {
    getProviderDiagnosticStatus: id => id === 'worldperatio' ? { providerId: id, enabled: false } : null,
    getProviderLatest: id => id === 'worldperatio' ? { providerId: id, status: 'unavailable' } : null,
    getProviderHistory: id => id === 'worldperatio' ? { providerId: id, snapshots: [] } : null,
    getProviderStatistics: id => id === 'worldperatio' ? { providerId: id, historicalStats: {} } : null
  };
  const server = createHttpServer(service);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const status = await fetch(`http://127.0.0.1:${address.port}/api/market-data/providers/worldperatio/status`).then(response => response.json());
  const latest = await fetch(`http://127.0.0.1:${address.port}/api/market-data/providers/worldperatio/latest`).then(response => response.json());
  const history = await fetch(`http://127.0.0.1:${address.port}/api/market-data/providers/worldperatio/history`).then(response => response.json());
  const statistics = await fetch(`http://127.0.0.1:${address.port}/api/market-data/providers/worldperatio/statistics`).then(response => response.json());
  assert.equal(status.enabled, false);
  assert.equal(latest.status, 'unavailable');
  assert.deepEqual(history.snapshots, []);
  assert.deepEqual(statistics.historicalStats, {});
  assert.doesNotMatch(JSON.stringify({ status, latest, history, statistics }), /contentHash|pageContentHash|runtime-data|rawTextFragmentHash/);
});
