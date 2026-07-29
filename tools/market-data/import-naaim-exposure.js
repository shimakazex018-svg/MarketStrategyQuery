'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  NAAIM_METRIC_ID, assertLocalNaaimInput, inspectNaaimWorkbook,
  normalizeNaaimRows, validateStoredNaaim, CONFLICT_POLICY
} = require('../../server/data-sources/naaim-exposure-provider');
const { AcquisitionAudit } = require('../../server/market-data/acquisition-audit');

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

async function importNaaimExposure({ file, rootDir = ROOT, now = new Date(), requireProductionCoverage = rootDir === ROOT } = {}) {
  const inputPath = resolveNaaimInput(file, rootDir);
  await assertLocalNaaimInput(inputPath);
  const audit = await inspectNaaimWorkbook(inputPath);
  const normalized = normalizeNaaimRows(audit.rows, { now, conflictPolicy: CONFLICT_POLICY });
  const conflictDates = normalized.diagnostics.conflictDates;
  if (conflictDates.length > 10) throw new TypeError('NAAIM has too many conflicting dates');
  const newest52 = new Set(audit.rows.map(row => row.date).map(value => require('../../server/data-sources/naaim-exposure-provider').excelDate(value)).sort().slice(-52));
  if (conflictDates.some(date => newest52.has(date))) throw new TypeError('NAAIM has a conflict in the latest 52 weeks');
  if (requireProductionCoverage && (normalized.values.length < 500 || normalized.values.at(-1)?.date !== '2026-07-22')) throw new TypeError('NAAIM usable history does not meet coverage requirements');
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
      'NAAIM已公告自2026年8月1日起非会员访问将转为订阅模式；本地导入不代表持续访问或再分发授权。',
      `NAAIM官方工作簿中有${conflictDates.length}个早期同日冲突日期，本站已将这些日期从正式序列中排除。`
    ],
    validation: normalized.diagnostics, conflictPolicy: CONFLICT_POLICY,
    derived: normalized.derived,
    values: normalized.values
  };
  const existing = await readExisting(targetPath);
  const changed = !isSameSeries(existing, model);
  if (changed) await writeAtomic(targetPath, model);
  await writeAtomic(path.join(targetDir, 'conflict-audit.json'), { conflictPolicy: CONFLICT_POLICY, conflictCount: conflictDates.length, conflictDates, excludedConflictDates: conflictDates, excludedConflictRowCount: normalized.diagnostics.excludedConflictRowCount, limitations: [`${conflictDates.length} conflicting dates were excluded from the canonical series.`], records: normalized.quarantine });
  const state = {
    providerId: 'naaim', metricId: NAAIM_METRIC_ID, mode: 'local_import_only',
    networkFetchEnabled: false, lastImportAt: importedAt, lastResult: changed ? 'success' : 'skipped',
    sourceDataDate: model.sourceDataDate, historyStart: model.firstDate, historyEnd: model.lastDate,
    rowCount: model.rowCount, validation: model.validation, excludedConflictDateCount: conflictDates.length
  };
  await writeAtomic(statePath, state);
  await new AcquisitionAudit(path.join(rootDir, 'runtime-data'), { now: () => new Date(now) }).append({
    providerId: 'naaim', metricId: NAAIM_METRIC_ID, trigger: 'manual_import',
    startedAt: importedAt, completedAt: importedAt,
    result: changed ? 'success_with_exclusions' : 'skipped', externalRequestCount: 0,
    cacheAction: changed ? 'updated' : 'unchanged', sourceDataDate: model.sourceDataDate,
    excludedConflictDateCount: conflictDates.length
  });
  return {
    ok: true, changed, metricId: NAAIM_METRIC_ID, workbookSheets: audit.sheetNames,
    selectedSheet: audit.selectedSheet, firstDate: model.firstDate, lastDate: model.lastDate,
    rowCount: model.rowCount, ...model.validation, ...model.derived
  };
}

if (require.main === module) {
  importNaaimExposure(parseArguments(process.argv.slice(2)))
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`); process.exitCode = 2; });
}

module.exports = { IMPORT_ROOT, importNaaimExposure, parseArguments, resolveNaaimInput, writeAtomic };
