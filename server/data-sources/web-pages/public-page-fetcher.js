'use strict';

const http = require('http');
const https = require('https');

const DEFAULT_USER_AGENT = 'MarketCycleStrategy/0.5 (personal non-commercial research; WorldPEratio public-page audit)';

function fetchError(type, message, details = {}) {
  const error = new Error(message);
  error.webPageType = type;
  Object.assign(error, details);
  return error;
}

function headersObject(headers) {
  if (!headers) return {};
  if (typeof headers.entries === 'function') return Object.fromEntries(headers.entries());
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function validateTarget(url, allowedHosts) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw fetchError('invalid-url', 'only HTTP(S) URLs are allowed');
  if (allowedHosts?.length && !allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw fetchError('host-not-allowed', `host is not allowed: ${parsed.hostname}`);
  }
  return parsed;
}

async function fetchWithImplementation(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.totalTimeoutMs);
  try {
    const response = await options.fetchImpl(url, {
      headers: { 'User-Agent': options.userAgent, Accept: options.accept },
      redirect: 'follow',
      signal: controller.signal
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > options.maxBytes) throw fetchError('response-too-large', 'response exceeds byte limit');
    return {
      status: response.status,
      headers: headersObject(response.headers),
      text: buffer.toString('utf8'),
      finalUrl: response.url || url
    };
  } catch (error) {
    if (error.name === 'AbortError') throw fetchError('total-timeout', 'page request exceeded total timeout');
    if (error.webPageType) throw error;
    throw fetchError('network', error.message);
  } finally {
    clearTimeout(timer);
  }
}

function nativeRequest(url, options, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = validateTarget(url, options.allowedHosts);
    const transport = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    let connectTimer;
    let totalTimer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      callback(value);
    };
    const request = transport.request(parsed, {
      method: 'GET',
      headers: { 'User-Agent': options.userAgent, Accept: options.accept, Connection: 'close' }
    }, response => {
      clearTimeout(connectTimer);
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirectCount >= options.maxRedirects) {
          finish(reject, fetchError('too-many-redirects', 'page request exceeded redirect limit'));
          return;
        }
        const nextUrl = new URL(response.headers.location, parsed).toString();
        try {
          validateTarget(nextUrl, options.allowedHosts);
        } catch (error) {
          finish(reject, error);
          return;
        }
        finish(resolve, nativeRequest(nextUrl, options, redirectCount + 1));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > options.maxBytes) request.destroy(fetchError('response-too-large', 'response exceeds byte limit'));
        else chunks.push(chunk);
      });
      response.on('end', () => finish(resolve, {
        status,
        headers: headersObject(response.headers),
        text: Buffer.concat(chunks).toString('utf8'),
        finalUrl: parsed.toString()
      }));
    });
    connectTimer = setTimeout(() => request.destroy(fetchError('connect-timeout', 'page connection exceeded timeout')), options.connectTimeoutMs);
    totalTimer = setTimeout(() => request.destroy(fetchError('total-timeout', 'page request exceeded total timeout')), options.totalTimeoutMs);
    request.on('error', error => finish(reject, error.webPageType ? error : fetchError('network', error.message)));
    request.end();
  });
}

async function fetchPublicPage({
  url,
  fetchImpl = null,
  allowedHosts = [],
  userAgent = DEFAULT_USER_AGENT,
  accept = 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8',
  connectTimeoutMs = 10_000,
  totalTimeoutMs = 20_000,
  maxBytes = 1_000_000,
  maxRedirects = 3,
  allowedStatusCodes = []
}) {
  validateTarget(url, allowedHosts.map(host => host.toLowerCase()));
  const options = { fetchImpl, allowedHosts: allowedHosts.map(host => host.toLowerCase()), userAgent, accept, connectTimeoutMs, totalTimeoutMs, maxBytes, maxRedirects };
  const result = fetchImpl ? await fetchWithImplementation(url, options) : await nativeRequest(url, options);
  const lower = result.text.toLowerCase();
  if (result.status === 403) throw fetchError('forbidden', 'source returned HTTP 403', { status: 403 });
  if (result.status === 429) throw fetchError('rate-limited', 'source returned HTTP 429', { status: 429 });
  if ((result.status < 200 || result.status >= 300) && !allowedStatusCodes.includes(result.status)) {
    throw fetchError('http-error', `source returned HTTP ${result.status}`, { status: result.status });
  }
  if (/(?:<title>[^<]*(?:log\s*in|sign\s*in)|<form[^>]+(?:login|signin))/i.test(result.text)) {
    throw fetchError('login-required', 'source returned a login page');
  }
  if (/(?:captcha|challenge-platform|cf-chl-|cloudflare[^<]{0,80}challenge)/i.test(lower)) {
    throw fetchError('access-challenge', 'source returned an access challenge');
  }
  return result;
}

module.exports = { DEFAULT_USER_AGENT, fetchError, fetchPublicPage };
