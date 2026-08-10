'use strict';

const fs = require('node:fs/promises');
const { normalizeFlexReport } = require('./flex-parser');

class FlexClientError extends Error {
  constructor(message, category, details = {}) {
    super(message);
    this.name = 'FlexClientError';
    this.category = category;
    Object.assign(this, details);
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function loadFlexCredentials({ rootDir, secretPath }) {
  const token = String(process.env.IBKR_FLEX_TOKEN || '').trim();
  const queryId = String(process.env.IBKR_FLEX_QUERY_ID || '').trim();
  if (token && queryId) return { token, queryId, source: 'environment' };
  const filePath = secretPath || `${rootDir}/runtime-data/portfolio-analysis/secrets/ibkr-flex.json`;
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const localToken = String(parsed?.token || '').trim();
    const localQueryId = String(parsed?.queryId || '').trim();
    if (localToken && localQueryId) return { token: localToken, queryId: localQueryId, source: 'ignored-local-file' };
  } catch (error) {
    if (error.code !== 'ENOENT') throw new FlexClientError('Flex local configuration is invalid', 'authentication_error');
  }
  return null;
}

function classifyHttp(status) {
  if (status === 401 || status === 403) return 'authentication_error';
  if (status === 408 || status === 504) return 'timeout';
  return 'http_error';
}

class FlexClient {
  constructor({ rootDir, config, fetchImpl = global.fetch, sleepImpl = sleep, now = () => new Date() } = {}) {
    this.rootDir = rootDir;
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
    this.now = now;
  }

  async readResponse(response) {
    let bytes;
    try { bytes = Buffer.from(await response.arrayBuffer()); } catch (error) { throw new FlexClientError('Flex response could not be read', 'http_error', { cause: error }); }
    if (bytes.byteLength > this.config.flexMaxReportBytes) throw new FlexClientError('Flex response exceeds the configured size limit', 'schema_error');
    const text = bytes.toString('utf8');
    if (!response.ok) throw new FlexClientError('Flex endpoint returned an HTTP error', classifyHttp(response.status), { status: response.status });
    return text;
  }

  async request(pathname, parameters) {
    const url = new URL(`${this.config.flexEndpoint.replace(/\/$/, '')}/${pathname}`);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    const started = this.now();
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/xml, text/xml, text/plain', 'User-Agent': 'MarketCycleStrategy/1.0 (personal read-only portfolio analytics)' },
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.flexTimeoutMs)
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new FlexClientError('Flex request timed out', 'timeout', { durationMs: this.now() - started });
      throw new FlexClientError('Flex request failed', 'http_error', { durationMs: this.now() - started });
    }
    const body = await this.readResponse(response);
    return { body, status: response.status, durationMs: this.now() - started };
  }

  async fetchReport() {
    const credentials = await loadFlexCredentials({ rootDir: this.rootDir, secretPath: this.config.flexSecretPath });
    if (!credentials) throw new FlexClientError('IBKR Flex credentials are not configured locally', 'authentication_error');
    const sendResponse = await this.request('SendRequest', { t: credentials.token, q: credentials.queryId, v: '3' });
    const generated = normalizeFlexReport(sendResponse.body);
    if (!generated.ok) throw new FlexClientError('Flex report generation failed', generated.errorCategory, { errorCode: generated.errorCode });
    if (generated.statements?.length) return generated;
    if (!generated.referenceCode) throw new FlexClientError('Flex response has no reference code', 'schema_error');
    await this.sleepImpl(this.config.flexPollDelayMs);
    let lastError = null;
    for (let attempt = 0; attempt <= this.config.flexPollAttempts; attempt += 1) {
      try {
        const reportResponse = await this.request('GetStatement', { q: generated.referenceCode, t: credentials.token, v: '3' });
        const report = normalizeFlexReport(reportResponse.body);
        if (report.ok) return { ...report, referenceCode: generated.referenceCode, externalRequestCount: attempt + 2 };
        lastError = report;
        if (report.errorCategory !== 'report_generation_pending' || attempt === this.config.flexPollAttempts) break;
      } catch (error) {
        lastError = error;
        if (error.category !== 'report_generation_pending' || attempt === this.config.flexPollAttempts) break;
      }
      await this.sleepImpl(this.config.flexPollDelayMs);
    }
    if (lastError instanceof FlexClientError) throw lastError;
    throw new FlexClientError('Flex report is not ready', lastError?.errorCategory || 'report_generation_pending', { errorCode: lastError?.errorCode || null });
  }
}

module.exports = { FlexClient, FlexClientError, classifyHttp, loadFlexCredentials, sleep };
