'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { isIsoDate } = require('../market-data/schema');

const DATASET_ID = 'gpe5-46if';
const DATASET_URL = `https://publicreporting.cftc.gov/resource/${DATASET_ID}.json`;
const DEFAULT_CONTRACT = '209742';

function queryUrl(contractCode = DEFAULT_CONTRACT) {
  const url = new URL(DATASET_URL);
  url.searchParams.set('$select', [
    'report_date_as_yyyy_mm_dd', 'cftc_contract_market_code', 'contract_market_name', 'market_and_exchange_names',
    'open_interest_all', 'asset_mgr_positions_long', 'asset_mgr_positions_short',
    'lev_money_positions_long', 'lev_money_positions_short'
  ].join(','));
  url.searchParams.set('$where', `cftc_contract_market_code='${contractCode}'`);
  url.searchParams.set('$order', 'report_date_as_yyyy_mm_dd ASC');
  url.searchParams.set('$limit', '5000');
  return url.toString();
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function parseTffRows(payload, { contractCode = DEFAULT_CONTRACT, publishedAt = null } = {}) {
  if (!Array.isArray(payload)) throw new TypeError('CFTC TFF payload must be an array');
  const seen = new Set();
  return payload.map(item => {
    const reportDate = String(item.report_date_as_yyyy_mm_dd || '').slice(0, 10);
    if (!isIsoDate(reportDate)) throw new TypeError('CFTC TFF row has an invalid report date');
    if (String(item.cftc_contract_market_code) !== contractCode) throw new TypeError('CFTC TFF row has an unexpected contract code');
    if (seen.has(reportDate)) throw new TypeError(`CFTC TFF contains duplicate report date ${reportDate}`);
    seen.add(reportDate);
    const row = {
      contractCode,
      contractName: String(item.contract_market_name || item.market_and_exchange_names || '').trim(),
      reportDate,
      publishedAt,
      openInterest: finiteNonNegative(item.open_interest_all),
      assetManagerLong: finiteNonNegative(item.asset_mgr_positions_long),
      assetManagerShort: finiteNonNegative(item.asset_mgr_positions_short),
      leveragedFundsLong: finiteNonNegative(item.lev_money_positions_long),
      leveragedFundsShort: finiteNonNegative(item.lev_money_positions_short)
    };
    if (!row.contractName || Object.entries(row).some(([key, value]) => key !== 'publishedAt' && value === null)) {
      throw new TypeError(`CFTC TFF row ${reportDate} has missing required fields`);
    }
    if (!(row.openInterest > 0)) throw new TypeError(`CFTC TFF row ${reportDate} has invalid open interest`);
    return row;
  }).sort((left, right) => left.reportDate.localeCompare(right.reportDate));
}

async function atomicJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await fs.rename(temporary, filePath);
}

class CftcTffSource {
  constructor({ runtimeDir, fetchImpl = global.fetch, requestTimeoutMs = 15_000, contractCode = DEFAULT_CONTRACT }) {
    this.provider = 'cftc';
    this.source = 'CFTC Traders in Financial Futures（Futures Only）';
    this.sourceUrl = 'https://publicreporting.cftc.gov/Commitments-of-Traders/TFF-Futures-Only/gpe5-46if';
    this.frequency = 'weekly-report';
    this.runtimeDir = runtimeDir;
    this.fetchImpl = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.contractCode = contractCode;
  }

  async fetch({ now = new Date() } = {}) {
    const started = Date.now();
    const response = await this.fetchImpl(queryUrl(this.contractCode), {
      headers: { Accept: 'application/json', 'User-Agent': 'MarketStrategyQuery/0.4 personal-research-dashboard' },
      signal: AbortSignal.timeout(this.requestTimeoutMs)
    });
    if (!response.ok) throw Object.assign(new Error(`CFTC returned HTTP ${response.status}`), { status: response.status, marketDataType: `http-${response.status}` });
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 10 * 1024 * 1024) throw new RangeError('CFTC TFF response exceeds size limit');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > 10 * 1024 * 1024) throw new RangeError('CFTC TFF response exceeds size limit');
    const publishedAtHeader = response.headers.get('last-modified');
    const publishedAt = publishedAtHeader && !Number.isNaN(new Date(publishedAtHeader).valueOf())
      ? new Date(publishedAtHeader).toISOString()
      : null;
    const rows = parseTffRows(JSON.parse(text), { contractCode: this.contractCode, publishedAt });
    if (!rows.length) throw Object.assign(new Error('CFTC TFF returned no rows'), { marketDataType: 'empty-data' });
    const root = path.join(this.runtimeDir, 'sources', 'cftc');
    const filePath = path.join(root, `${this.contractCode}.json`);
    const previous = await fs.readFile(filePath, 'utf8').then(JSON.parse, () => null);
    const latestDate = rows.at(-1).reportDate;
    const unchanged = previous?.latestReportDate === latestDate;
    const model = {
      provider: this.provider,
      datasetId: DATASET_ID,
      sourceUrl: this.sourceUrl,
      contractCode: this.contractCode,
      latestReportDate: latestDate,
      publishedAt,
      retrievedAt: now.toISOString(),
      rows
    };
    if (!unchanged) await atomicJson(filePath, model);
    return { rows, latestReportDate: latestDate, publishedAt, unchanged, httpStatus: response.status, durationMs: Date.now() - started };
  }
}

module.exports = { CftcTffSource, DATASET_ID, DATASET_URL, DEFAULT_CONTRACT, parseTffRows, queryUrl };
