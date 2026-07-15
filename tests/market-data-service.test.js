'use strict';

const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { CacheStore } = require('../server/market-data/cache-store');
const { BoundedLogger } = require('../server/market-data/logger');
const { RequestLimiter } = require('../server/market-data/request-limiter');
const { MarketDataService } = require('../server/market-data/service');
const { MarketDataScheduler } = require('../server/market-data/scheduler');

const rootDir = path.join(__dirname, '..');
const validCsv = 'DATE,OPEN,HIGH,LOW,CLOSE\n01/02/2024,10,11,9,10.5\n01/03/2024,11,12,10,11.5\n01/04/2024,12,13,11,12.5\n';
const legacyIndicators = [
  { id: 'pe', name: 'QQQ PE', value: 31.8, unit: 'x', dataMode: 'demo', demoSource: 'fixture', demoMessage: 'fixture' },
  { id: 'forward-pe', name: 'Forward PE', value: 27.1, unit: 'x', dataMode: 'demo', demoSource: 'fixture', demoMessage: 'fixture' },
  { id: 'vix', name: 'VIX', unit: '', dataMode: 'unavailable' },
  { id: 'vxn', name: 'VXN', unit: '', dataMode: 'unavailable' },
  { id: 'fear-greed', name: 'Fear Greed', value: 50, unit: '/100', dataMode: 'demo', demoSource: 'fixture', demoMessage: 'fixture' },
  { id: 'manager-exposure', name: 'Manager Exposure', value: 50, unit: '/100', dataMode: 'demo', demoSource: 'fixture', demoMessage: 'fixture' }
];

function providerRegistry({ complianceStatus = 'approved', conditionsSatisfied = true, enabled = true } = {}) {
  return {
    schemaVersion: 1,
    providers: [{ providerId: 'cboe', complianceStatus, conditionsSatisfied, enabled }]
  };
}

async function createService(t, { permission = true, fetchImpl, now = () => new Date('2026-07-14T00:00:00Z') } = {}) {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'market-service-test-'));
  t.after(() => fs.rm(runtimeDir, { recursive: true, force: true }));
  const config = {
    enabled: true, timezone: 'Asia/Shanghai', requestTimeoutMs: 50, connectTimeoutMs: 20,
    maxAttemptsPerDay: 4, manualRefreshCooldownMinutes: 30, providerDailyLimit: 20,
    runtimeDir, providerRegistry: providerRegistry(), permissions: { cboe: permission }, fredApiKeyConfigured: false
  };
  const store = new CacheStore(runtimeDir);
  const limiter = new RequestLimiter(store, config, now);
  const logger = new BoundedLogger(store.logsDir, { maxBytes: 8_000, generations: 2 });
  const service = new MarketDataService({ rootDir, config, cacheStore: store, limiter, logger, definitions: legacyIndicators, fetchImpl, now });
  await service.init({ startupRefresh: false });
  return { service, store, limiter };
}

test('unapproved sources are unavailable while unrelated cards remain demo', async t => {
  const { service } = await createService(t, { permission: false });
  assert.equal(service.getIndicator('vix').status, 'unavailable');
  assert.equal(service.getIndicator('vxn').status, 'unavailable');
  assert.equal(service.getIndicator('pe').status, 'demo');
  assert.equal(service.getIndicators().length, 6);
  assert.equal(service.getStatus().fredApiKeyConfigured, false);
});

test('unapproved sources do not expose a previously written online cache', async t => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'market-license-test-'));
  t.after(() => fs.rm(runtimeDir, { recursive: true, force: true }));
  const config = {
    enabled: true, timezone: 'Asia/Shanghai', requestTimeoutMs: 50, connectTimeoutMs: 20,
    maxAttemptsPerDay: 4, manualRefreshCooldownMinutes: 30, providerDailyLimit: 20,
    runtimeDir, providerRegistry: providerRegistry(), permissions: { cboe: false }, fredApiKeyConfigured: false
  };
  const store = new CacheStore(runtimeDir);
  await store.init();
  await store.writeIndicator('vix', {
    id: 'vix', name: 'VIX', value: 12.5, unit: '', asOfDate: '2024-01-04',
    source: 'Cboe', sourceUrl: 'https://example.invalid', sourceType: 'official-csv',
    status: 'fresh', isDemo: false, history: [{ date: '2024-01-04', value: 12.5 }],
    availableRanges: ['1M'], lastAttemptAt: null, lastSuccessAt: '2024-01-04T00:00:00.000Z',
    nextAllowedAt: null, errorType: null, statusMessage: 'cached'
  });
  const limiter = new RequestLimiter(store, config);
  const logger = new BoundedLogger(store.logsDir);
  const service = new MarketDataService({ rootDir, config, cacheStore: store, limiter, logger, definitions: legacyIndicators });
  await service.init({ startupRefresh: false });
  assert.equal(service.getIndicator('vix').status, 'unavailable');
  assert.equal(service.getIndicator('vix').value, null);
});

test('successful fetch becomes fresh and unchanged data is not appended', async t => {
  const { service } = await createService(t, { fetchImpl: async () => new Response(validCsv, { status: 200 }) });
  const first = await service.refresh('vix');
  assert.equal(first.ok, true);
  assert.equal(first.indicator.status, 'fresh');
  assert.equal(first.indicator.value, 12.5);
  const second = await service.refresh('vix');
  assert.equal(second.ok, true);
  assert.equal(second.unchanged, true);
  assert.equal(service.models.get('vix').history.length, 3);
});

test('runtime permission cannot bypass a pending provider compliance decision', async t => {
  const { service } = await createService(t, { permission: true });
  service.config.providerRegistry = providerRegistry({
    complianceStatus: 'pending_written_confirmation',
    conditionsSatisfied: false,
    enabled: false
  });
  assert.equal(service.isApproved('vix'), false);
  const result = await service.refresh('vix');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'source-not-approved');
});

test('failure keeps old cache stale and no-cache failure returns error without affecting other indicators', async t => {
  const { service } = await createService(t, { fetchImpl: async () => new Response(validCsv, { status: 200 }) });
  await service.refresh('vix');
  service.sources.get('vix').fetch = async () => { const error = new Error('offline'); error.marketDataType = 'network'; throw error; };
  const stale = await service.refresh('vix');
  assert.equal(stale.indicator.status, 'stale');
  assert.equal(stale.indicator.value, 12.5);

  service.sources.get('vxn').fetch = async () => { const error = new Error('offline'); error.marketDataType = 'network'; throw error; };
  const failed = await service.refresh('vxn');
  assert.equal(failed.indicator.status, 'error');
  assert.equal(failed.indicator.value, null);
  assert.equal(service.getIndicator('pe').status, 'demo');
});

test('corrupt cache does not prevent offline service startup', async t => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'market-corrupt-test-'));
  t.after(() => fs.rm(runtimeDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(runtimeDir, 'latest'), { recursive: true });
  await fs.writeFile(path.join(runtimeDir, 'latest', 'vix.json'), '{bad', 'utf8');
  const config = { enabled: true, timezone: 'Asia/Shanghai', requestTimeoutMs: 10, maxAttemptsPerDay: 4, manualRefreshCooldownMinutes: 30, providerDailyLimit: 20, runtimeDir, providerRegistry: providerRegistry(), permissions: { cboe: true }, fredApiKeyConfigured: false };
  const store = new CacheStore(runtimeDir);
  const limiter = new RequestLimiter(store, config);
  const logger = new BoundedLogger(store.logsDir);
  const service = new MarketDataService({ rootDir, config, cacheStore: store, limiter, logger, definitions: legacyIndicators });
  await service.init({ startupRefresh: false });
  assert.equal(service.getIndicator('vix').status, 'error');
  assert.equal(service.getStatus().cacheErrors.vix.type, 'cache-corrupt');
});

test('weekend scheduler does not fetch and stop releases its timer', async t => {
  const { service } = await createService(t, { fetchImpl: async () => new Response(validCsv, { status: 200 }) });
  const calls = [];
  service.refresh = async id => { calls.push(id); };
  const scheduler = new MarketDataScheduler(service, { now: () => new Date('2026-07-12T00:00:00Z'), intervalMs: 5 });
  await scheduler.tick();
  assert.equal(calls.length, 0);
  scheduler.start();
  scheduler.stop();
  assert.equal(scheduler.timer, null);
});

test('weekend startup does not fetch an expired or missing source', async t => {
  let calls = 0;
  const weekend = () => new Date('2026-07-12T00:00:00Z');
  const { service } = await createService(t, {
    now: weekend,
    fetchImpl: async () => { calls += 1; return new Response(validCsv, { status: 200 }); }
  });
  await service.refreshExpiredOnStartup();
  assert.equal(calls, 0);
  assert.equal(service.getIndicator('vix').status, 'error');
});

test('scheduler resets persistent daily budgets before the next weekday run', async t => {
  let current = new Date('2026-07-13T00:00:00Z');
  const { service, limiter } = await createService(t, { now: () => current, fetchImpl: async () => new Response(validCsv, { status: 200 }) });
  await limiter.recordAttempt('vix', 'cboe', 'scheduled', current);
  current = new Date('2026-07-14T00:00:00Z');
  const calls = [];
  service.refresh = async id => { calls.push(id); };
  const scheduler = new MarketDataScheduler(service, { now: () => current });
  await scheduler.tick();
  assert.deepEqual(calls.sort(), ['vix', 'vxn']);
  assert.equal(limiter.snapshot().day, '2026-07-14');
});

test('self-calculated scheduler separates weekday SEC and Saturday CFTC checks', async () => {
  const calls = [];
  const service = {
    config: { selfCalculatedMvp: true },
    limiter: { ensureDay: async () => {}, snapshot: () => ({ indicators: {} }) },
    isApproved: () => true,
    refresh: async (id, options) => { calls.push({ id, source: options.requestSource }); }
  };
  let current = new Date('2026-07-11T00:00:00Z');
  const scheduler = new MarketDataScheduler(service, { timezone: 'Asia/Shanghai', now: () => current });
  await scheduler.tick();
  await scheduler.tick();
  assert.deepEqual(calls, [{ id: 'nasdaq-cot-positioning', source: 'weekly-cftc-tff' }]);
  current = new Date('2026-07-13T00:00:00Z');
  await scheduler.tick();
  assert.deepEqual(calls.at(-1), { id: 'pe', source: 'daily-sec-bulk' });
});

test('self-calculated external providers allow at most one request attempt per day', async () => {
  const config = {
    selfCalculatedMvp: true,
    enabled: true,
    permissions: { cftc: true },
    providerRegistry: { providers: [{ providerId: 'cftc', complianceStatus: 'approved', enabled: true }] }
  };
  const limiter = { ensureDay: async () => {}, snapshot: () => ({ indicators: { 'nasdaq-cot-positioning': { attempts: 1 } } }) };
  const service = new MarketDataService({ rootDir, config, cacheStore: {}, limiter, logger: {} });
  service.indicators = [{ id: 'nasdaq-cot-positioning', name: 'CFTC fixture' }];
  service.sources.set('nasdaq-cot-positioning', { provider: 'cftc' });
  service.models.set('nasdaq-cot-positioning', { id: 'nasdaq-cot-positioning', value: null, asOf: null, status: 'unavailable', history: [] });
  const result = await service.refreshSelfCalculated('nasdaq-cot-positioning');
  assert.equal(result.statusCode, 429);
  assert.equal(result.reason, 'source-daily-limit');
});
