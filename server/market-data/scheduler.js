'use strict';

const { dateParts } = require('./request-limiter');

const SCHEDULES = Object.freeze({
  vix: { hour: 7, minute: 10 },
  vxn: { hour: 7, minute: 15 }
});

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
  }

  async tick() {
    const now = this.now();
    const parts = zonedParts(now, this.timezone);
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

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(error => console.error('Market data scheduler:', error.message)), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { isWeekend, MarketDataScheduler, SCHEDULES, zonedParts };
