'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = path.join(ROOT, 'runtime-data', 'market-data-lab', 'core-data-acquisition');
const TARGET = path.join(ROOT, 'runtime-data', 'market-data', 'production');
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function readJson(filePath) { return JSON.parse(await fs.readFile(filePath, 'utf8')); }

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(`${label} is invalid`);
  return number;
}

function validateFred(input, seriesId) {
  if (input?.seriesId !== seriesId || !Array.isArray(input.values)) throw new TypeError(`${seriesId} source structure is invalid`);
  let previous = '';
  const values = input.values.map(point => {
    if (!ISO_DATE.test(point?.date || '') || point.date <= previous) throw new TypeError(`${seriesId} dates are invalid`);
    previous = point.date;
    return { date: point.date, value: point.value === null ? null : finite(point.value, `${seriesId} value`) };
  });
  if (!values.some(point => point.value !== null)) throw new TypeError(`${seriesId} has no usable observations`);
  return { provider: 'FRED', seriesId, frequency: 'daily', fetchedAt: input.fetchedAt, firstDate: values[0].date, lastDate: values.at(-1).date, rowCount: values.length, values };
}

function validatePe(input, target) {
  if (!input || !ISO_DATE.test(input.sourceDataDate || '')) throw new TypeError(`${target} PE date is invalid`);
  const stats = {};
  for (const years of [1, 5, 10, 20]) stats[`${years}y`] = { average: finite(input[`average${years}Y`], `${target} ${years}y average`), standardDeviation: finite(input[`stdDev${years}Y`], `${target} ${years}y standard deviation`) };
  return { provider: 'WorldPEratio', target, currentPE: finite(input.currentPE, `${target} PE`), sourceDataDate: input.sourceDataDate, fetchedAt: input.fetchedAt, valuationLabel: input.valuationLabel || null, historicalStatistics: stats, historyType: 'snapshot_history', sourceUrl: input.sourceUrl || null };
}

function validateSnapshots(input, target) {
  if (!Array.isArray(input)) throw new TypeError(`${target} snapshots are invalid`);
  const byDate = new Map();
  for (const point of input) {
    if (!ISO_DATE.test(point?.sourceDataDate || '')) throw new TypeError(`${target} snapshot date is invalid`);
    const value = finite(point.value, `${target} snapshot`);
    const previous = byDate.get(point.sourceDataDate);
    if (previous && previous.value !== value) throw new TypeError(`${target} snapshot date conflicts`);
    byDate.set(point.sourceDataDate, { sourceDataDate: point.sourceDataDate, value, fetchedAt: point.fetchedAt || null, provider: 'WorldPEratio' });
  }
  return [...byDate.values()].sort((a, b) => a.sourceDataDate.localeCompare(b.sourceDataDate));
}

async function writeAtomicIfChanged(filePath, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try { if (await fs.readFile(filePath, 'utf8') === text) return false; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, text, { encoding: 'utf8', flag: 'wx' });
  await fs.rename(temp, filePath);
  return true;
}

async function importSuccessfulData() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const fred = {
    vix: validateFred(await readJson(path.join(SOURCE, 'normalized', 'fred-vix.json')), 'VIXCLS'),
    vxn: validateFred(await readJson(path.join(SOURCE, 'normalized', 'fred-vxn.json')), 'VXNCLS'),
    nasdaq100: validateFred(await readJson(path.join(SOURCE, 'normalized', 'fred-nasdaq100.json')), 'NASDAQ100'),
    sp500: validateFred(await readJson(path.join(SOURCE, 'normalized', 'fred-sp500.json')), 'SP500')
  };
  const pe = {
    nasdaq100: validatePe(await readJson(path.join(SOURCE, 'normalized', 'worldperatio-nasdaq100-pe.json')), 'Nasdaq-100'),
    sp500: validatePe(await readJson(path.join(SOURCE, 'normalized', 'worldperatio-sp500-pe.json')), 'S&P 500')
  };
  const snapshots = {
    nasdaq100: validateSnapshots(await readJson(path.join(SOURCE, 'snapshots', 'nasdaq100-pe.json')), 'Nasdaq-100'),
    sp500: validateSnapshots(await readJson(path.join(SOURCE, 'snapshots', 'sp500-pe.json')), 'S&P 500')
  };
  const writes = [];
  for (const [name, model] of Object.entries(fred)) writes.push(await writeAtomicIfChanged(path.join(TARGET, 'fred', `${name}.json`), model));
  for (const [name, model] of Object.entries(pe)) writes.push(await writeAtomicIfChanged(path.join(TARGET, 'worldperatio', `${name}-pe.json`), model));
  for (const [name, points] of Object.entries(snapshots)) writes.push(await writeAtomicIfChanged(path.join(TARGET, 'snapshots', `${name}-pe-history.json`), points));
  await writeAtomicIfChanged(path.join(TARGET, 'state', 'fred-state.json'), { provider: 'FRED', importedSourceDates: Object.fromEntries(Object.entries(fred).map(([id, model]) => [id, model.lastDate])), metrics: Object.fromEntries(['vix', 'vxn', 'nasdaq100_index', 'sp500_index'].map(id => [id, { lastSuccessDay: today, attempts: 0, lastError: null }])) });
  await writeAtomicIfChanged(path.join(TARGET, 'state', 'worldperatio-state.json'), { provider: 'WorldPEratio', importedSourceDates: Object.fromEntries(Object.entries(pe).map(([id, model]) => [id, model.sourceDataDate])), metrics: Object.fromEntries(['nasdaq100_pe', 'sp500_pe'].map(id => [id, { lastSuccessDay: today, attempts: 0, lastError: null }])) });
  return { ok: true, metrics: 6, fredSeries: 4, peReferences: 2, changedFiles: writes.filter(Boolean).length };
}

if (require.main === module) importSuccessfulData().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`); process.exitCode = 2; });

module.exports = { SOURCE, TARGET, importSuccessfulData, validateFred, validatePe, validateSnapshots, writeAtomicIfChanged };
