'use strict';

const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { CacheStore } = require('../server/market-data/cache-store');
const { parseCboeCsv, createCboeHistorySource } = require('../server/data-sources/cboe-history');
const { RequestLimiter } = require('../server/market-data/request-limiter');
const { isTrustedAddress } = require('../server/market-data/http-api');

const fixtureDir = path.join(__dirname, 'fixtures', 'market-data');

async function tempStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'market-data-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new CacheStore(dir);
  await store.init();
  return store;
}

function config(overrides = {}) {
  return {
    timezone: 'Asia/Shanghai', maxAttemptsPerDay: 4,
    manualRefreshCooldownMinutes: 30, providerDailyLimit: 20,
    ...overrides
  };
}

test('cache writes atomically and isolates a corrupt indicator file', async t => {
  const store = await tempStore(t);
  await store.writeIndicator('vix', { id: 'vix', value: 12 });
  assert.equal((await store.readIndicator('vix')).data.value, 12);
  await fs.writeFile(path.join(store.latestDir, 'vxn.json'), '{broken', 'utf8');
  const corrupt = await store.readIndicator('vxn');
  assert.equal(corrupt.data, null);
  assert.equal(corrupt.error.type, 'cache-corrupt');
  assert.equal((await store.readIndicator('vix')).data.value, 12);
});

test('Cboe parser accepts valid CSV and rejects empty, changed, and abnormal formats', async () => {
  const valid = parseCboeCsv(await fs.readFile(path.join(fixtureDir, 'cboe-valid.csv'), 'utf8'));
  assert.equal(valid.length, 3);
  assert.equal(valid.at(-1).value, 16.75);
  for (const file of ['cboe-empty.csv', 'cboe-malformed.csv', 'cboe-abnormal.csv']) {
    assert.throws(() => parseCboeCsv(require('fs').readFileSync(path.join(fixtureDir, file), 'utf8')));
  }
});

test('source classifies 404, 429, timeout, and empty data', async () => {
  for (const [status, expected] of [[404, 'http-404'], [429, 'http-429']]) {
    const source = createCboeHistorySource('vix', { fetchImpl: async () => new Response('', { status }), requestTimeoutMs: 50 });
    await assert.rejects(source.fetch(), error => error.marketDataType === expected);
  }
  const empty = createCboeHistorySource('vix', { fetchImpl: async () => new Response('DATE,OPEN,HIGH,LOW,CLOSE\n', { status: 200 }), requestTimeoutMs: 50 });
  await assert.rejects(empty.fetch(), error => error.marketDataType === 'validation');
  const timeout = createCboeHistorySource('vix', {
    requestTimeoutMs: 5,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  });
  await assert.rejects(timeout.fetch(), error => error.marketDataType === 'timeout');
});

test('limiter persists retry delays, daily limits, manual cooldown, and locks', async t => {
  const store = await tempStore(t);
  let current = new Date('2026-07-14T00:00:00Z');
  const limiter = new RequestLimiter(store, config(), () => current);
  await limiter.init();
  assert.equal(limiter.begin('vix'), true);
  assert.equal(limiter.begin('vix'), false);
  limiter.end('vix');

  await limiter.recordAttempt('vix', 'cboe', 'manual', current);
  const failed = await limiter.recordFailure('vix', 'timeout', current);
  assert.equal(failed.nextAllowedAt, '2026-07-14T00:15:00.000Z');
  assert.equal((await limiter.canAttempt('vix', 'cboe', 'manual', current)).reason, 'cooldown');
  current = new Date('2026-07-14T00:31:00Z');
  assert.equal((await limiter.canAttempt('vix', 'cboe', 'manual', current)).ok, true);

  const restarted = new RequestLimiter(store, config(), () => current);
  await restarted.init();
  assert.equal(restarted.snapshot().indicators.vix.attempts, 1);
  assert.equal(restarted.snapshot().providers.cboe, 1);
});

test('limiter enforces provider and indicator request budgets', async t => {
  const store = await tempStore(t);
  const now = new Date('2026-07-14T00:00:00Z');
  const limiter = new RequestLimiter(store, config({ maxAttemptsPerDay: 1, providerDailyLimit: 1 }), () => now);
  await limiter.init();
  await limiter.recordAttempt('vix', 'cboe', 'scheduled', now);
  assert.equal((await limiter.canAttempt('vix', 'cboe', 'scheduled', now)).reason, 'indicator-daily-limit');
  assert.equal((await limiter.canAttempt('vxn', 'cboe', 'scheduled', now)).reason, 'provider-daily-limit');
});

test('trusted network check ignores spoofable headers and accepts local address ranges', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:192.168.31.153', '10.0.0.2', '172.20.0.1', 'fd00::1', 'fe80::1']) assert.equal(isTrustedAddress(address), true);
  for (const address of ['8.8.8.8', '172.32.0.1', '2001:4860:4860::8888']) assert.equal(isTrustedAddress(address), false);
});
