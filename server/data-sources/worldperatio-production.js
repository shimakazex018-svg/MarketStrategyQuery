'use strict';

const path = require('path');
const { dayKey, fetchText, publicError, readJson, retryable, sourceError, writeAtomicJson } = require('./production-utils');

const PE_TARGETS = Object.freeze({
  nasdaq100_pe: { key: 'nasdaq100', url: 'https://worldperatio.com/index/nasdaq-100/', file: 'nasdaq100-pe.json', history: 'nasdaq100-pe-history.json', targetPattern: /Nasdaq\s*-?\s*100/i },
  sp500_pe: { key: 'sp500', url: 'https://worldperatio.com/index/sp-500/', file: 'sp500-pe.json', history: 'sp500-pe-history.json', targetPattern: /S\s*&\s*P\s*500|S\s*and\s*P\s*500/i }
});

function visibleText(html) { return String(html).replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(); }

function sourceDate(text) {
  const match = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text); if (!match) return null;
  const date = new Date(`${match[2]} ${match[1]}, ${match[3]} UTC`); return Number.isFinite(date.valueOf()) ? date.toISOString().slice(0, 10) : null;
}

function parseWorldPERatioPage(html, target, fetchedAt) {
  const text = visibleText(html); if (!target.targetPattern.test(text)) throw sourceError('schema-error', 'PE target identity is missing');
  const matches = [...text.matchAll(/P\/E Ratio\s+([0-9]+(?:\.[0-9]+)?)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/gi)];
  const unique = [...new Map(matches.map(match => [`${match[1]}|${match[2]}`, match])).values()];
  if (unique.length !== 1) throw sourceError('schema-error', unique.length ? 'PE value is ambiguous' : 'PE value or date is missing');
  const currentPE = Number(unique[0][1]); const sourceDataDate = sourceDate(unique[0][2]);
  if (!Number.isFinite(currentPE) || currentPE <= 0 || currentPE >= 500 || !sourceDataDate) throw sourceError('validation-error', 'PE value or date is invalid');
  const historicalStatistics = {};
  for (const years of [1, 5, 10, 20]) {
    const match = new RegExp(`Last ${years}Y\\s+([0-9]+(?:\\.[0-9]+)?)\\s+([0-9]+(?:\\.[0-9]+)?)`, 'i').exec(text);
    if (!match) throw sourceError('schema-error', `PE ${years} year statistics are missing`);
    historicalStatistics[`${years}y`] = { average: Number(match[1]), standardDeviation: Number(match[2]) };
  }
  const valuation = /current P\/E can be considered\s+(Fair|Overvalued|Expensive|Undervalued|Cheap)/i.exec(text);
  return { provider: 'WorldPEratio', target: target.key === 'nasdaq100' ? 'Nasdaq-100' : 'S&P 500', currentPE, sourceDataDate, fetchedAt, valuationLabel: valuation?.[1] || null, historicalStatistics, historyType: 'snapshot_history', sourceUrl: target.url };
}

function mergePeSnapshot(points, point) {
  const current = Array.isArray(points) ? points.map(item => ({ ...item })) : []; const revisions = [];
  const index = current.findIndex(item => item.sourceDataDate === point.sourceDataDate);
  if (index >= 0) {
    if (current[index].value === point.value) return { points: current, revisions, changed: false };
    const revision = { sourceDataDate: point.sourceDataDate, previousValue: current[index].value, replacementValue: point.value, detectedAt: point.fetchedAt };
    revisions.push(revision); current[index] = { ...point, revisions: [...(current[index].revisions || []), revision] };
  } else current.push(point);
  current.sort((a, b) => a.sourceDataDate.localeCompare(b.sourceDataDate)); return { points: current, revisions, changed: true };
}

class WorldPERatioProductionProvider {
  constructor({ productionRoot, fetchImpl = global.fetch, now = () => new Date(), timezone = 'Asia/Shanghai', sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    this.root = path.join(productionRoot, 'worldperatio'); this.snapshotsRoot = path.join(productionRoot, 'snapshots'); this.statePath = path.join(productionRoot, 'state', 'worldperatio-state.json');
    this.fetchImpl = fetchImpl; this.now = now; this.timezone = timezone; this.sleep = sleep; this.state = { provider: 'WorldPEratio', metrics: {} };
  }
  async init() { const loaded = await readJson(this.statePath, {}); this.state = { ...this.state, ...loaded, metrics: loaded.metrics || {} }; return this; }
  async read(id) { const target = PE_TARGETS[id]; return target ? readJson(path.join(this.root, target.file), null) : null; }
  async readHistory(id) { const target = PE_TARGETS[id]; return target ? readJson(path.join(this.snapshotsRoot, target.history), []) : []; }
  getStatus() { return { providerId: 'worldperatio', providerName: 'WorldPEratio', enabled: true, schedule: '07:30', timezone: this.timezone, metrics: Object.fromEntries(Object.keys(PE_TARGETS).map(id => [id, { ...(this.state.metrics[id] || {}), lastError: publicError(this.state.metrics[id]?.lastError) }])) }; }
  async refresh(id) {
    const target = PE_TARGETS[id]; if (!target) return { ok: false, reason: 'unknown-metric' };
    const today = dayKey(this.now(), this.timezone); const state = this.state.metrics[id] || {};
    if (state.lastSuccessDay === today) return { ok: true, reason: 'already-successful-today' };
    if (state.day === today && state.attempts >= 2) return { ok: false, reason: 'daily-limit' };
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const at = this.now(); const current = this.state.metrics[id] || {};
      this.state.metrics[id] = { ...current, day: today, attempts: current.day === today ? (current.attempts || 0) + 1 : 1, lastAttemptAt: at.toISOString() }; await writeAtomicJson(this.statePath, this.state);
      try {
        const html = await fetchText(target.url, { fetchImpl: this.fetchImpl, accept: 'text/html,application/xhtml+xml', maxBytes: 5 * 1024 * 1024, timeoutMs: 30_000 });
        const model = parseWorldPERatioPage(html, target, at.toISOString()); const historyPath = path.join(this.snapshotsRoot, target.history);
        const merged = mergePeSnapshot(await readJson(historyPath, []), { sourceDataDate: model.sourceDataDate, value: model.currentPE, fetchedAt: model.fetchedAt, provider: 'WorldPEratio' });
        if (merged.changed) await writeAtomicJson(historyPath, merged.points); if (merged.revisions.length) model.revisions = merged.revisions;
        await writeAtomicJson(path.join(this.root, target.file), model);
        this.state.metrics[id] = { ...this.state.metrics[id], lastSuccessAt: this.now().toISOString(), lastSuccessDay: today, lastError: null }; await writeAtomicJson(this.statePath, this.state);
        return { ok: true, model };
      } catch (error) {
        lastError = error; this.state.metrics[id] = { ...this.state.metrics[id], lastError: { type: error.type, status: error.status || null, at: this.now().toISOString() } }; await writeAtomicJson(this.statePath, this.state);
        if (!retryable(error) || error.hardStop || attempt === 1) break; await this.sleep(1500);
      }
    }
    return { ok: false, reason: lastError?.type || 'source-error' };
  }
}

module.exports = { PE_TARGETS, WorldPERatioProductionProvider, mergePeSnapshot, parseWorldPERatioPage, visibleText };
