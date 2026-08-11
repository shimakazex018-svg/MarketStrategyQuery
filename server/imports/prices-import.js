'use strict';

const { isIsoDate } = require('../market-data/schema');
const { importManifest, parseCsv } = require('./csv-parser');
const { normalizeTicker } = require('./holdings-import');

const REQUIRED_HEADERS = Object.freeze(['ticker', 'date', 'adjustedClose']);
const OHLCV_HEADERS = Object.freeze(['open', 'high', 'low', 'close', 'volume']);

function optionalNumber(record, field) {
  if (record[field] === undefined || record[field] === null || String(record[field]).trim() === '') return null;
  const value = Number(record[field]);
  return Number.isFinite(value) ? value : null;
}

function calendarGap(previousDate, currentDate) {
  return (new Date(`${currentDate}T00:00:00Z`) - new Date(`${previousDate}T00:00:00Z`)) / 86_400_000;
}

function importPricesCsv(input, options = {}) {
  const parsed = parseCsv(input, { ...options, requiredHeaders: REQUIRED_HEADERS });
  const seen = new Set();
  const lastDateByTicker = new Map();
  const gapDetails = [];
  let usesOhlcv = false;
  const records = parsed.records.map((record, index) => {
    const ticker = normalizeTicker(record.ticker);
    if (!isIsoDate(record.date)) throw new TypeError(`invalid date for ${ticker}`);
    const adjustedClose = Number(record.adjustedClose);
    if (!Number.isFinite(adjustedClose) || adjustedClose <= 0 || adjustedClose > (options.maxPrice ?? 10_000_000)) {
      throw new TypeError(`invalid adjustedClose for ${ticker}`);
    }
    const key = `${ticker}:${record.date}`;
    if (seen.has(key)) throw new TypeError(`duplicate price ${key}`);
    seen.add(key);
    const previousDate = lastDateByTicker.get(ticker);
    if (previousDate && record.date <= previousDate) throw new TypeError(`prices for ${ticker} are not in ascending date order`);
    lastDateByTicker.set(ticker, record.date);
    const source = String(record.sourceName || record.source || '').trim();
    if (!source) throw new TypeError(`missing sourceName for ${ticker}`);
    const currency = record.currency ? String(record.currency).trim().toUpperCase() : null;
    if (currency && !/^[A-Z]{3}$/.test(currency)) throw new TypeError(`invalid currency for ${ticker}`);
    const hasOhlcv = OHLCV_HEADERS.some(field => record[field] !== undefined && String(record[field]).trim() !== '');
    usesOhlcv ||= hasOhlcv;
    const open = optionalNumber(record, 'open');
    const high = optionalNumber(record, 'high');
    const low = optionalNumber(record, 'low');
    const close = optionalNumber(record, 'close');
    const volume = optionalNumber(record, 'volume');
    if (hasOhlcv) {
      if ([open, high, low, close, volume].some(value => value === null)) throw new TypeError(`missing finite OHLCV field for ${ticker}`);
      if ([open, high, low, close].some(value => value <= 0) || volume < 0) throw new TypeError(`invalid OHLCV price or volume for ${ticker}`);
      if (high < Math.max(open, close) || low > Math.min(open, close)) throw new TypeError(`invalid OHLCV high/low bounds for ${ticker}`);
    }
    const asOf = String(record.asOf || record.date).trim();
    if (!isIsoDate(asOf)) throw new TypeError(`invalid asOf for ${ticker}`);
    if (previousDate) {
      const gapDays = calendarGap(previousDate, record.date);
      if (gapDays > 4) gapDetails.push({ ticker, from: previousDate, to: record.date, days: gapDays });
    }
    return {
      ticker, date: record.date, open, high, low, close: close ?? adjustedClose, adjustedClose, volume,
      source, sourceName: source, asOf, hasOhlcv, ...(currency ? { currency } : {}), row: index + 2
    };
  });
  const sourceNames = new Set(records.map(record => record.source));
  if (sourceNames.size !== 1) throw new TypeError('prices must share one sourceName per import');
  return {
    records,
    priceBasis: usesOhlcv ? 'adjusted_close_ohlcv' : 'adjusted_close',
    schemaVersion: 'OHLCV-LOCAL-CSV-v1',
    qualityWarnings: gapDetails.length ? ['calendar_gaps_detected_without_imputation'] : [],
    gapCount: gapDetails.length,
    gapDetails,
    manifest: importManifest(input, { importedAt: options.importedAt, sourceName: records[0].source, rowCount: records.length })
  };
}

module.exports = { importPricesCsv };
