'use strict';

const RETRY_DELAYS_MINUTES = Object.freeze([15, 60, 180]);

function dateParts(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

class RequestLimiter {
  constructor(cacheStore, config, now = () => new Date()) {
    this.cacheStore = cacheStore;
    this.config = config;
    this.now = now;
    this.state = { day: null, indicators: {}, providers: {} };
    this.locks = new Set();
  }

  async init() {
    const cached = await this.cacheStore.readRequestState();
    if (cached.data && typeof cached.data === 'object') this.state = cached.data;
    await this.ensureDay();
    return cached.error;
  }

  async ensureDay(now = this.now()) {
    const day = dateParts(now, this.config.timezone);
    if (this.state.day !== day) {
      this.state = { day, indicators: {}, providers: {} };
      await this.persist();
    }
    return day;
  }

  indicatorState(id) {
    return this.state.indicators[id] || {
      attempts: 0, failures: 0, lastAttemptAt: null, lastSuccessAt: null,
      lastManualAt: null, nextAllowedAt: null, lastErrorType: null
    };
  }

  async canAttempt(id, provider, kind = 'scheduled', now = this.now()) {
    await this.ensureDay(now);
    if (this.locks.has(id)) return { ok: false, reason: 'in-progress' };
    const indicator = this.indicatorState(id);
    if (indicator.attempts >= this.config.maxAttemptsPerDay) return { ok: false, reason: 'indicator-daily-limit' };
    if ((this.state.providers[provider] || 0) >= this.config.providerDailyLimit) return { ok: false, reason: 'provider-daily-limit' };
    if (indicator.nextAllowedAt && now < new Date(indicator.nextAllowedAt)) return { ok: false, reason: 'cooldown', nextAllowedAt: indicator.nextAllowedAt };
    if (kind === 'manual' && indicator.lastManualAt) {
      const nextManual = new Date(new Date(indicator.lastManualAt).valueOf() + this.config.manualRefreshCooldownMinutes * 60_000);
      if (now < nextManual) return { ok: false, reason: 'manual-cooldown', nextAllowedAt: nextManual.toISOString() };
    }
    return { ok: true };
  }

  begin(id) {
    if (this.locks.has(id)) return false;
    this.locks.add(id);
    return true;
  }

  end(id) {
    this.locks.delete(id);
  }

  async recordAttempt(id, provider, kind = 'scheduled', now = this.now()) {
    await this.ensureDay(now);
    const indicator = this.indicatorState(id);
    indicator.attempts += 1;
    indicator.lastAttemptAt = now.toISOString();
    if (kind === 'manual') indicator.lastManualAt = now.toISOString();
    this.state.indicators[id] = indicator;
    this.state.providers[provider] = (this.state.providers[provider] || 0) + 1;
    await this.persist();
    return indicator;
  }

  async recordSuccess(id, now = this.now()) {
    const indicator = this.indicatorState(id);
    indicator.failures = 0;
    indicator.lastSuccessAt = now.toISOString();
    indicator.nextAllowedAt = null;
    indicator.lastErrorType = null;
    this.state.indicators[id] = indicator;
    await this.persist();
    return indicator;
  }

  async recordFailure(id, errorType, now = this.now()) {
    const indicator = this.indicatorState(id);
    indicator.failures += 1;
    indicator.lastErrorType = errorType;
    const delay = RETRY_DELAYS_MINUTES[indicator.failures - 1];
    indicator.nextAllowedAt = delay && indicator.attempts < this.config.maxAttemptsPerDay
      ? new Date(now.valueOf() + delay * 60_000).toISOString()
      : null;
    this.state.indicators[id] = indicator;
    await this.persist();
    return indicator;
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  persist() {
    return this.cacheStore.writeRequestState(this.state);
  }
}

module.exports = { RETRY_DELAYS_MINUTES, RequestLimiter, dateParts };
