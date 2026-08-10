'use strict';

function zonedParts(date, timezone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
}

function dateParts(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
}

function dateKey(date, timezone) {
  const parts = dateParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

class PortfolioSyncScheduler {
  constructor(service, { timezone, time = '10:30', intervalMs = 60_000, now = () => new Date() } = {}) {
    this.service = service;
    this.timezone = timezone || service.config.timezone;
    const [hour, minute] = String(time || service.config.syncTime || '10:30').split(':').map(Number);
    this.hour = Number.isInteger(hour) ? hour : 10;
    this.minute = Number.isInteger(minute) ? minute : 30;
    this.intervalMs = intervalMs;
    this.now = now;
    this.timer = null;
    this.running = false;
    this.lastCycleStartedAt = null;
    this.lastCycleCompletedAt = null;
    this.lastCycleResult = 'waiting_first_run';
  }

  due(now = this.now()) {
    const parts = zonedParts(now, this.timezone);
    return Number(parts.hour) > this.hour || (Number(parts.hour) === this.hour && Number(parts.minute) >= this.minute);
  }

  async tick({ startup = false } = {}) {
    const now = this.now();
    if (!this.due(now)) return null;
    const day = dateKey(now, this.timezone);
    if (!this.service.syncDue(day)) return { ok: true, result: 'already-attempted-today' };
    this.running = true;
    this.lastCycleStartedAt = now.toISOString();
    this.lastCycleResult = 'running';
    try {
      const result = await this.service.sync({ trigger: startup ? 'startup_catchup' : 'scheduled_daily' });
      this.lastCycleResult = result.ok ? 'success' : result.result === 'waiting_configuration' ? 'waiting_configuration' : result.result || 'failed';
      return result;
    } catch (error) {
      this.lastCycleResult = 'failed';
      return { ok: false, result: 'failed', errorCategory: 'database_error' };
    } finally {
      this.running = false;
      this.lastCycleCompletedAt = this.now().toISOString();
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), this.intervalMs);
    this.timer.unref?.();
    void this.tick({ startup: true });
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  nextScheduledAt() {
    const now = this.now();
    const parts = dateParts(now, this.timezone);
    let candidate = new Date(`${parts.year}-${parts.month}-${parts.day}T${String(this.hour).padStart(2, '0')}:${String(this.minute).padStart(2, '0')}:00+08:00`);
    if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 1);
    return candidate.toISOString();
  }

  getStatus() {
    return { enabled: Boolean(this.timer), timezone: this.timezone, time: `${String(this.hour).padStart(2, '0')}:${String(this.minute).padStart(2, '0')}`, nextScheduledAt: this.nextScheduledAt(), startupCatchupEnabled: true, running: this.running, lastCycleStartedAt: this.lastCycleStartedAt, lastCycleCompletedAt: this.lastCycleCompletedAt, lastCycleResult: this.lastCycleResult };
  }
}

module.exports = { PortfolioSyncScheduler, dateKey, dateParts, zonedParts };
