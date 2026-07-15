'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CacheStore } = require('../server/market-data/cache-store');
const { SelfCalculatedCoordinator, appendHistory } = require('../server/self-calculated/coordinator');

const definitions = [
  ['pe', 'QQQ组合TTM PE', 'x'],
  ['forward-pe', 'Forward PE', 'x'],
  ['qqq-rv20', 'QQQ RV20', '%'],
  ['qqq-rv20-percentile', 'QQQ波动率分位', '%ile'],
  ['risk-appetite', '自建风险偏好', '/100'],
  ['nasdaq-cot-positioning', '纳指期货机构仓位', '% OI']
].map(([id, name, unit]) => ({ id, name, unit }));

function isoDay(start, offset) {
  return new Date(new Date(`${start}T00:00:00Z`).valueOf() + offset * 86_400_000).toISOString().slice(0, 10);
}

test('non-formal evaluation does not append a synthetic PE history point', () => {
  const previous = [{ date: '2026-06-30', value: 25.4 }];
  assert.deepEqual(appendHistory(previous, null), previous);
});

test('self-calculated coordinator stays offline and isolates missing inputs', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'self-calculated-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const runtimeRoot = path.join(rootDir, 'runtime-data');
  const cacheStore = new CacheStore(path.join(runtimeRoot, 'market-data'));
  await cacheStore.init();
  let fetchCalls = 0;
  const coordinator = new SelfCalculatedCoordinator({
    rootDir,
    runtimeRoot,
    cacheStore,
    definitions,
    config: { requestTimeoutMs: 50, sec: { bulkUpdateEnabled: false } },
    fetchImpl: async () => { fetchCalls += 1; throw new Error('network must not be used during init'); },
    now: () => new Date('2026-07-15T00:00:00Z')
  });
  await coordinator.init();
  assert.equal(fetchCalls, 0);
  assert.equal(coordinator.models.size, 6);
  assert.equal(coordinator.models.get('pe').status, 'unavailable');
  assert.equal(coordinator.models.get('nasdaq-cot-positioning').status, 'unavailable');
});

test('local prices, manual Forward PE and cached CFTC rows produce independent models', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'self-calculated-inputs-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const runtimeRoot = path.join(rootDir, 'runtime-data');
  await fs.mkdir(path.join(runtimeRoot, 'imports', 'prices'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'imports', 'forward-pe'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'sources', 'cftc'), { recursive: true });
  const priceRows = ['ticker,date,adjustedClose,sourceName,currency'];
  for (let index = 0; index < 270; index += 1) {
    const date = isoDay('2025-01-01', index);
    priceRows.push(`QQQ,${date},${(400 + index * 0.45 + Math.sin(index / 8) * 4).toFixed(4)},Local fixture,USD`);
    priceRows.push(`SOXX,${date},${(200 + index * 0.3 + Math.sin(index / 7) * 3).toFixed(4)},Local fixture,USD`);
  }
  await fs.writeFile(path.join(runtimeRoot, 'imports', 'prices', 'prices.csv'), `${priceRows.join('\n')}\n`, 'utf8');
  await fs.writeFile(path.join(runtimeRoot, 'imports', 'forward-pe', 'forward.csv'), 'value,asOf,sourceName,sourceReference,methodology,notes,enteredAt\n25.4,2025-09-27,User verified,local-note-1,forward_12_months,fixture only,2025-09-28T00:00:00Z\n', 'utf8');
  const rows = Array.from({ length: 120 }, (_, index) => ({
    contractCode: '209742', reportDate: isoDay('2023-01-03', index * 7), publishedAt: null,
    openInterest: 100000 + index * 100, assetManagerLong: 30000 + index * 30,
    assetManagerShort: 14000 + index * 5, leveragedFundsLong: 18000 + index * 10,
    leveragedFundsShort: 25000 + index * 20
  }));
  await fs.writeFile(path.join(runtimeRoot, 'sources', 'cftc', '209742.json'), JSON.stringify({
    sourceUrl: 'https://publicreporting.cftc.gov/resource/gpe5-46if.json', retrievedAt: '2025-09-30T00:00:00Z', rows
  }), 'utf8');
  const cacheStore = new CacheStore(path.join(runtimeRoot, 'market-data'));
  await cacheStore.init();
  const coordinator = new SelfCalculatedCoordinator({
    rootDir, runtimeRoot, cacheStore, definitions,
    config: { requestTimeoutMs: 50, sec: { bulkUpdateEnabled: false } },
    fetchImpl: async () => { throw new Error('unexpected external request'); },
    now: () => new Date('2025-09-28T00:00:00Z')
  });
  await coordinator.init();
  assert.equal(coordinator.models.get('pe').status, 'unavailable');
  assert.equal(coordinator.models.get('forward-pe').status, 'manual');
  assert.equal(coordinator.models.get('qqq-rv20').status, 'fresh');
  assert.equal(coordinator.models.get('qqq-rv20-percentile').status, 'fresh');
  assert.equal(coordinator.models.get('nasdaq-cot-positioning').status, 'fresh');
  assert.equal(coordinator.models.get('risk-appetite').status, 'fresh');
  assert.equal(coordinator.models.get('risk-appetite').availableCount, 7);
});
