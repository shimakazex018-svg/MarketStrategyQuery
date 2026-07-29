'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  NAAIM_METRIC_ID, assertLocalNaaimInput, inspectNaaimWorkbook,
  normalizeNaaimRows, validateStoredNaaim
} = require('../../server/data-sources/naaim-exposure-provider');

const ROOT = path.resolve(__dirname, '../..');
const IMPORT_ROOT = path.join('runtime-data', 'imports', 'naaim');

function parseArguments(argv) {
  if (argv.length !== 1) throw new TypeError('Usage: node tools/market-data/import-naaim-exposure.js runtime-data/imports/naaim/<workbook>.xlsx');
  return { file: argv[0] };
}

function resolveNaaimInput(relativePath, rootDir = ROOT) {
  if (!relativePath || path.isAbsolute(relativePath)) throw new TypeError('NAAIM import path must be relative');
  const normalized = path.normalize(relativePath);
  const allowedRoot = path.resolve(rootDir, IMPORT_ROOT) + path.sep;
  const resolved = path.resolve(rootDir, normalized);
  if (!resolved.startsWith(allowedRoot) || path.extname(resolved).toLowerCase() !== '.xlsx') {
    throw new TypeError('NAAIM workbook must be an .xlsx file inside runtime-data/imports/naaim');
  }
  return resolved;
}

async function readExisting(targetPath) {
  try { return validateStoredNaaim(JSON.parse(await fs.readFile(targetPath, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function writeAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await fs.rename(temporary, filePath);
}

function isSameSeries(existing, next) {
  return existing && JSON.stringify(existing.values) === JSON.stringify(next.values);
}

async function importNaaimExposure({ file, rootDir = ROOT, now = new Date() } = {}) {
  const inputPath = resolveNaaimInput(file, rootDir);
  await assertLocalNaaimInput(inputPath);
  const audit = await inspectNaaimWorkbook(inputPath);
  const normalized = normalizeNaaimRows(audit.rows, { now });
  const targetDir = path.join(rootDir, 'runtime-data', 'market-data', 'production', 'naaim');
  const targetPath = path.join(targetDir, 'naaim-exposure.json');
  const statePath = path.join(targetDir, 'import-state.json');
  const importedAt = new Date(now).toISOString();
  const model = {
    metricId: NAAIM_METRIC_ID,
    label: 'NAAIM主动投资经理美股敞口',
    provider: 'NAAIM',
    sourceType: 'official_workbook_local_import',
    frequency: 'weekly',
    unit: 'exposure_percent',
    seriesType: 'survey_average_exposure',
    networkFetchEnabled: false,
    updateMode: 'manual_import',
    fetchedAt: null,
    importedAt,
    sourceDataDate: normalized.derived.sourceDataDate,
    firstDate: normalized.diagnostics.firstDate,
    lastDate: normalized.diagnostics.lastDate,
    rowCount: normalized.diagnostics.rowCount,
    limitations: [
      'NAAIM Exposure Index反映参与调查的主动投资经理所报告的美国股票市场平均敞口，不代表所有机构或基金经理的实际持仓。',
      '官方Excel由用户人工下载并导入；服务器不会自动访问NAAIM或MacroMicro。',
      'NAAIM已公告自2026年8月1日起非会员访问将转为订阅模式；本地导入不代表持续访问或再分发授权。'
    ],
    validation: normalized.diagnostics,
    derived: normalized.derived,
    values: normalized.values
  };
  const existing = await readExisting(targetPath);
  const changed = !isSameSeries(existing, model);
  if (changed) await writeAtomic(targetPath, model);
  const state = {
    providerId: 'naaim', metricId: NAAIM_METRIC_ID, mode: 'local_import_only',
    networkFetchEnabled: false, lastImportAt: importedAt, lastResult: changed ? 'success' : 'skipped',
    sourceDataDate: model.sourceDataDate, historyStart: model.firstDate, historyEnd: model.lastDate,
    rowCount: model.rowCount, validation: model.validation
  };
  await writeAtomic(statePath, state);
  return {
    ok: true, changed, metricId: NAAIM_METRIC_ID, workbookSheets: audit.sheetNames,
    selectedSheet: audit.selectedSheet, firstDate: model.firstDate, lastDate: model.lastDate,
    rowCount: model.rowCount, ...model.validation
  };
}

if (require.main === module) {
  importNaaimExposure(parseArguments(process.argv.slice(2)))
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`); process.exitCode = 2; });
}

module.exports = { IMPORT_ROOT, importNaaimExposure, parseArguments, resolveNaaimInput, writeAtomic };
