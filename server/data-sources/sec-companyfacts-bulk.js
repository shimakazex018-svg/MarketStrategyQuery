'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { readSelectedJsonEntries } = require('./zip-reader');

const BULK_URL = 'https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip';
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';

function secUserAgent(config) {
  const app = String(config?.app || '').trim();
  const email = String(config?.email || '').trim();
  if (!app || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return `${app} ${email}`;
}

function cikFileName(cik) {
  return `CIK${String(cik).replace(/\D/g, '').padStart(10, '0')}.json`;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function atomicJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await fsp.rename(temporary, filePath);
}

async function fetchJson(url, { fetchImpl, userAgent, timeoutMs, maxBytes }) {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw Object.assign(new Error(`SEC returned HTTP ${response.status}`), { status: response.status, marketDataType: `http-${response.status}` });
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new RangeError('SEC JSON response exceeds size limit');
  return JSON.parse(text);
}

async function downloadWithResume(url, targetPath, { fetchImpl, userAgent, timeoutMs, maxBytes }) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const partialPath = `${targetPath}.partial`;
  const existing = await fsp.stat(partialPath).then(stat => stat.size, () => 0);
  const headers = { 'User-Agent': userAgent, Accept: 'application/zip', 'Accept-Encoding': 'identity' };
  if (existing > 0) headers.Range = `bytes=${existing}-`;
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || (existing > 0 && response.status !== 206 && response.status !== 200)) {
    throw Object.assign(new Error(`SEC bulk returned HTTP ${response.status}`), { status: response.status, marketDataType: `http-${response.status}` });
  }
  const append = existing > 0 && response.status === 206;
  const startSize = append ? existing : 0;
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && startSize + contentLength > maxBytes) throw new RangeError('SEC bulk ZIP exceeds configured size limit');
  let written = startSize;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      written += chunk.length;
      callback(written > maxBytes ? new RangeError('SEC bulk ZIP exceeds configured size limit') : null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(partialPath, { flags: append ? 'a' : 'w' }));
  const handle = await fsp.open(partialPath, 'r');
  try {
    const signature = Buffer.alloc(4);
    await handle.read(signature, 0, 4, 0);
    if (signature.readUInt32LE(0) !== 0x04034b50) throw new TypeError('SEC bulk response is not a ZIP file');
  } finally {
    await handle.close();
  }
  const previousPath = `${targetPath}.previous`;
  await fsp.rm(previousPath, { force: true });
  await fsp.rename(targetPath, previousPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  try {
    await fsp.rename(partialPath, targetPath);
  } catch (error) {
    await fsp.rename(previousPath, targetPath).catch(() => {});
    throw error;
  }
  return { bytes: written, resumedFrom: append ? existing : 0, previousPath };
}

function tickerMap(payload) {
  const values = Array.isArray(payload) ? payload : Object.values(payload || {});
  return new Map(values
    .filter(item => item && item.ticker && item.cik_str !== undefined)
    .map(item => [String(item.ticker).toUpperCase(), String(item.cik_str).padStart(10, '0')]));
}

class SecCompanyFactsBulkSource {
  constructor({ runtimeDir, fetchImpl = global.fetch, requestTimeoutMs = 15 * 60_000, maxBytes = 4 * 1024 * 1024 * 1024, app, email }) {
    this.provider = 'sec-edgar';
    this.source = 'SEC EDGAR companyfacts bulk ZIP';
    this.sourceUrl = BULK_URL;
    this.runtimeDir = runtimeDir;
    this.fetchImpl = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.maxBytes = maxBytes;
    this.userAgent = secUserAgent({ app, email });
  }

  configured() { return Boolean(this.userAgent); }

  async fetchForTickers(tickers, { now = new Date(), force = false } = {}) {
    if (!this.configured()) return { status: 'unavailable', reason: 'sec_user_agent_missing', requested: false };
    const uniqueTickers = [...new Set((tickers || []).map(value => String(value).trim().toUpperCase()).filter(Boolean))];
    if (!uniqueTickers.length) return { status: 'insufficient_coverage', reason: 'holdings_required_before_sec_download', requested: false };
    const root = path.join(this.runtimeDir, 'sources', 'sec');
    const manifestPath = path.join(root, 'manifest.json');
    const existingManifest = await fsp.readFile(manifestPath, 'utf8').then(JSON.parse, () => null);
    const day = now.toISOString().slice(0, 10);
    if (!force && existingManifest?.downloadDay === day) return { status: 'unchanged', requested: false, manifest: existingManifest };

    const mappingPayload = await fetchJson(TICKERS_URL, {
      fetchImpl: this.fetchImpl, userAgent: this.userAgent, timeoutMs: Math.min(this.requestTimeoutMs, 30_000), maxBytes: 20 * 1024 * 1024
    });
    const mapping = tickerMap(mappingPayload);
    const mapped = uniqueTickers.map(ticker => ({ ticker, cik: mapping.get(ticker) || null }));
    const ciks = mapped.filter(item => item.cik).map(item => item.cik);
    if (!ciks.length) return { status: 'insufficient_coverage', reason: 'no_holdings_mapped_to_sec_cik', requested: true, mapped };
    await new Promise(resolve => setTimeout(resolve, 600));

    const zipPath = path.join(root, 'companyfacts.zip');
    const download = await downloadWithResume(BULK_URL, zipPath, {
      fetchImpl: this.fetchImpl, userAgent: this.userAgent, timeoutMs: this.requestTimeoutMs, maxBytes: this.maxBytes
    });
    const names = ciks.map(cikFileName);
    const selected = await readSelectedJsonEntries(zipPath, names, {
      maxEntries: 30_000,
      maxUncompressedBytes: 32 * 1024 * 1024,
      maxTotalUncompressedBytes: 1024 * 1024 * 1024
    });
    const normalizedDir = path.join(this.runtimeDir, 'normalized', 'sec-companyfacts');
    await fsp.mkdir(normalizedDir, { recursive: true });
    const extracted = [];
    for (const item of mapped) {
      if (!item.cik) continue;
      const payload = selected.values.get(cikFileName(item.cik));
      if (!payload) continue;
      const outputPath = path.join(normalizedDir, `${item.ticker}.json`);
      await atomicJson(outputPath, payload);
      extracted.push({ ticker: item.ticker, cik: item.cik, file: `${item.ticker}.json` });
    }
    const manifest = {
      provider: this.provider,
      sourceUrl: BULK_URL,
      downloadDay: day,
      downloadedAt: now.toISOString(),
      sha256: await sha256File(zipPath),
      bytes: download.bytes,
      resumedFrom: download.resumedFrom,
      requestedTickers: uniqueTickers.length,
      mappedTickers: ciks.length,
      extractedTickers: extracted.length,
      missingTickers: mapped.filter(item => !item.cik || !extracted.some(found => found.ticker === item.ticker)).map(item => item.ticker),
      extracted
    };
    await atomicJson(manifestPath, manifest);
    return { status: 'fresh', requested: true, manifest };
  }
}

module.exports = {
  BULK_URL,
  TICKERS_URL,
  SecCompanyFactsBulkSource,
  cikFileName,
  downloadWithResume,
  secUserAgent,
  tickerMap
};
