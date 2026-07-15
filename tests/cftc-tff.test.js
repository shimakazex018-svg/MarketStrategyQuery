'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CftcTffSource, parseTffRows, queryUrl } = require('../server/data-sources/cftc-tff');

function apiRow(date, overrides = {}) {
  return {
    report_date_as_yyyy_mm_dd: `${date}T00:00:00.000`,
    cftc_contract_market_code: '209742',
    contract_market_name: 'NASDAQ-100 STOCK INDEX (MINI)',
    open_interest_all: '1000',
    asset_mgr_positions_long: '300',
    asset_mgr_positions_short: '100',
    lev_money_positions_long: '150',
    lev_money_positions_short: '250',
    ...overrides
  };
}

test('CFTC TFF parser maps official field names and rejects duplicates or invalid rows', () => {
  const parsed = parseTffRows([apiRow('2026-07-07')], { publishedAt: '2026-07-10T20:30:00.000Z' });
  assert.deepEqual(parsed[0], {
    contractCode: '209742',
    contractName: 'NASDAQ-100 STOCK INDEX (MINI)',
    reportDate: '2026-07-07',
    publishedAt: '2026-07-10T20:30:00.000Z',
    openInterest: 1000,
    assetManagerLong: 300,
    assetManagerShort: 100,
    leveragedFundsLong: 150,
    leveragedFundsShort: 250
  });
  assert.throws(() => parseTffRows([apiRow('2026-07-07'), apiRow('2026-07-07')]), /duplicate/);
  assert.throws(() => parseTffRows([apiRow('2026-07-07', { open_interest_all: '0' })]), /open interest/);
  const url = new URL(queryUrl());
  assert.match(url.searchParams.get('$where'), /209742/);
  assert.equal(url.searchParams.get('$limit'), '5000');
});

test('CFTC source persists official-style rows and does not rewrite an unchanged report week', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cftc-source-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const body = JSON.stringify([apiRow('2026-06-30'), apiRow('2026-07-07')]);
  const source = new CftcTffSource({
    runtimeDir: root,
    fetchImpl: async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json', 'last-modified': 'Fri, 10 Jul 2026 20:30:00 GMT' }
    })
  });
  const first = await source.fetch({ now: new Date('2026-07-11T00:00:00Z') });
  assert.equal(first.unchanged, false);
  assert.equal(first.latestReportDate, '2026-07-07');
  const filePath = path.join(root, 'sources', 'cftc', '209742.json');
  const firstStat = await fs.stat(filePath);
  const second = await source.fetch({ now: new Date('2026-07-11T01:00:00Z') });
  const secondStat = await fs.stat(filePath);
  assert.equal(second.unchanged, true);
  assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
});
