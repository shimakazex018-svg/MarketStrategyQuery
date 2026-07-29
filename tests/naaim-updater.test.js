'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { NaaimOfficialUpdater, discoverOfficialWorkbookLink, categoryFor, isoWeek } = require('../server/data-sources/naaim-official-updater');
const { MarketDataScheduler } = require('../server/market-data/scheduler');

test('NAAIM official discovery accepts only the explicit official HTTPS workbook link', () => {
  const html = '<a href="/wp-content/uploads/2026/08/USE_Data-since-Inception_2026-08-05.xlsx">Download EXCEL file with data since inception</a>';
  assert.equal(discoverOfficialWorkbookLink(html), 'https://naaim.org/wp-content/uploads/2026/08/USE_Data-since-Inception_2026-08-05.xlsx');
  assert.throws(() => discoverOfficialWorkbookLink('<a href="https://example.test/a.xlsx">Download EXCEL file with data since inception</a>'), /official HTTPS/);
  assert.throws(() => discoverOfficialWorkbookLink('<p>subscription only</p>'), /no workbook link/);
});

test('NAAIM access categories do not retry around authentication or subscription controls', () => {
  assert.equal(categoryFor({ status: 401 }, ''), 'authentication_required');
  assert.equal(categoryFor({ status: 403 }, 'subscribe now'), 'subscription_required');
  assert.equal(categoryFor({ status: 429 }, ''), 'rate_limited');
  assert.equal(isoWeek(new Date('2026-07-31T00:00:00Z')), '2026-W31');
});

test('production scheduler invokes NAAIM only on the Friday/Saturday weekly window', async () => {
  const calls = []; const updater = { due: async () => true };
  const service = { productionMode: true, productionCoordinator: { naaimUpdater: updater }, updateNaaimOfficial: async input => calls.push(input), indicators: [], refresh: async () => {}, config: {} };
  const scheduler = new MarketDataScheduler(service, { now: () => new Date('2026-07-31T00:00:00Z'), timezone: 'Asia/Shanghai' });
  await scheduler.tickNaaimWeekly(new Date('2026-07-31T00:00:00Z'), { weekday: 'Fri', hour: '07', minute: '30' });
  await scheduler.tickNaaimWeekly(new Date('2026-08-01T00:00:00Z'), { weekday: 'Sat', hour: '07', minute: '30' });
  await scheduler.tickNaaimWeekly(new Date('2026-08-02T00:00:00Z'), { weekday: 'Sun', hour: '07', minute: '30' });
  assert.deepEqual(calls, [{ trigger: 'scheduled_weekly' }, { trigger: 'scheduled_retry' }]);
});

test('NAAIM weekly state persists page limits and authentication restrictions across updater instances', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'naaim-weekly-state-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const now = () => new Date('2026-07-31T00:30:00Z'); let calls = 0; const fetchImpl = async () => { calls += 1; return new Response('subscription required', { status: 403 }); };
  const first = new NaaimOfficialUpdater({ rootDir: root, now, fetchImpl }); const firstResult = await first.update({ trigger: 'scheduled_weekly' });
  assert.equal(firstResult.result, 'subscription_required'); assert.equal(calls, 1);
  const second = new NaaimOfficialUpdater({ rootDir: root, now: () => new Date('2026-08-01T00:30:00Z'), fetchImpl }); await second.update({ trigger: 'scheduled_retry' });
  const state = await second.getState(); assert.equal(state.pageCheckCount, 2); assert.equal(state.workbookDownloadCount, 0); assert.equal(state.updatedThisWeek, false); assert.ok(state.lastAttemptAt); assert.equal(await second.due(), false);
});

test('NAAIM updater file lock makes concurrent scheduled, startup, and CLI calls return already_running', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'naaim-weekly-lock-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  let release; const delayed = new Promise(resolve => { release = resolve; }); const fetchImpl = async () => { await delayed; return new Response('', { status: 401 }); };
  const updater = new NaaimOfficialUpdater({ rootDir: root, now: () => new Date('2026-07-31T00:30:00Z'), fetchImpl }); const active = updater.update({ trigger: 'scheduled_weekly' });
  await new Promise(resolve => setTimeout(resolve, 10)); const concurrent = await updater.update({ trigger: 'startup_catchup' }); assert.equal(concurrent.result, 'already_running'); release(); assert.equal((await active).result, 'authentication_required');
});
