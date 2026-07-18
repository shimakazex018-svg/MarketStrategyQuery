'use strict';

const path = require('path');
const { dayKey, fetchText, publicError, readJson, retryable, sourceError, writeAtomicJson } = require('./production-utils');

const FRED_SERIES = Object.freeze({
  vix: { seriesId: 'VIXCLS', file: 'vix.json' }, vxn: { seriesId: 'VXNCLS', file: 'vxn.json' },
  nasdaq100_index: { seriesId: 'NASDAQ100', file: 'nasdaq100.json' }, sp500_index: { seriesId: 'SP500', file: 'sp500.json' }
});

function parseFredCsv(text, seriesId, fetchedAt) {
  const lines = String(text).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const headers = lines.shift()?.split(',') || [];
  const dateIndex = headers.findIndex(value => /^(?:DATE|observation_date)$/i.test(value));
  const valueIndex = headers.indexOf(seriesId);
  if (dateIndex < 0 || valueIndex < 0) throw sourceError('schema-error', `${seriesId} CSV fields changed`);
  const values = [];
  let previous = '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = line.split(',');
    const date = fields[dateIndex];
    const raw = fields[valueIndex];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= previous) throw sourceError('schema-error', `${seriesId} dates are invalid`);
    previous = date;
    const value = raw === '.' || raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw sourceError('schema-error', `${seriesId} value is invalid`);
    values.push({ date, value });
  }
  if (!values.some(point => point.value !== null)) throw sourceError('empty-data', `${seriesId} has no usable values`);
  return { provider: 'FRED', seriesId, frequency: 'daily', fetchedAt, firstDate: values[0].date, lastDate: values.at(-1).date, rowCount: values.length, values };
}

class FredProvider {
  constructor({ productionRoot, fetchImpl = global.fetch, now = () => new Date(), timezone = 'Asia/Shanghai', sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    this.root = path.join(productionRoot, 'fred'); this.statePath = path.join(productionRoot, 'state', 'fred-state.json');
    this.fetchImpl = fetchImpl; this.now = now; this.timezone = timezone; this.sleep = sleep; this.state = { provider: 'FRED', metrics: {} };
  }
  async init() { const loaded = await readJson(this.statePath, {}); this.state = { ...this.state, ...loaded, metrics: loaded.metrics || {} }; return this; }
  async read(id) { const config = FRED_SERIES[id]; return config ? readJson(path.join(this.root, config.file), null) : null; }
  getStatus() { return { providerId: 'fred', providerName: 'FRED', enabled: true, schedule: '07:30', timezone: this.timezone, metrics: Object.fromEntries(Object.entries(FRED_SERIES).map(([id]) => [id, { ...(this.state.metrics[id] || {}), lastError: publicError(this.state.metrics[id]?.lastError) }])) }; }
  async refresh(id) {
    const config = FRED_SERIES[id]; if (!config) return { ok: false, reason: 'unknown-metric' };
    const today = dayKey(this.now(), this.timezone); const state = this.state.metrics[id] || {};
    if (state.lastSuccessDay === today) return { ok: true, reason: 'already-successful-today' };
    if (state.day === today && state.attempts >= 2) return { ok: false, reason: 'daily-limit' };
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const at = this.now(); const current = this.state.metrics[id] || {};
      this.state.metrics[id] = { ...current, day: today, attempts: current.day === today ? (current.attempts || 0) + 1 : 1, lastAttemptAt: at.toISOString() };
      await writeAtomicJson(this.statePath, this.state);
      try {
        const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(config.seriesId)}`;
        const text = await fetchText(url, { fetchImpl: this.fetchImpl, accept: 'text/csv', maxBytes: 5 * 1024 * 1024, timeoutMs: 30_000 });
        const model = parseFredCsv(text, config.seriesId, at.toISOString());
        const previous = await this.read(id);
        const previousByDate = new Map((previous?.values || []).map(point => [point.date, point.value]));
        const revisions = [...(previous?.revisions || [])];
        for (const point of model.values) {
          if (!previousByDate.has(point.date) || previousByDate.get(point.date) === point.value) continue;
          revisions.push({ date: point.date, previousValue: previousByDate.get(point.date), replacementValue: point.value, detectedAt: model.fetchedAt });
        }
        if (revisions.length) model.revisions = revisions;
        await writeAtomicJson(path.join(this.root, config.file), model);
        this.state.metrics[id] = { ...this.state.metrics[id], lastSuccessAt: this.now().toISOString(), lastSuccessDay: today, lastError: null };
        await writeAtomicJson(this.statePath, this.state); return { ok: true, model };
      } catch (error) {
        lastError = error; this.state.metrics[id] = { ...this.state.metrics[id], lastError: { type: error.type, status: error.status || null, at: this.now().toISOString() } }; await writeAtomicJson(this.statePath, this.state);
        if (!retryable(error) || error.hardStop || attempt === 1) break; await this.sleep(1500);
      }
    }
    return { ok: false, reason: lastError?.type || 'source-error' };
  }
}

module.exports = { FRED_SERIES, FredProvider, parseFredCsv };
