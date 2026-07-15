'use strict';

const { normalizeHistory } = require('../market-data/schema');

const SOURCES = Object.freeze({
  vix: {
    id: 'vix', displayName: 'VIX', provider: 'cboe', source: 'Cboe',
    sourceUrl: 'https://www.cboe.com/us/indices/market_statistics/historical_data/',
    endpoint: 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv'
  },
  vxn: {
    id: 'vxn', displayName: 'VXN', provider: 'cboe', source: 'Cboe',
    sourceUrl: 'https://www.cboe.com/us/indices/market_statistics/historical_data/',
    endpoint: 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VXN_History.csv'
  }
});

function toIsoDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value).trim());
  if (!match) throw new TypeError(`invalid Cboe date: ${value}`);
  return `${match[3]}-${match[1]}-${match[2]}`;
}

function parseCboeCsv(raw) {
  const lines = String(raw).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length < 2) throw new TypeError('Cboe response is empty');
  const headers = lines[0].split(',').map(value => value.trim().toUpperCase());
  const dateIndex = headers.indexOf('DATE');
  const closeIndex = headers.indexOf('CLOSE');
  if (dateIndex < 0 || closeIndex < 0) throw new TypeError('Cboe response schema changed');
  const history = lines.slice(1).filter(Boolean).map(line => {
    const columns = line.split(',');
    return { date: toIsoDate(columns[dateIndex]), value: Number(columns[closeIndex]) };
  });
  if (history.length < 2) throw new TypeError('Cboe response has insufficient data');
  return normalizeHistory(history, { min: 0.01, max: 200 });
}

function classifyFetchError(error) {
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'timeout';
  if (/HTTP 404/.test(error.message)) return 'http-404';
  if (/HTTP 429/.test(error.message)) return 'http-429';
  if (/HTTP \d+/.test(error.message)) return 'http-error';
  if (/schema|invalid|empty|insufficient|duplicate/i.test(error.message)) return 'validation';
  return 'network';
}

function createCboeHistorySource(id, { fetchImpl = global.fetch, requestTimeoutMs = 15_000 } = {}) {
  const definition = SOURCES[id];
  if (!definition) throw new TypeError(`unknown Cboe source ${id}`);
  return {
    ...definition,
    frequency: 'daily-close',
    freshForMs: 36 * 60 * 60_000,
    minValue: 0.01,
    maxValue: 200,
    async fetch() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      const startedAt = Date.now();
      try {
        const response = await fetchImpl(definition.endpoint, {
          signal: controller.signal,
          headers: { Accept: 'text/csv', 'User-Agent': 'MarketCycleStrategy/0.3 (personal; contact local administrator)' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.text();
        if (Buffer.byteLength(raw, 'utf8') > 2_000_000) throw new RangeError('response exceeds size limit');
        const history = parseCboeCsv(raw);
        return { history, raw, durationMs: Date.now() - startedAt, httpStatus: response.status };
      } catch (error) {
        error.marketDataType = classifyFetchError(error);
        error.durationMs = Date.now() - startedAt;
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

module.exports = { SOURCES, classifyFetchError, createCboeHistorySource, parseCboeCsv, toIsoDate };
