'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { importNaaimExposure, prepareNaaimImport } = require('../../tools/market-data/import-naaim-exposure');

const OFFICIAL_PAGE = 'https://naaim.org/programs/naaim-exposure-index/';
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

function boundedFetch(fetchImpl, url, options) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetchImpl(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function isoWeek(date, timezone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  const value = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`); const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return `${value.getUTCFullYear()}-W${String(Math.ceil((((value - start) / 86400000) + 1) / 7)).padStart(2, '0')}`;
}

function categoryFor(response, text = '') {
  if (response?.status === 401 || /login|sign in|password/i.test(text)) return 'authentication_required';
  if (response?.status === 403 || /subscribe|subscription|member access/i.test(text)) return 'subscription_required';
  if (response?.status === 429) return 'rate_limited';
  return 'source_unavailable';
}

function discoverOfficialWorkbookLink(html, pageUrl = OFFICIAL_PAGE) {
  const anchors = [...String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const match = anchors.find(item => /download\s+excel.*since\s+inception/i.test(item[2].replace(/<[^>]+>/g, ' ')) && /\.xlsx(?:[?#]|$)/i.test(item[1]));
  if (!match) throw Object.assign(new TypeError('NAAIM official page has no workbook link'), { category: 'source_unavailable' });
  const url = new URL(match[1], pageUrl);
  if (url.protocol !== 'https:' || (url.hostname !== 'naaim.org' && !url.hostname.endsWith('.naaim.org')) || !/\.xlsx$/i.test(url.pathname)) {
    throw Object.assign(new TypeError('NAAIM workbook link is not an official HTTPS XLSX URL'), { category: 'source_unavailable' });
  }
  return url.toString();
}

async function readState(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
async function writeAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); await fs.rename(temporary, filePath);
}
function compactWorkbookId(url) { try { return path.basename(new URL(url).pathname).replace(/[^a-z0-9._-]/gi, '_').slice(0, 120); } catch { return null; } }

class NaaimOfficialUpdater {
  constructor({ rootDir, fetchImpl = global.fetch, now = () => new Date(), timezone = 'Asia/Shanghai' }) {
    this.rootDir = rootDir; this.fetchImpl = fetchImpl; this.now = now; this.timezone = timezone;
    this.statePath = path.join(rootDir, 'runtime-data', 'market-data', 'production', 'naaim', 'updater-state.json');
  }
  async getState() { return readState(this.statePath); }
  async due({ startup = false } = {}) {
    const now = this.now(); const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: this.timezone, weekday: 'short' }).format(now);
    const hourMinute = new Intl.DateTimeFormat('en-GB', { timeZone: this.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    if (!['Fri', 'Sat'].includes(weekday) || hourMinute < '07:30') return false;
    const state = await this.getState(); const week = isoWeek(now, this.timezone); const day = new Intl.DateTimeFormat('en-CA', { timeZone: this.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    if (state.week === week && state.lastAttemptDay === day) return false;
    if (state.week === week && state.updatedThisWeek) return false;
    return true;
  }
  async update({ trigger = 'scheduled_weekly', startup = false } = {}) {
    const startedAt = this.now().toISOString(); const state = await this.getState(); const week = isoWeek(this.now(), this.timezone);
    const persist = async patch => { const next = { ...state, ...patch, week, updatedAt: this.now().toISOString() }; await writeAtomic(this.statePath, next); return next; };
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: this.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(this.now());
    let externalRequestCount = 0; let temporary = null;
    try {
      const page = await boundedFetch(this.fetchImpl, OFFICIAL_PAGE, { headers: { Accept: 'text/html' }, redirect: 'error' }); externalRequestCount += 1;
      const html = await page.text();
      if (!page.ok) { const result = categoryFor(page, html); await persist({ lastAttemptAt: startedAt, lastAttemptDay: day, result, accessState: result, externalRequestCount }); return { ok: false, result, externalRequestCount }; }
      const workbookUrl = discoverOfficialWorkbookLink(html, OFFICIAL_PAGE);
      const download = await boundedFetch(this.fetchImpl, workbookUrl, { headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, redirect: 'error' }); externalRequestCount += 1;
      const body = Buffer.from(await download.arrayBuffer());
      if (!download.ok || body.length < 4 || body.length > MAX_DOWNLOAD_BYTES || body.subarray(0, 4).toString('binary') !== 'PK\x03\x04') throw Object.assign(new TypeError('NAAIM workbook download is invalid'), { category: categoryFor(download, body.subarray(0, 300).toString('utf8')) });
      const relative = path.join('runtime-data', 'imports', 'naaim', `.naaim-official-${Date.now()}.xlsx`); temporary = path.join(this.rootDir, relative); await fs.mkdir(path.dirname(temporary), { recursive: true }); await fs.writeFile(temporary, body, { flag: 'wx' });
      const candidate = await prepareNaaimImport({ file: relative, rootDir: this.rootDir, now: this.now(), requireProductionCoverage: true });
      const currentPath = path.join(this.rootDir, 'runtime-data', 'market-data', 'production', 'naaim', 'naaim-exposure.json');
      let current = null; try { current = JSON.parse(await fs.readFile(currentPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const sourceDataDate = candidate.model.sourceDataDate;
      if (current?.sourceDataDate >= sourceDataDate) {
        const result = current.sourceDataDate === sourceDataDate && JSON.stringify(current.values) !== JSON.stringify(candidate.model.values) ? 'source_revision_detected' : 'no_change';
        await persist({ lastAttemptAt: startedAt, lastAttemptDay: day, lastDownloadedAt: this.now().toISOString(), latestWorkbookId: compactWorkbookId(workbookUrl), sourceDataDate: current.sourceDataDate, result, accessState: 'public_official_workbook', externalRequestCount });
        return { ok: true, changed: false, result, sourceDataDate: current.sourceDataDate, externalRequestCount };
      }
      const imported = await importNaaimExposure({ file: relative, rootDir: this.rootDir, now: this.now(), requireProductionCoverage: true, trigger, externalRequestCount, writeAudit: false });
      await persist({ lastAttemptAt: startedAt, lastAttemptDay: day, lastSuccessAt: this.now().toISOString(), lastDownloadedAt: this.now().toISOString(), latestWorkbookId: compactWorkbookId(workbookUrl), sourceDataDate, result: 'success', accessState: 'public_official_workbook', externalRequestCount, updatedThisWeek: true });
      return { ok: true, changed: imported.changed, result: 'success', sourceDataDate, externalRequestCount };
    } catch (error) {
      const result = error.category || 'source_unavailable'; await persist({ lastAttemptAt: startedAt, lastAttemptDay: day, result, accessState: result, externalRequestCount }); return { ok: false, result, externalRequestCount };
    } finally { if (temporary) await fs.rm(temporary, { force: true }); }
  }
}

module.exports = { OFFICIAL_PAGE, REQUEST_TIMEOUT_MS, NaaimOfficialUpdater, categoryFor, discoverOfficialWorkbookLink, isoWeek };
