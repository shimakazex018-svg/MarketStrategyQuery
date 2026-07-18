'use strict';

const fs = require('fs/promises');
const path = require('path');

async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function writeAtomicJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await fs.rename(temporary, filePath);
}

function dayKey(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function publicError(error) {
  if (!error) return null;
  return { type: error.type || 'source-error', status: error.status || null, at: error.at || null };
}

function sourceError(type, message, details = {}) { return Object.assign(new Error(message), { type, ...details }); }

function retryable(error) { return ['connect-timeout', 'total-timeout'].includes(error?.type) || error?.status >= 500; }

async function fetchText(url, { fetchImpl = global.fetch, maxBytes = 5 * 1024 * 1024, timeoutMs = 30_000, accept = '*/*' } = {}) {
  let response;
  try { response = await fetchImpl(url, { headers: { Accept: accept, 'User-Agent': 'MarketCycleStrategy/0.5 personal-research' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { throw sourceError(error?.name === 'TimeoutError' ? 'total-timeout' : 'network-error', 'source request failed'); }
  if (response.status === 403) throw sourceError('forbidden', 'source returned HTTP 403', { status: 403, hardStop: true });
  if (response.status === 429) throw sourceError('rate-limited', 'source returned HTTP 429', { status: 429, hardStop: true });
  if (!response.ok) throw sourceError('http-error', `source returned HTTP ${response.status}`, { status: response.status });
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw sourceError('response-too-large', 'source response exceeded limit');
  if (/(?:captcha|cf-chl-|<form[^>]+(?:login|signin)|access challenge)/i.test(text)) throw sourceError('access-challenge', 'source returned an access challenge', { hardStop: true });
  return text;
}

module.exports = { dayKey, fetchText, publicError, readJson, retryable, sourceError, writeAtomicJson };
