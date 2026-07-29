'use strict';

const fs = require('fs/promises');
const path = require('path');

const MAX_RECORDS = 200;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function safeRecord(input = {}) {
  return {
    runId: String(input.runId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    providerId: String(input.providerId || 'unknown'),
    metricId: String(input.metricId || 'unknown'),
    trigger: ['scheduled', 'scheduled_weekly', 'scheduled_retry', 'startup_catchup', 'manual_import', 'local_reload', 'service_start'].includes(input.trigger) ? input.trigger : 'scheduled',
    startedAt: input.startedAt || null,
    completedAt: input.completedAt || null,
    result: ['success', 'success_with_exclusions', 'no_change', 'source_revision_detected', 'authentication_required', 'subscription_required', 'failed', 'skipped', 'cached', 'partial'].includes(input.result) ? input.result : 'failed',
    externalRequestCount: Math.max(0, Number(input.externalRequestCount) || 0),
    cacheAction: ['updated', 'unchanged', 'preserved', 'stale_fallback', 'none'].includes(input.cacheAction) ? input.cacheAction : 'none',
    sourceDataDate: /^\d{4}-\d{2}-\d{2}$/.test(input.sourceDataDate || '') ? input.sourceDataDate : null,
    errorCategory: input.errorCategory ? String(input.errorCategory).replace(/[^a-z0-9_-]/gi, '_').slice(0, 64) : null,
    excludedConflictDateCount: Math.max(0, Number(input.excludedConflictDateCount) || 0)
  };
}

class AcquisitionAudit {
  constructor(runtimeRoot, { now = () => new Date() } = {}) {
    this.dir = path.join(runtimeRoot, 'system');
    this.filePath = path.join(this.dir, 'data-acquisition-audit.json');
    this.now = now;
  }

  async read() {
    try {
      const text = await fs.readFile(this.filePath, 'utf8');
      const records = JSON.parse(text);
      if (!Array.isArray(records)) throw new TypeError('audit must be an array');
      return records.map(safeRecord);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      const corrupt = `${this.filePath}.corrupt-${this.now().toISOString().replace(/[:.]/g, '-')}`;
      try { await fs.rename(this.filePath, corrupt); } catch { /* preserve read-only availability */ }
      return [];
    }
  }

  async write(records) {
    await fs.mkdir(this.dir, { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    await fs.rename(temp, this.filePath);
  }

  async append(record) {
    const cutoff = this.now().valueOf() - MAX_AGE_MS;
    const current = await this.read();
    const next = [...current, safeRecord(record)]
      .filter(item => !item.completedAt || new Date(item.completedAt).valueOf() >= cutoff)
      .slice(-MAX_RECORDS);
    await this.write(next);
    return next;
  }
}

module.exports = { AcquisitionAudit, MAX_AGE_MS, MAX_RECORDS, safeRecord };
