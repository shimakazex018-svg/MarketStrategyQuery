'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  normalizeSoxxRows,
  parseSoxxCsv,
  parseSpreadsheetMl,
  validateStoredSoxx
} = require('../../server/data-sources/etf-price-provider');

const ROOT = path.resolve(__dirname, '../..');
const TARGET = path.join(ROOT, 'runtime-data', 'market-data', 'production', 'etf', 'soxx.json');

function parseArguments(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) positional.push(value);
    else {
      const key = value.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new TypeError(`Missing value for --${key}`);
      options[key] = next;
      index += 1;
    }
  }
  if (positional.length !== 1) throw new TypeError('Usage: node tools/market-data/import-soxx-history.js <runtime-relative-file> --series-type <type> --adjustment-status <status> --source <official-ishares|local-csv> [--source-url <url>]');
  return { file: positional[0], ...options };
}

function resolveRuntimeInput(relativePath, rootDir = ROOT) {
  if (!relativePath || path.isAbsolute(relativePath)) throw new TypeError('SOXX import path must be relative');
  const resolved = path.resolve(rootDir, relativePath);
  const runtimeRoot = path.join(rootDir, 'runtime-data') + path.sep;
  if (!resolved.startsWith(runtimeRoot)) throw new TypeError('SOXX import file must be inside runtime-data');
  return resolved;
}

function validateSourceUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol)) throw new TypeError('SOXX source URL must use HTTP or HTTPS');
  return url.toString();
}

async function writeAtomicIfChanged(filePath, value, previous = null) {
  if (previous && JSON.stringify(previous.values) === JSON.stringify(value.values)
    && previous.seriesType === value.seriesType && previous.adjustmentStatus === value.adjustmentStatus
    && previous.provider === value.provider) return false;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await fs.rename(tempPath, filePath);
  return true;
}

function mergeValues(existing, incoming) {
  const byDate = new Map((existing || []).map(point => [point.date, Number(point.value)]));
  for (const point of incoming) {
    if (byDate.has(point.date) && byDate.get(point.date) !== point.value) throw new TypeError(`SOXX imported value conflicts with stored value for ${point.date}`);
    byDate.set(point.date, point.value);
  }
  return [...byDate.entries()].map(([date, value]) => ({ date, value })).sort((left, right) => left.date.localeCompare(right.date));
}

async function importSoxxHistory({ file, 'series-type': seriesType, 'adjustment-status': adjustmentStatus, source, 'source-url': sourceUrl, now = new Date(), rootDir = ROOT, targetPath = path.join(rootDir, 'runtime-data', 'market-data', 'production', 'etf', 'soxx.json') }) {
  if (!['official-ishares', 'local-csv'].includes(source)) throw new TypeError('SOXX source must be explicit');
  const inputPath = resolveRuntimeInput(file, rootDir);
  if (source === 'local-csv' && path.basename(inputPath).toLowerCase() !== 'soxx-daily.csv') throw new TypeError('Local SOXX CSV must be named soxx-daily.csv');
  const input = await fs.readFile(inputPath);
  const officialSpreadsheet = source === 'official-ishares';
  if (officialSpreadsheet && seriesType !== 'nav') throw new TypeError('Official iShares Historical worksheet is NAV only');
  if (officialSpreadsheet && adjustmentStatus !== 'provider_adjusted') throw new TypeError('Official iShares history must preserve provider_adjusted status');
  const rows = officialSpreadsheet ? parseSpreadsheetMl(input) : parseSoxxCsv(input, seriesType);
  const normalized = normalizeSoxxRows(rows, { seriesType, adjustmentStatus, now, officialSpreadsheet });

  let existing = null;
  try { existing = validateStoredSoxx(JSON.parse(await fs.readFile(targetPath, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const provider = officialSpreadsheet ? 'iShares / BlackRock' : 'Local CSV';
  if (existing && (existing.seriesType !== seriesType || existing.adjustmentStatus !== adjustmentStatus || existing.provider !== provider)) {
    throw new TypeError('SOXX import cannot mix providers or series types');
  }
  const mergedValues = mergeValues(existing?.values, normalized.values);
  const merged = normalizeSoxxRows(mergedValues.map(point => ({ Date: point.date, Value: point.value, Symbol: 'SOXX' })), {
    seriesType, adjustmentStatus, now
  });
  const fetchedAt = new Date(now).toISOString();
  const model = {
    metricId: 'soxx_price',
    symbol: 'SOXX',
    name: 'iShares Semiconductor ETF',
    provider,
    frequency: 'daily',
    seriesType,
    adjustmentStatus,
    currency: 'USD',
    sourceUrl: validateSourceUrl(sourceUrl),
    fetchedAt,
    firstDate: merged.diagnostics.firstDate,
    lastDate: merged.diagnostics.lastDate,
    rowCount: merged.values.length,
    limitations: officialSpreadsheet
      ? ['SOXX NAV，不代表交易所市场成交价格', '仅限个人非商业本机使用', '未授权自动抓取，更新需重新导入官方公开文件']
      : ['本地CSV口径由导入参数明确指定', '更新需运行离线导入命令'],
    audit: {
      provider,
      sourceUrl: validateSourceUrl(sourceUrl),
      accessType: officialSpreadsheet ? 'public_visible_download' : 'local_csv_import',
      robotsStatus: officialSpreadsheet ? 'allowed_target_path' : 'not_applicable',
      termsReviewStatus: officialSpreadsheet ? 'personal_download_allowed_automation_prohibited' : 'user_supplied',
      loginRequired: false,
      entitlementRequired: false,
      dataFrequency: 'daily',
      seriesType,
      adjustmentStatus,
      complianceStatus: 'approved_with_conditions'
    },
    validation: { ...normalized.diagnostics, rowCount: merged.values.length, firstDate: merged.diagnostics.firstDate, lastDate: merged.diagnostics.lastDate },
    values: merged.values
  };
  const changed = await writeAtomicIfChanged(targetPath, model, existing);
  return {
    ok: true,
    metricId: model.metricId,
    seriesType,
    adjustmentStatus,
    firstDate: model.firstDate,
    lastDate: model.lastDate,
    rowCount: model.rowCount,
    missingCount: model.validation.missingCount,
    duplicateCount: model.validation.duplicateCount,
    conflictCount: model.validation.conflictCount,
    abnormalGapCount: model.validation.abnormalGapCount,
    splitCheckStatus: model.validation.splitCheckStatus,
    changed
  };
}

if (require.main === module) {
  importSoxxHistory(parseArguments(process.argv.slice(2)))
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`); process.exitCode = 2; });
}

module.exports = { TARGET, importSoxxHistory, mergeValues, parseArguments, resolveRuntimeInput, writeAtomicIfChanged };
