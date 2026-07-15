'use strict';

const { isIsoDate } = require('../market-data/schema');
const { importManifest, parseCsv } = require('./csv-parser');
const { normalizeTicker } = require('./holdings-import');

const REQUIRED_HEADERS = Object.freeze(['ticker', 'date', 'adjustedClose', 'sourceName']);

function importPricesCsv(input, options = {}) {
  const parsed = parseCsv(input, { ...options, requiredHeaders: REQUIRED_HEADERS });
  const seen = new Set();
  const lastDateByTicker = new Map();
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
    if (!record.sourceName) throw new TypeError(`missing sourceName for ${ticker}`);
    const currency = record.currency ? String(record.currency).trim().toUpperCase() : null;
    if (currency && !/^[A-Z]{3}$/.test(currency)) throw new TypeError(`invalid currency for ${ticker}`);
    return { ticker, date: record.date, adjustedClose, sourceName: record.sourceName, ...(currency ? { currency } : {}), row: index + 2 };
  });
  const sourceNames = new Set(records.map(record => record.sourceName));
  if (sourceNames.size !== 1) throw new TypeError('prices must share one sourceName per import');
  return {
    records,
    priceBasis: 'adjusted_close',
    manifest: importManifest(input, { importedAt: options.importedAt, sourceName: records[0].sourceName, rowCount: records.length })
  };
}

module.exports = { importPricesCsv };
