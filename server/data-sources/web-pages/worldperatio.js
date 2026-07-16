'use strict';

const fs = require('fs/promises');
const path = require('path');
const { isProviderEffectivelyEnabled, providerById } = require('../../market-data/provider-compliance');
const { fetchPublicPage } = require('./public-page-fetcher');
const { extractWorldPERatio, sha256 } = require('./extraction-validator');

const PROVIDER_ID = 'worldperatio';
const SOURCE_URL = 'https://worldperatio.com/index/nasdaq-100/';
const RETRYABLE_TYPES = new Set(['network', 'connect-timeout', 'total-timeout', 'http-error']);

function dayKey(date, timezone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(tempPath, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

function emptyProviderModel(provider = {}) {
  return {
    providerId: PROVIDER_ID,
    providerName: 'WorldPEratio',
    enabled: isProviderEffectivelyEnabled(provider),
    complianceStatus: provider.complianceStatus || 'not_evaluated',
    selectionStatus: provider.selectionStatus || 'candidate',
    sourceUrl: SOURCE_URL,
    target: 'Nasdaq-100 reference calculated on QQQ ETF',
    accessMethod: 'server-rendered-html',
    robotsStatus: 'allowed_at_last_audit',
    termsStatus: 'no_terms_page_found; automated_cache_and_display_permission_unconfirmed',
    parseVersion: 'WPR-PARSE-v1',
    fetchedAt: null,
    sourceDataDate: null,
    currentPE: null,
    historicalMean: null,
    historicalMedian: null,
    historicalStdDev: null,
    valuationLabel: null,
    status: 'unavailable',
    validationWarnings: []
  };
}

class WorldPERatioProvider {
  constructor({
    rootDir,
    providerRegistry,
    fetchImpl = null,
    now = () => new Date(),
    sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
    retryDelayMs = 60_000,
    timezone = 'Asia/Shanghai',
    robotsStatus = 'allowed'
  }) {
    this.rootDir = rootDir;
    this.provider = providerById(providerRegistry, PROVIDER_ID) || {};
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.sleep = sleep;
    this.retryDelayMs = retryDelayMs;
    this.timezone = timezone;
    this.robotsStatus = robotsStatus;
    this.runtimeDir = path.join(rootDir, 'runtime-data', 'market-data', 'web-pages', PROVIDER_ID);
    this.latestPath = path.join(this.runtimeDir, 'latest.json');
    this.statePath = path.join(this.runtimeDir, 'request-state.json');
    this.latest = null;
    this.state = { date: null, attempts: 0, lastAttemptAt: null, lastSuccessAt: null, lastError: null };
  }

  async init() {
    this.latest = await readJson(this.latestPath);
    this.state = { ...this.state, ...(await readJson(this.statePath) || {}) };
    return this;
  }

  isEnabled() {
    return isProviderEffectivelyEnabled(this.provider);
  }

  getStatus() {
    const base = emptyProviderModel(this.provider);
    const hasUsableLatest = this.isEnabled() && this.latest;
    return {
      ...base,
      status: hasUsableLatest ? (this.state.lastError ? 'stale' : 'fresh') : 'unavailable',
      fetchedAt: hasUsableLatest ? this.latest.fetchedAt : null,
      sourceDataDate: hasUsableLatest ? this.latest.sourceDataDate : null,
      lastAttemptAt: this.state.lastAttemptAt,
      lastSuccessAt: this.state.lastSuccessAt,
      lastError: this.state.lastError,
      attemptsToday: this.state.date === dayKey(this.now(), this.timezone) ? this.state.attempts : 0,
      dailyRequestLimit: 2,
      normalRequestsPerDay: 1,
      delayedRetriesPerDay: 1
    };
  }

  getLatest() {
    if (!this.isEnabled() || !this.latest) return emptyProviderModel(this.provider);
    return { ...this.latest, status: this.state.lastError ? 'stale' : this.latest.status };
  }

  async recordAttempt(date, error = null) {
    const key = dayKey(date, this.timezone);
    if (this.state.date !== key) this.state = { ...this.state, date: key, attempts: 0, lastError: null };
    this.state.attempts += 1;
    this.state.lastAttemptAt = date.toISOString();
    this.state.lastError = error;
    await writeAtomic(this.statePath, this.state);
  }

  async recordFailure(error) {
    this.state.lastError = {
      type: error.webPageType || 'fetch-failed',
      message: error.message,
      at: this.now().toISOString(),
      status: error.status || null,
      validationWarnings: error.validationWarnings || []
    };
    await writeAtomic(this.statePath, this.state);
  }

  async refresh() {
    if (!this.isEnabled()) return { ok: false, statusCode: 409, reason: 'source-not-approved', provider: this.getStatus() };
    if (this.robotsStatus !== 'allowed') return { ok: false, statusCode: 409, reason: 'robots-not-allowed', provider: this.getStatus() };

    const currentDay = dayKey(this.now(), this.timezone);
    const sameDay = this.state.date === currentDay;
    const successToday = this.state.lastSuccessAt
      && dayKey(new Date(this.state.lastSuccessAt), this.timezone) === currentDay;
    const canResumeDelayedRetry = sameDay
      && this.state.attempts === 1
      && !successToday
      && RETRYABLE_TYPES.has(this.state.lastError?.type);
    if (sameDay && this.state.attempts > 0 && !canResumeDelayedRetry) {
      return { ok: false, statusCode: 429, reason: 'source-daily-limit', provider: this.getStatus() };
    }

    let lastError;
    const remaining = canResumeDelayedRetry ? 1 : 2;
    for (let index = 0; index < remaining; index += 1) {
      const attemptAt = this.now();
      await this.recordAttempt(attemptAt);
      try {
        const response = await fetchPublicPage({
          url: SOURCE_URL,
          fetchImpl: this.fetchImpl,
          allowedHosts: ['worldperatio.com', 'www.worldperatio.com'],
          connectTimeoutMs: 10_000,
          totalTimeoutMs: 20_000,
          maxBytes: 750_000
        });
        const extracted = extractWorldPERatio(response.text, { sourceUrl: response.finalUrl || SOURCE_URL, extractedAt: attemptAt.toISOString() });
        const model = {
          ...emptyProviderModel(this.provider),
          ...extracted,
          enabled: true,
          fetchedAt: attemptAt.toISOString(),
          sourceUrl: response.finalUrl || SOURCE_URL,
          httpStatus: response.status,
          pageContentHash: sha256(response.text),
          status: 'fresh'
        };
        await writeAtomic(this.latestPath, model);
        this.latest = model;
        this.state.lastSuccessAt = attemptAt.toISOString();
        this.state.lastError = null;
        await writeAtomic(this.statePath, this.state);
        return { ok: true, provider: this.getLatest() };
      } catch (error) {
        lastError = error;
        await this.recordFailure(error);
        if (!RETRYABLE_TYPES.has(error.webPageType) || index + 1 >= remaining) break;
        await this.sleep(this.retryDelayMs);
      }
    }

    return {
      ok: false,
      statusCode: ['forbidden', 'login-required', 'access-challenge'].includes(lastError?.webPageType) ? 403 : (lastError?.webPageType === 'rate-limited' ? 429 : 502),
      reason: lastError?.webPageType || 'fetch-failed',
      provider: this.getLatest()
    };
  }
}

module.exports = { PROVIDER_ID, SOURCE_URL, WorldPERatioProvider, dayKey, emptyProviderModel };
