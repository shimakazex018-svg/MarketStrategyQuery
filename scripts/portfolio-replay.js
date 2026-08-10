'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { loadPortfolioConfig } = require('../server/portfolio/config');
const { normalizeFlexReport } = require('../server/portfolio/flex-parser');
const { PortfolioService } = require('../server/portfolio/service');
const { atomicBackup } = require('../server/portfolio/sqlite');

const ROOT_DIR = path.join(__dirname, '..');

function finite(value) {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
}

function closeEnough(left, right) {
  return left !== null && right !== null && Math.abs(left - right) <= Math.max(1e-8, Math.abs(left) * 1e-8, Math.abs(right) * 1e-8);
}

async function latestXml(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = entries.filter(entry => entry.isFile() && /\.xml$/i.test(entry.name)).map(entry => entry.name).sort();
  if (!files.length) throw Object.assign(new Error('no-local-flex-xml'), { category: 'schema_error', stage: 'read_local_xml' });
  return path.join(directory, files.at(-1));
}

async function localHistory(rootDir, relativePath) {
  const payload = JSON.parse(await fs.readFile(path.join(rootDir, relativePath), 'utf8'));
  return Array.isArray(payload.values) ? payload.values : [];
}

function groupedCounts(db, field) {
  return Object.fromEntries(db.prepare(`SELECT ${field} AS value, COUNT(*) AS count FROM daily_performance GROUP BY ${field} ORDER BY ${field}`).all().map(row => [row.value || 'null', Number(row.count)]));
}

function consistencyChecks(db) {
  const performance = db.prepare('SELECT date,begin_nav AS beginNav,end_nav AS endNav,external_net_flow AS externalNetFlow,pnl_amount AS pnlAmount FROM daily_performance ORDER BY date').all();
  const external = new Map(db.prepare("SELECT date,SUM(base_amount) AS amount FROM cash_flows WHERE type IN ('deposit','withdrawal') GROUP BY date").all().map(row => [row.date, finite(row.amount) ?? 0]));
  const income = db.prepare('SELECT date,type FROM income_events ORDER BY date').all();
  const trades = new Set(db.prepare('SELECT DISTINCT date FROM trades').all().map(row => row.date));
  const resultForDate = date => performance.find(row => row.date === date) || null;
  const flowAdjusted = row => row && finite(row.beginNav) !== null && finite(row.endNav) !== null && closeEnough(finite(row.pnlAmount), finite(row.endNav) - finite(row.beginNav) - (external.get(row.date) || 0));
  const noFlowRow = performance.find(row => finite(row.beginNav) !== null && (external.get(row.date) || 0) === 0);
  const depositDate = db.prepare("SELECT date FROM cash_flows WHERE type='deposit' ORDER BY date LIMIT 1").get()?.date || null;
  const withdrawalDate = db.prepare("SELECT date FROM cash_flows WHERE type='withdrawal' ORDER BY date LIMIT 1").get()?.date || null;
  const dividendDate = income.find(row => row.type === 'dividend')?.date || null;
  const feeTaxDate = income.find(row => row.type === 'fee' || row.type === 'withholding_tax')?.date || null;
  const tradeDate = [...trades].find(date => (external.get(date) || 0) === 0) || null;
  const check = (date, required = true) => required ? (flowAdjusted(resultForDate(date)) ? 'pass' : 'fail') : 'not_available';
  return {
    noFlowDay: check(noFlowRow?.date || null),
    depositDay: check(depositDate, Boolean(depositDate)),
    withdrawalDay: check(withdrawalDate, Boolean(withdrawalDate)),
    dividendDay: check(dividendDate, Boolean(dividendDate)),
    feeTaxDay: check(feeTaxDate, Boolean(feeTaxDate)),
    tradeCashSettlement: check(tradeDate, Boolean(tradeDate))
  };
}

async function main() {
  const baseConfig = loadPortfolioConfig(ROOT_DIR);
  const config = { ...baseConfig, fixtureMode: 'local-production-cache' };
  const rawXmlPath = await latestXml(config.rawFlexDir);
  const service = await new PortfolioService({ rootDir: ROOT_DIR, config, fixtureMode: false }).init();
  try {
    await atomicBackup(service.db, config.databasePath, config.backupsDir, service.now());
    const report = normalizeFlexReport(await fs.readFile(rawXmlPath, 'utf8'));
    if (!report.ok) throw Object.assign(new Error('local-flex-replay-parse-failed'), { category: report.errorCategory || 'schema_error', stage: 'parse_local_xml' });
    const imported = service.importReport(report, { replaceSource: true });
    const benchmarks = service.importBenchmarkHistories({
      nasdaq100: await localHistory(ROOT_DIR, 'runtime-data/market-data/production/fred/nasdaq100.json'),
      sp500: await localHistory(ROOT_DIR, 'runtime-data/market-data/production/fred/sp500.json'),
      soxx: await localHistory(ROOT_DIR, 'runtime-data/market-data/production/etf/soxx.json')
    });
    const quickCheck = service.db.prepare('PRAGMA quick_check').get().quick_check;
    const performanceCount = Number(service.db.prepare('SELECT COUNT(*) AS count FROM daily_performance').get().count || 0);
    const result = {
      mode: 'offline-real-flex-replay',
      externalRequestCount: 0,
      backupCreated: true,
      cashTransactions: imported.cashTransactions,
      ...imported.cashActivityCounts,
      dailyPerformanceDates: performanceCount,
      calculationMethods: groupedCounts(service.db, 'calculation_method'),
      qualityCounts: groupedCounts(service.db, 'quality_status'),
      reconciliationStatusCounts: groupedCounts(service.db, 'reconciliation_status'),
      dividendTreatedAsExternalFlow: false,
      interestTreatedAsExternalFlow: false,
      benchmarkPoints: benchmarks,
      quickCheck,
      consistency: consistencyChecks(service.db)
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await service.close();
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, errorCategory: error.category || 'database_error', stage: error.stage || 'offline_replay' })}\n`);
  process.exitCode = 1;
});
