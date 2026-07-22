'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { parseCsv } = require('../imports/csv-parser');
const { readJson } = require('./production-utils');

const SOXX_METRIC_ID = 'soxx_price';
const SOXX_INCEPTION_DATE = '2001-07-10';
const SOXX_SPLIT_DATE = '2024-03-07';
const SERIES_TYPES = new Set(['adjusted_market_price', 'market_price', 'nav']);
const ADJUSTMENT_STATUSES = new Set(['provider_adjusted', 'unadjusted', 'unknown']);
const SERIES_COLUMNS = Object.freeze({
  adjusted_market_price: ['Adjusted Close', 'AdjustedClose'],
  market_price: ['Close'],
  nav: ['NAV', 'NAV per Share']
});

function decodeXml(value) {
  return String(value || '').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function parseDate(value) {
  const text = String(value || '').trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : new Date(`${text} 00:00:00 UTC`);
  if (Number.isNaN(parsed.valueOf())) throw new TypeError('SOXX history contains an invalid date');
  return parsed.toISOString().slice(0, 10);
}

function validateSymbol(value) {
  if (value === undefined || value === null || String(value).trim() === '') return;
  const symbol = String(value).trim().toUpperCase();
  if (symbol !== 'SOXX') throw new TypeError(`SOXX import rejected non-SOXX symbol ${symbol}`);
}

function parseSpreadsheetMl(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  if (!/^\s*<\?xml[^>]*>\s*<ss:Workbook\b/.test(text)) throw new TypeError('Official iShares file is not SpreadsheetML');
  if (!text.includes('iShares Semiconductor ETF')) throw new TypeError('Official file does not identify iShares Semiconductor ETF');
  const sheet = [...text.matchAll(/<ss:Worksheet\b[^>]*ss:Name="([^"]+)"[^>]*>([\s\S]*?)<\/ss:Worksheet>/g)]
    .find(([, name]) => name === 'Historical');
  if (!sheet) throw new TypeError('Official file is missing the Historical worksheet');
  const rows = [...sheet[2].matchAll(/<ss:Row\b[^>]*>([\s\S]*?)<\/ss:Row>/g)].map(match =>
    [...match[1].matchAll(/<ss:Data\b[^>]*>([\s\S]*?)<\/ss:Data>/g)].map(cell => decodeXml(cell[1]))
  );
  if (rows[0]?.join('|') !== 'As Of|NAV per Share|Ex-Dividends|Shares Outstanding') {
    throw new TypeError('Official Historical worksheet fields changed');
  }
  return rows.slice(1).map(row => ({ Date: row[0], NAV: row[1], Symbol: 'SOXX' }));
}

function parseSoxxCsv(input, seriesType) {
  if (!SERIES_TYPES.has(seriesType)) throw new TypeError('SOXX seriesType must be explicit');
  const parsed = parseCsv(input, { maxBytes: 10 * 1024 * 1024, maxRows: 20_000, requiredHeaders: ['Date'] });
  const matchingColumns = SERIES_COLUMNS[seriesType].filter(column => parsed.headers.includes(column));
  if (matchingColumns.length !== 1) throw new TypeError(`SOXX CSV must contain exactly one ${seriesType} value column`);
  const valueColumn = matchingColumns[0];
  return parsed.records.map(record => ({ Date: record.Date, Value: record[valueColumn], Symbol: record.Symbol ?? record.Ticker }));
}

function normalizeSoxxRows(rows, { seriesType, adjustmentStatus, now = new Date(), officialSpreadsheet = false } = {}) {
  if (!SERIES_TYPES.has(seriesType)) throw new TypeError('SOXX seriesType must be explicit');
  if (!ADJUSTMENT_STATUSES.has(adjustmentStatus)) throw new TypeError('SOXX adjustmentStatus must be explicit');
  if (!Array.isArray(rows) || !rows.length) throw new TypeError('SOXX history is empty');
  const today = new Date(now).toISOString().slice(0, 10);
  const byDate = new Map();
  let duplicateCount = 0;
  let conflictCount = 0;
  let weekendCount = 0;
  for (const row of rows) {
    validateSymbol(row.Symbol);
    const date = parseDate(row.Date);
    if (date < SOXX_INCEPTION_DATE) throw new TypeError('SOXX history predates fund inception');
    if (date > today) throw new TypeError('SOXX history contains a future date');
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if ([0, 6].includes(parsedDate.getUTCDay())) { weekendCount += 1; continue; }
    const rawValue = officialSpreadsheet ? row.NAV : row.Value;
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') throw new TypeError(`SOXX history contains a missing value at ${date}`);
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) throw new TypeError(`SOXX history contains an invalid value at ${date}`);
    if (byDate.has(date)) {
      if (byDate.get(date) !== value) { conflictCount += 1; throw new TypeError(`SOXX history contains conflicting values for ${date}`); }
      duplicateCount += 1;
    } else byDate.set(date, value);
  }
  const values = [...byDate.entries()].map(([date, value]) => ({ date, value })).sort((left, right) => left.date.localeCompare(right.date));
  if (values.length < 2) throw new TypeError('SOXX history has insufficient observations');
  const abnormalGaps = [];
  for (let index = 1; index < values.length; index += 1) {
    const ratio = values[index].value / values[index - 1].value;
    if (ratio <= 0.5 || ratio >= 2) abnormalGaps.push({ from: values[index - 1].date, to: values[index].date });
  }
  if (abnormalGaps.length) throw new TypeError('SOXX history contains a split-like discontinuity');
  const spansKnownSplit = values[0].date < SOXX_SPLIT_DATE && values.at(-1).date >= SOXX_SPLIT_DATE;
  if (seriesType === 'market_price' && spansKnownSplit && adjustmentStatus !== 'provider_adjusted') {
    throw new TypeError('Unadjusted SOXX market price cannot span the 2024 stock split');
  }
  return {
    values,
    diagnostics: {
      firstDate: values[0].date,
      lastDate: values.at(-1).date,
      rowCount: values.length,
      missingCount: 0,
      duplicateCount,
      conflictCount,
      abnormalGapCount: abnormalGaps.length,
      weekendExcludedCount: weekendCount,
      splitCheckStatus: spansKnownSplit ? 'known_split_continuity_verified' : 'known_split_outside_range',
      adjustmentStatus,
      seriesType
    }
  };
}

function validateStoredSoxx(input) {
  if (input?.metricId !== SOXX_METRIC_ID || input.symbol !== 'SOXX') throw new TypeError('Stored SOXX identity is invalid');
  const normalized = normalizeSoxxRows((input.values || []).map(point => ({ Date: point.date, Value: point.value, Symbol: 'SOXX' })), {
    seriesType: input.seriesType,
    adjustmentStatus: input.adjustmentStatus,
    now: new Date(`${input.lastDate}T23:59:59Z`)
  });
  if (input.firstDate !== normalized.diagnostics.firstDate || input.lastDate !== normalized.diagnostics.lastDate || input.rowCount !== normalized.values.length) {
    throw new TypeError('Stored SOXX metadata does not match its history');
  }
  return { ...input, values: normalized.values };
}

class EtfPriceProvider {
  constructor({ productionRoot, now = () => new Date(), timezone = 'Asia/Shanghai' }) {
    this.filePath = path.join(productionRoot, 'etf', 'soxx.json');
    this.now = now;
    this.timezone = timezone;
    this.data = null;
    this.lastError = null;
    this.lastLoadedAt = null;
  }
  async init() { await this.reload(); return this; }
  async reload() {
    const previous = this.data;
    try {
      const value = await readJson(this.filePath, null);
      this.data = value ? validateStoredSoxx(value) : null;
      this.lastError = null;
      this.lastLoadedAt = this.now().toISOString();
    } catch (error) {
      this.data = previous;
      this.lastError = error.code === 'ENOENT' ? null : 'invalid_local_soxx_data';
    }
    return this.data;
  }
  async read() { return this.data; }
  async refresh() { const data = await this.reload(); return { ok: Boolean(data), status: data ? 'loaded' : 'unavailable', networkRequested: false }; }
  getStatus() {
    return {
      providerId: 'ishares-soxx',
      enabled: true,
      mode: 'local_import_only',
      timezone: this.timezone,
      networkRequestsEnabled: false,
      metricId: SOXX_METRIC_ID,
      available: Boolean(this.data),
      lastLoadedAt: this.lastLoadedAt,
      lastError: this.lastError
    };
  }
}

module.exports = {
  ADJUSTMENT_STATUSES,
  EtfPriceProvider,
  SERIES_TYPES,
  SOXX_INCEPTION_DATE,
  SOXX_METRIC_ID,
  SOXX_SPLIT_DATE,
  normalizeSoxxRows,
  parseSoxxCsv,
  parseSpreadsheetMl,
  validateStoredSoxx
};
