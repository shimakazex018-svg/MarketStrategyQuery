'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { discoverOfficialWorkbookLink, categoryFor, isoWeek } = require('../server/data-sources/naaim-official-updater');
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
