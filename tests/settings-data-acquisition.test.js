'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AcquisitionAudit, MAX_RECORDS } = require('../server/market-data/acquisition-audit');
const { createHttpServer } = require('../server');

test('acquisition audit is bounded, sanitizes metadata, and isolates corrupt files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-audit-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const audit = new AcquisitionAudit(root, { now: () => new Date('2099-01-03T00:00:00Z') });
  for (let index = 0; index < MAX_RECORDS + 5; index += 1) await audit.append({ providerId: 'fred', metricId: 'vix', trigger: 'scheduled', completedAt: '2099-01-03T00:00:00Z', result: 'success', externalRequestCount: 1, errorCategory: '../../secret token' });
  const records = await audit.read();
  assert.equal(records.length, MAX_RECORDS); assert.doesNotMatch(records[0].errorCategory, /[/.\s]/);
  await fs.writeFile(audit.filePath, '{broken', 'utf8');
  assert.deepEqual(await audit.read(), []);
  assert.equal((await fs.readdir(path.dirname(audit.filePath))).some(name => name.includes('.corrupt-')), true);
});

test('settings status endpoint is read-only and never invokes refresh', async t => {
  let refreshCalls = 0; let statusCalls = 0;
  const payload = { summary: { enabledProviderCount: 3, enabledDatasetCount: 7, realtimeProviderCount: 0 }, providers: [{ providerId: 'fred' }], datasets: [{ metricId: 'vix' }], recentRuns: [], storage: { runtimeDataIgnored: true, gitTracksRealMarketData: false, rawHtmlStored: false, cookiesOrTokensUsed: false, externalApiExposed: false } };
  const service = { getDataAcquisitionStatus: async () => { statusCalls += 1; return payload; }, refresh: async () => { refreshCalls += 1; } };
  const server = createHttpServer(service); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/settings/data-acquisition`);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), payload); assert.equal(statusCalls, 1); assert.equal(refreshCalls, 0);
});

test('settings frontend contracts retain a named settings route and internal-only refresh', async () => {
  const root = path.join(__dirname, '..'); const app = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8'); const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(html, /href="#\/settings"[^>]*aria-label="设置"/); assert.match(app, /route === '\/settings'/); assert.match(app, /\/api\/settings\/data-acquisition/); assert.match(app, /setInterval\(\(\) => void loadSettingsStatus\(\), 60_000\)/); assert.match(app, /clearSettingsPolling/);
});
