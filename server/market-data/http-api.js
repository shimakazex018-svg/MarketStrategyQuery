'use strict';

const { RANGE_KEYS } = require('./schema');

function sendJson(res, statusCode, body, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

function isTrustedAddress(address = '') {
  const value = address.replace(/^::ffff:/, '');
  if (value === '::1' || value === '127.0.0.1') return true;
  if (/^10\./.test(value) || /^192\.168\./.test(value)) return true;
  const match = /^172\.(\d+)\./.exec(value);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return /^fe80:/i.test(value) || /^f[cd][0-9a-f]{2}:/i.test(value);
}

function normalizedRange(requestUrl) {
  const value = (requestUrl.searchParams.get('range') || '1Y').toUpperCase();
  return RANGE_KEYS.includes(value) ? value : null;
}

async function handleMarketDataApi(req, res, requestUrl, service) {
  const prefix = '/api/market-data';
  if (!requestUrl.pathname.startsWith(prefix)) return false;

  if (req.method === 'GET' && requestUrl.pathname === `${prefix}/status`) {
    sendJson(res, 200, service.getStatus());
    return true;
  }

  const providerMatch = new RegExp(`^${prefix}/providers/([a-z0-9_-]+)/(status|latest|history|statistics)$`).exec(requestUrl.pathname);
  if (req.method === 'GET' && providerMatch) {
    const providerId = providerMatch[1];
    const getters = {
      status: 'getProviderDiagnosticStatus',
      latest: 'getProviderLatest',
      history: 'getProviderHistory',
      statistics: 'getProviderStatistics'
    };
    const result = service[getters[providerMatch[2]]]?.(providerId);
    if (!result) sendJson(res, 404, { error: 'provider-not-found' });
    else sendJson(res, 200, result);
    return true;
  }

  if (req.method === 'GET' && (requestUrl.pathname === `${prefix}/indicators` || requestUrl.pathname === `${prefix}/summary`)) {
    const range = normalizedRange(requestUrl);
    if (!range) sendJson(res, 400, { error: 'invalid-range', allowed: RANGE_KEYS });
    else sendJson(res, 200, { range, indicators: service.getIndicators(range) });
    return true;
  }

  const indicatorMatch = new RegExp(`^${prefix}/(?:indicators|metrics)/([a-z0-9_-]+)$`).exec(requestUrl.pathname);
  if (req.method === 'GET' && indicatorMatch) {
    const range = normalizedRange(requestUrl);
    if (!range) sendJson(res, 400, { error: 'invalid-range', allowed: RANGE_KEYS });
    else {
      const indicator = service.getIndicator(indicatorMatch[1], range);
      if (!indicator) sendJson(res, 404, { error: 'indicator-not-found' });
      else sendJson(res, 200, indicator);
    }
    return true;
  }

  const historyMatch = new RegExp(`^${prefix}/metrics/([a-z0-9_-]+)/history$`).exec(requestUrl.pathname);
  if (req.method === 'GET' && historyMatch) {
    const range = normalizedRange(requestUrl);
    if (!range) sendJson(res, 400, { error: 'invalid-range', allowed: RANGE_KEYS });
    else { const metric = service.getIndicator(historyMatch[1], range); if (!metric) sendJson(res, 404, { error: 'metric-not-found' }); else sendJson(res, 200, { metricId: metric.id, range, history: metric.history, historyStart: metric.historyStart, historyEnd: metric.historyEnd }); }
    return true;
  }

  const refreshMatch = new RegExp(`^${prefix}/refresh/([a-z0-9_-]+)$`).exec(requestUrl.pathname);
  if (req.method === 'POST' && refreshMatch) {
    if (!isTrustedAddress(req.socket.remoteAddress)) {
      sendJson(res, 403, { error: 'trusted-network-required' });
      return true;
    }
    const result = await service.refresh(refreshMatch[1], { kind: 'manual', requestSource: req.socket.remoteAddress || 'unknown' });
    sendJson(res, result.ok ? 200 : (result.statusCode || 500), result);
    return true;
  }

  sendJson(res, 404, { error: 'api-route-not-found' });
  return true;
}

module.exports = { handleMarketDataApi, isTrustedAddress, normalizedRange, sendJson };
