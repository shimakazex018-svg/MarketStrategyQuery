'use strict';

const { dateParts } = require('./request-limiter');

const SCHEDULES = Object.freeze({
  vix: { hour: 7, minute: 10 },
  vxn: { hour: 7, minute: 15 }
});
const MVP_SCHEDULES = Object.freeze({
  pe: { hour: 7, minute: 30, weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
  'nasdaq-cot-positioning': { hour: 7, minute: 30, weekdays: ['Sat'] }
});
const PRODUCTION_SCHEDULE = Object.freeze({ hour: 7, minute: 30 });
const LOCAL_ANALYSIS_METRICS = Object.freeze(['soxx_price', 'naaim_exposure']);

function zonedParts(date, timezone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
}

function isWeekend(date, timezone) {
  const weekday = zonedParts(date, timezone).weekday;
  return weekday === 'Sat' || weekday === 'Sun';
}

class MarketDataScheduler {
  constructor(service, { timezone = 'Asia/Shanghai', intervalMs = 60_000, now = () => new Date() } = {}) {
    this.service = service;
    this.timezone = timezone;
    this.intervalMs = intervalMs;
    this.now = now;
    this.timer = null;
    this.lastNormalRuns = new Map();
    this.running = false;
    this.currentProviderId = null;
    this.lastCycleStartedAt = null;
    this.lastCycleCompletedAt = null;
    this.lastCycleResult = 'waiting_first_run';
  }

  async tick() {
    const now = this.now();
    const parts = zonedParts(now, this.timezone);
    if (this.service.productionMode) return this.tickProduction(now, parts);
    if (this.service.config.selfCalculatedMvp) return this.tickSelfCalculated(now, parts);
    if (isWeekend(now, this.timezone)) return;
    const day = dateParts(now, this.timezone);
    await this.service.limiter.ensureDay(now);
    const requestState = this.service.limiter.snapshot();
    for (const [id, schedule] of Object.entries(SCHEDULES)) {
      if (!this.service.isApproved(id)) continue;
      const state = requestState.indicators[id];
      const retryDue = state?.failures > 0 && state.nextAllowedAt && now >= new Date(state.nextAllowedAt);
      const normalDue = Number(parts.hour) > schedule.hour
        || (Number(parts.hour) === schedule.hour && Number(parts.minute) >= schedule.minute);
      if (retryDue) await this.service.refresh(id, { kind: 'scheduled', requestSource: 'scheduled-retry' });
      else if (normalDue && this.lastNormalRuns.get(id) !== day && (!state?.lastAttemptAt || state.attempts === 0)) {
        this.lastNormalRuns.set(id, day);
        await this.service.refresh(id, { kind: 'scheduled', requestSource: 'daily-schedule' });
      }
    }
  }

  async tickProduction(now, parts) {
    const day = dateParts(now, this.timezone);
    const due = Number(parts.hour) > PRODUCTION_SCHEDULE.hour || (Number(parts.hour) === PRODUCTION_SCHEDULE.hour && Number(parts.minute) >= PRODUCTION_SCHEDULE.minute);
    if (!due || this.lastNormalRuns.get('production-six-metrics') === day) return;
    this.lastNormalRuns.set('production-six-metrics', day);
    this.running = true; this.lastCycleStartedAt = now.toISOString(); this.lastCycleResult = 'running';
    try {
      const results = [];
      for (const indicator of this.service.indicators) {
        this.currentProviderId = indicator.id.endsWith('_pe') ? 'worldperatio' : 'fred';
        results.push(await this.service.refresh(indicator.id, { kind: 'scheduled', requestSource: 'daily-07:30' }));
      }
      this.currentProviderId = 'ishares';
      for (const id of LOCAL_ANALYSIS_METRICS) results.push(await this.service.refresh(id, { kind: 'scheduled', requestSource: 'local-import-check' }));
      this.lastCycleResult = results.every(result => result?.ok !== false) ? 'success' : results.some(result => result?.ok) ? 'partial' : 'failed';
    } finally {
      this.running = false; this.currentProviderId = null; this.lastCycleCompletedAt = this.now().toISOString();
    }
  }

  async tickSelfCalculated(now, parts) {
    const day = dateParts(now, this.timezone);
    await this.service.limiter.ensureDay(now);
    const requestState = this.service.limiter.snapshot();
    for (const [id, schedule] of Object.entries(MVP_SCHEDULES)) {
      if (!schedule.weekdays.includes(parts.weekday) || !this.service.isApproved(id)) continue;
      const normalDue = Number(parts.hour) > schedule.hour
        || (Number(parts.hour) === schedule.hour && Number(parts.minute) >= schedule.minute);
      const attempted = requestState.indicators[id]?.attempts > 0;
      if (normalDue && !attempted && this.lastNormalRuns.get(id) !== day) {
        this.lastNormalRuns.set(id, day);
        await this.service.refresh(id, { kind: 'scheduled', requestSource: id === 'pe' ? 'daily-sec-bulk' : 'weekly-cftc-tff' });
      }
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(error => console.error('Market data scheduler:', error.message)), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  nextScheduledAt() {
    const base = this.now();
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: this.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = formatter.formatToParts(base).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
    const candidate = new Date(`${parts.year}-${parts.month}-${parts.day}T07:30:00+08:00`);
    if (candidate <= base) candidate.setUTCDate(candidate.getUTCDate() + 1);
    while ([0, 6].includes(candidate.getUTCDay())) candidate.setUTCDate(candidate.getUTCDate() + 1);
    return candidate.toISOString();
  }

  getStatus() {
    return { enabled: Boolean(this.timer), timezone: this.timezone, time: '07:30', nextScheduledAt: this.nextScheduledAt(), running: this.running, currentProviderId: this.currentProviderId, startupCatchupEnabled: true, lastCycleStartedAt: this.lastCycleStartedAt, lastCycleCompletedAt: this.lastCycleCompletedAt, lastCycleResult: this.lastCycleResult };
  }
}

module.exports = { isWeekend, LOCAL_ANALYSIS_METRICS, MarketDataScheduler, MVP_SCHEDULES, PRODUCTION_SCHEDULE, SCHEDULES, zonedParts };
