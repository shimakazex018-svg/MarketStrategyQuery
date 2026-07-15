'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { SecCompanyFactsBulkSource, cikFileName, secUserAgent } = require('../server/data-sources/sec-companyfacts-bulk');
const { listZipEntries, readSelectedJsonEntries, safeEntryName } = require('../server/data-sources/zip-reader');

function syntheticZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const compressed = zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

test('bounded ZIP reader lists and extracts only selected SEC-style JSON entries', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-zip-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const zipPath = path.join(root, 'companyfacts.zip');
  const apple = { cik: 320193, entityName: 'Synthetic Apple', facts: {} };
  await fs.writeFile(zipPath, syntheticZip({
    [cikFileName('320193')]: JSON.stringify(apple),
    'CIK0000000002.json': JSON.stringify({ cik: 2 })
  }));
  const entries = await listZipEntries(zipPath);
  assert.equal(entries.length, 2);
  const selected = await readSelectedJsonEntries(zipPath, [cikFileName('320193')]);
  assert.equal(selected.selectedCount, 1);
  assert.deepEqual(selected.values.get(cikFileName('320193')), apple);
  assert.throws(() => safeEntryName('../escape.json'), /unsafe/);
});

test('SEC source requires a contact email and does not request when configuration is missing', async () => {
  let calls = 0;
  const source = new SecCompanyFactsBulkSource({
    runtimeDir: os.tmpdir(),
    fetchImpl: async () => { calls += 1; throw new Error('must not fetch'); },
    app: 'MarketStrategyQuery'
  });
  assert.equal(secUserAgent({ app: 'MarketStrategyQuery', email: '' }), null);
  assert.deepEqual(await source.fetchForTickers(['AAPL']), {
    status: 'unavailable', reason: 'sec_user_agent_missing', requested: false
  });
  assert.equal(calls, 0);
});

test('SEC bulk source downloads once per day, validates ZIP and extracts mapped holdings', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-source-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const payload = { cik: 320193, entityName: 'Synthetic issuer', facts: { 'us-gaap': {} } };
  const zip = syntheticZip({ [cikFileName('320193')]: JSON.stringify(payload) });
  let calls = 0;
  const source = new SecCompanyFactsBulkSource({
    runtimeDir: root,
    app: 'MarketStrategyQuery',
    email: 'local-test@example.invalid',
    requestTimeoutMs: 5_000,
    maxBytes: 1_000_000,
    fetchImpl: async url => {
      calls += 1;
      if (url.endsWith('company_tickers.json')) {
        return new Response(JSON.stringify({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Synthetic issuer' } }), {
          status: 200, headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(zip, { status: 200, headers: { 'content-length': String(zip.length), 'content-type': 'application/zip' } });
    }
  });
  const now = new Date('2026-07-15T00:00:00Z');
  const result = await source.fetchForTickers(['AAPL', 'MISSING'], { now });
  assert.equal(result.status, 'fresh');
  assert.equal(result.manifest.extractedTickers, 1);
  assert.deepEqual(result.manifest.missingTickers, ['MISSING']);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'normalized', 'sec-companyfacts', 'AAPL.json'), 'utf8')), payload);
  const unchanged = await source.fetchForTickers(['AAPL'], { now });
  assert.equal(unchanged.status, 'unchanged');
  assert.equal(calls, 2);
});

module.exports = { syntheticZip };
