'use strict';

const { sendJson } = require('../market-data/http-api');

function parseRangeParams(requestUrl) {
  const range = String(requestUrl.searchParams.get('range') || '1Y').toUpperCase();
  return { range, customStart: requestUrl.searchParams.get('start') || null, customEnd: requestUrl.searchParams.get('end') || null };
}

function readBody(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let body = ''; let bytes = 0;
    req.setEncoding('utf8');
    req.on('data', chunk => { bytes += Buffer.byteLength(chunk, 'utf8'); if (bytes > maxBytes) { reject(Object.assign(new Error('request-too-large'), { statusCode: 413 })); req.destroy(); return; } body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function login(req, res, service) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { error: 'invalid-login-payload' }); return true; }
  const session = service.auth.login(typeof payload?.password === 'string' ? payload.password : '');
  if (!session) { sendJson(res, 401, { error: 'invalid-password' }); return true; }
  sendJson(res, 200, { ok: true, authenticated: true, expiresAt: session.expiresAt }, { 'Set-Cookie': service.auth.cookieHeader(session) });
  return true;
}

function authorized(req, service) {
  return Boolean(service.auth.getSession(req));
}

async function handlePortfolioApi(req, res, requestUrl, service, scheduler = null) {
  if (!service || !requestUrl.pathname.startsWith('/api/portfolio')) return false;
  if (requestUrl.pathname === '/api/portfolio/auth/login' && req.method === 'POST') return login(req, res, service);
  if (requestUrl.pathname === '/api/portfolio/auth/logout' && req.method === 'POST') {
    if (!authorized(req, service) && !service.fixtureMode) { sendJson(res, 401, { error: 'authentication-required' }); return true; }
    service.auth.logout(req);
    sendJson(res, 200, { ok: true, authenticated: false }, { 'Set-Cookie': service.auth.clearCookieHeader() });
    return true;
  }
  if (req.method !== 'GET') { sendJson(res, 405, { error: 'read-only-api' }); return true; }
  if (!authorized(req, service)) { sendJson(res, 401, { error: 'authentication-required' }); return true; }

  try {
    if (requestUrl.pathname === '/api/portfolio/status') { sendJson(res, 200, service.getStatus(scheduler)); return true; }
    if (requestUrl.pathname === '/api/portfolio/sync/status') { sendJson(res, 200, service.getSyncStatus(scheduler)); return true; }
    const params = parseRangeParams(requestUrl);
    if (requestUrl.pathname === '/api/portfolio/summary') { sendJson(res, 200, service.getSummary(params.range, params.customStart, params.customEnd)); return true; }
    if (requestUrl.pathname === '/api/portfolio/performance') { sendJson(res, 200, service.getPerformance(params.range, params.customStart, params.customEnd)); return true; }
    if (requestUrl.pathname === '/api/portfolio/calendar') { sendJson(res, 200, service.getCalendar(requestUrl.searchParams.get('month'))); return true; }
    if (requestUrl.pathname === '/api/portfolio/contributions') { sendJson(res, 200, service.getContributions(params.range, params.customStart, params.customEnd)); return true; }
    if (requestUrl.pathname === '/api/portfolio/cash-flows') { sendJson(res, 200, service.getCashFlows(params.range, params.customStart, params.customEnd)); return true; }
    if (requestUrl.pathname === '/api/portfolio/positions') { sendJson(res, 200, service.getPositions(requestUrl.searchParams.get('date'))); return true; }
    if (requestUrl.pathname === '/api/portfolio/trades') { sendJson(res, 200, service.getTrades(params.range, params.customStart, params.customEnd)); return true; }
    sendJson(res, 404, { error: 'portfolio-route-not-found' });
  } catch (error) {
    sendJson(res, error.statusCode || 500, error.statusCode === 400 ? { error: error.message, allowed: error.allowed } : { error: 'portfolio-service-error' });
  }
  return true;
}

module.exports = { handlePortfolioApi, parseRangeParams, readBody };
