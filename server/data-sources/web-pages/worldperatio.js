'use strict';

const fs = require('fs/promises');
const path = require('path');
const { isProviderEffectivelyEnabled, providerById } = require('../../market-data/provider-compliance');
const { fetchPublicPage } = require('./public-page-fetcher');
const { extractWorldPERatio, sha256 } = require('./extraction-validator');
const { evaluateRobotsResponse } = require('./robots-check');
const {
  loadSnapshotHistory,
  mergeSnapshot,
  persistSnapshotHistory,
  writeAtomicJson
} = require('./snapshot-history');

const PROVIDER_ID = 'worldperatio';
const SOURCE_URL = 'https://worldperatio.com/index/nasdaq-100/';
const ROBOTS_URL = 'https://worldperatio.com/robots.txt';
const TERMS_REVIEW_INTERVAL_DAYS = 30;

function dayKey(date, timezone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function termsReviewStatus(termsCheckedAt, now = new Date()) {
  const checkedAt = typeof termsCheckedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(termsCheckedAt)
    ? new Date(`${termsCheckedAt}T00:00:00.000Z`)
    : null;
  if (!checkedAt || Number.isNaN(checkedAt.getTime())) {
    return { termsCheckedAt: termsCheckedAt || null, nextTermsReviewAt: null, termsReviewDue: true };
  }
  const nextReview = new Date(checkedAt.getTime() + TERMS_REVIEW_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
  return {
    termsCheckedAt,
    nextTermsReviewAt: nextReview.toISOString().slice(0, 10),
    termsReviewDue: now.getTime() >= nextReview.getTime()
  };
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isRetryableTargetError(error) {
  return ['connect-timeout', 'total-timeout'].includes(error?.webPageType)
    || (error?.webPageType === 'http-error' && Number(error.status) >= 500 && Number(error.status) <= 599);
}

function publicLastError(error) {
  if (!error) return null;
  return { type: error.type || 'fetch-failed', at: error.at || null, status: error.status || null, validationWarnings: error.validationWarnings || [] };
}

function publicModel(model) {
  if (!model) return model;
  const { contentHash, pageContentHash, fieldMetadata, publishedHistory, ...safe } = model;
  return safe;
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
    historicalStats: { '1y': null, '5y': null, '10y': null, '20y': null },
    valuationLabel: null,
    deviationFromMean: null,
    seriesAvailability: 'unavailable',
    publishedHistory: [],
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
    timezone = 'Asia/Shanghai'
  }) {
    this.rootDir = rootDir;
    this.provider = providerById(providerRegistry, PROVIDER_ID) || {};
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.sleep = sleep;
    this.retryDelayMs = retryDelayMs;
    this.timezone = timezone;
    this.runtimeDir = path.join(rootDir, 'runtime-data', 'market-data', 'web-pages', PROVIDER_ID);
    this.latestPath = path.join(this.runtimeDir, 'latest.json');
    this.statePath = path.join(this.runtimeDir, 'request-state.json');
    this.historyPath = path.join(this.runtimeDir, 'history.json');
    this.historyBackupPath = path.join(this.runtimeDir, 'history.last-good.json');
    this.latest = null;
    this.history = [];
    this.historyRecovery = null;
    this.state = {
      date: null, attempts: 0, lastAttemptAt: null, lastSuccessAt: null, lastError: null,
      robotsCheckDate: null, robotsChecks: 0, robotsCheckedAt: null, robotsHttpStatus: null, robotsStatus: 'not-checked'
    };
  }

  async init() {
    this.latest = await readJson(this.latestPath);
    this.state = { ...this.state, ...(await readJson(this.statePath) || {}) };
    const loadedHistory = await loadSnapshotHistory({ historyPath: this.historyPath, backupPath: this.historyBackupPath, now: this.now });
    this.history = loadedHistory.points;
    this.historyRecovery = loadedHistory;
    return this;
  }

  isEnabled() {
    return isProviderEffectivelyEnabled(this.provider);
  }

  getStatus() {
    const base = emptyProviderModel(this.provider);
    const hasUsableLatest = this.isEnabled() && this.latest;
    const review = termsReviewStatus(this.provider.termsCheckedAt, this.now());
    return {
      ...base,
      status: hasUsableLatest ? (this.state.lastError ? 'stale' : 'fresh') : 'unavailable',
      fetchedAt: hasUsableLatest ? this.latest.fetchedAt : null,
      sourceDataDate: hasUsableLatest ? this.latest.sourceDataDate : null,
      lastAttemptAt: this.state.lastAttemptAt,
      lastSuccessAt: this.state.lastSuccessAt,
      lastError: publicLastError(this.state.lastError),
      attemptsToday: this.state.date === dayKey(this.now(), this.timezone) ? this.state.attempts : 0,
      robotsChecksToday: this.state.robotsCheckDate === dayKey(this.now(), this.timezone) ? this.state.robotsChecks : 0,
      robotsCheckedAt: this.state.robotsCheckedAt,
      robotsHttpStatus: this.state.robotsHttpStatus,
      robotsStatus: this.state.robotsStatus,
      riskAcceptance: this.provider.riskAcceptance || null,
      ...review,
      snapshotCount: this.history.length,
      historyRecovered: Boolean(this.historyRecovery?.recovered),
      dailyRequestLimit: 2,
      normalRequestsPerDay: 1,
      delayedRetriesPerDay: 1
    };
  }

  getLatest() {
    if (!this.isEnabled() || !this.latest) return emptyProviderModel(this.provider);
    return publicModel({ ...this.latest, status: this.state.lastError ? 'stale' : this.latest.status });
  }

  getHistory() {
    const latest = this.isEnabled() ? this.latest : null;
    return {
      providerId: PROVIDER_ID,
      status: latest ? (this.state.lastError ? 'stale' : 'fresh') : 'unavailable',
      seriesAvailability: latest?.seriesAvailability || 'unavailable',
      publishedSeries: Array.isArray(latest?.publishedHistory) ? latest.publishedHistory : [],
      snapshots: this.history.map(point => ({ ...point }))
    };
  }

  getStatistics() {
    const latest = this.isEnabled() ? this.latest : null;
    return {
      providerId: PROVIDER_ID,
      status: latest ? (this.state.lastError ? 'stale' : 'fresh') : 'unavailable',
      sourceUrl: SOURCE_URL,
      sourceDataDate: latest?.sourceDataDate || null,
      currentPE: latest?.currentPE ?? null,
      historicalStats: latest?.historicalStats || { '1y': null, '5y': null, '10y': null, '20y': null },
      valuationLabel: latest?.valuationLabel || null,
      deviationFromMean: latest?.deviationFromMean ?? null,
      seriesAvailability: latest?.seriesAvailability || 'unavailable',
      fetchedAt: latest?.fetchedAt || null
    };
  }

  async recordAttempt(date, error = null) {
    const key = dayKey(date, this.timezone);
    if (this.state.date !== key) this.state = { ...this.state, date: key, attempts: 0, lastError: null };
    this.state.attempts += 1;
    this.state.lastAttemptAt = date.toISOString();
    this.state.lastError = error;
    await writeAtomicJson(this.statePath, this.state);
  }

  async recordFailure(error) {
    this.state.lastError = {
      type: error.webPageType || 'fetch-failed',
      message: error.message,
      at: this.now().toISOString(),
      status: error.status || null,
      validationWarnings: error.validationWarnings || []
    };
    await writeAtomicJson(this.statePath, this.state);
  }

  async checkRobots() {
    const checkedAt = this.now();
    const currentDay = dayKey(checkedAt, this.timezone);
    if (this.state.robotsCheckDate !== currentDay) this.state.robotsChecks = 0;
    this.state.robotsCheckDate = currentDay;
    this.state.robotsChecks += 1;
    this.state.robotsCheckedAt = checkedAt.toISOString();
    try {
      const response = await fetchPublicPage({
        url: ROBOTS_URL,
        fetchImpl: this.fetchImpl,
        allowedHosts: ['worldperatio.com', 'www.worldperatio.com'],
        accept: 'text/plain,*/*;q=0.5',
        connectTimeoutMs: 10_000,
        totalTimeoutMs: 20_000,
        maxBytes: 100_000,
        allowedStatusCodes: [404, 410]
      });
      const result = evaluateRobotsResponse({ status: response.status, text: response.text, targetUrl: SOURCE_URL });
      this.state.robotsHttpStatus = response.status;
      this.state.robotsStatus = result.status;
      await writeAtomicJson(this.statePath, this.state);
      if (!result.allowed) {
        const error = new Error(result.status === 'blocked' ? 'robots.txt blocks the target path' : 'robots.txt could not authorize the target path');
        error.webPageType = result.status === 'blocked' ? 'robots-blocked' : 'robots-unavailable';
        error.status = response.status;
        throw error;
      }
      return result;
    } catch (error) {
      if (!error.webPageType) error.webPageType = 'robots-unavailable';
      this.state.robotsStatus = error.webPageType === 'robots-blocked' ? 'blocked' : 'unavailable';
      this.state.robotsHttpStatus = error.status || this.state.robotsHttpStatus;
      await this.recordFailure(error);
      throw error;
    }
  }

  async refresh() {
    if (!this.isEnabled()) return { ok: false, statusCode: 409, reason: 'source-not-approved', provider: this.getStatus() };
    if (termsReviewStatus(this.provider.termsCheckedAt, this.now()).termsReviewDue) {
      return { ok: false, statusCode: 409, reason: 'terms-review-due', provider: this.getStatus() };
    }

    const currentDay = dayKey(this.now(), this.timezone);
    const sameDay = this.state.date === currentDay;
    const successToday = this.state.lastSuccessAt
      && dayKey(new Date(this.state.lastSuccessAt), this.timezone) === currentDay;
    const canResumeDelayedRetry = sameDay
      && this.state.attempts === 1
      && !successToday
      && isRetryableTargetError({ webPageType: this.state.lastError?.type, status: this.state.lastError?.status });
    if (sameDay && this.state.attempts > 0 && !canResumeDelayedRetry) {
      return { ok: false, statusCode: 429, reason: 'source-daily-limit', provider: this.getStatus() };
    }

    try {
      await this.checkRobots();
    } catch (error) {
      return {
        ok: false,
        statusCode: error.webPageType === 'rate-limited' ? 429 : (['forbidden', 'login-required', 'access-challenge'].includes(error.webPageType) ? 403 : 409),
        reason: error.webPageType,
        provider: this.getLatest()
      };
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
        const successAt = this.now().toISOString();
        const model = {
          providerId: PROVIDER_ID,
          sourceUrl: response.finalUrl || SOURCE_URL,
          fetchedAt: attemptAt.toISOString(),
          sourceDataDate: extracted.sourceDataDate,
          currentPE: extracted.currentPE,
          historicalStats: extracted.historicalStats,
          valuationLabel: extracted.valuationLabel,
          deviationFromMean: extracted.deviationFromMean,
          parseVersion: 'WPR-PARSE-v1',
          contentHash: sha256(response.text),
          httpStatus: response.status,
          lastSuccessAt: successAt,
          validationWarnings: extracted.validationWarnings,
          target: extracted.target,
          seriesAvailability: extracted.seriesAvailability,
          publishedHistory: extracted.publishedHistory,
          status: 'fresh'
        };
        const merged = mergeSnapshot(this.history, {
          sourceDataDate: model.sourceDataDate,
          currentPE: model.currentPE,
          fetchedAt: model.fetchedAt,
          parseVersion: model.parseVersion
        });
        if (merged.changed) {
          this.history = await persistSnapshotHistory({ historyPath: this.historyPath, backupPath: this.historyBackupPath, points: merged.points });
        }
        await writeAtomicJson(this.latestPath, model);
        this.latest = model;
        this.state.lastSuccessAt = successAt;
        this.state.lastError = null;
        await writeAtomicJson(this.statePath, this.state);
        return { ok: true, provider: this.getLatest() };
      } catch (error) {
        lastError = error;
        await this.recordFailure(error);
        if (!isRetryableTargetError(error) || index + 1 >= remaining) break;
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

module.exports = {
  PROVIDER_ID,
  ROBOTS_URL,
  SOURCE_URL,
  TERMS_REVIEW_INTERVAL_DAYS,
  WorldPERatioProvider,
  dayKey,
  emptyProviderModel,
  isRetryableTargetError,
  publicModel,
  termsReviewStatus
};
