'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PortfolioAuth } = require('./auth');
const { loadPortfolioConfig } = require('./config');
const { FlexClient, loadFlexCredentials } = require('./flex-client');
const { seedSyntheticPortfolio } = require('./fixture');
const { aggregatePerformance, calculateDailyPerformance, finite, maskAccountId, monthlyPerformance, normalizeFlowType, normalizeSignedFlow, productReturn } = require('./performance');
const { atomicBackup, closePortfolioDatabase, openPortfolioDatabase, withTransaction } = require('./sqlite');

const RANGE_KEYS = Object.freeze(['1D', 'MTD', '3M', '6M', 'YTD', '1Y', 'ALL', 'CUSTOM']);
const MAX_API_POINTS = 8_000;

function isoNow(now) { return new Date(now()).toISOString(); }
function dayKey(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function hashKey(...parts) { return crypto.createHash('sha256').update(parts.map(value => String(value ?? '')).join('|')).digest('hex').slice(0, 48); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }
function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}
function dateShift(dateString, unit, amount) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (unit === 'day') date.setUTCDate(date.getUTCDate() + amount);
  if (unit === 'month') date.setUTCMonth(date.getUTCMonth() + amount);
  if (unit === 'year') date.setUTCFullYear(date.getUTCFullYear() + amount);
  return date.toISOString().slice(0, 10);
}

function combinePerformanceRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.date)) groups.set(row.date, []);
    groups.get(row.date).push(row);
  }
  let cumulativeFactor = 1;
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, items]) => {
    const sum = field => items.reduce((total, item) => total + (finite(item[field]) ?? 0), 0);
    const sumKnown = field => {
      const values = items.map(item => finite(item[field]));
      return values.every(value => value !== null) ? values.reduce((total, value) => total + value, 0) : null;
    };
    const beginNav = sumKnown('begin_nav');
    const endNav = sumKnown('end_nav');
    const externalNetFlow = sum('external_net_flow');
    const pnlAmount = sumKnown('pnl_amount');
    const dailyReturn = beginNav !== null && beginNav !== 0 && pnlAmount !== null ? pnlAmount / beginNav : null;
    if (dailyReturn !== null && dailyReturn > -1) cumulativeFactor *= 1 + dailyReturn;
    return {
      date, beginNav, endNav, externalNetFlow, pnlAmount, dailyReturn,
      cumulativeReturn: dailyReturn === null ? null : cumulativeFactor - 1,
      totalCash: sumKnown('total_cash'),
      grossPositionValue: sumKnown('gross_position_value'),
      reconciliationDifference: sumKnown('reconciliation_difference'),
      qualityStatus: items.some(item => item.quality_status === 'warning') ? 'warning' : items.some(item => item.quality_status === 'incomplete') ? 'incomplete' : 'reconciled',
      calculationMethod: items.some(item => item.calculation_method === 'ibkr_reported') ? 'ibkr_reported' : 'modified_dietz_daily',
      flowCount: items.reduce((total, item) => total + Number(item.flow_count || 0), 0)
    };
  });
}

function parseRange(value) {
  const range = String(value || '1Y').toUpperCase();
  return RANGE_KEYS.includes(range) ? range : null;
}

class PortfolioService {
  constructor({ rootDir, config = loadPortfolioConfig(rootDir), fetchImpl = global.fetch, now = () => new Date(), marketDataService = null, fixtureMode = null } = {}) {
    this.rootDir = rootDir;
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.marketDataService = marketDataService;
    this.fixtureMode = fixtureMode || config.fixtureMode === 'synthetic-review-fixture';
    this.dbHandle = null;
    this.db = null;
    this.auth = null;
    this.flexClient = null;
    this.state = {};
    this.credentialsConfigured = false;
    this.syncRunning = false;
    this.syncLockHandle = null;
  }

  async init() {
    const directories = [this.config.runtimeRoot, this.config.rawFlexDir, this.config.importsDir, this.config.backupsDir, this.config.auditDir, this.config.stateDir, this.config.logsDir, this.config.secretsDir];
    await Promise.all(directories.map(directory => fs.mkdir(directory, { recursive: true })));
    this.dbHandle = await openPortfolioDatabase(this.fixtureMode ? ':memory:' : this.config.databasePath);
    this.db = this.dbHandle.db;
    this.auth = await new PortfolioAuth({ passwordPath: this.config.passwordPath, sessionTtlMs: this.config.sessionTtlMs, secureCookie: this.config.secureCookie, fixtureMode: this.fixtureMode, now: this.now }).init();
    this.flexClient = new FlexClient({ rootDir: this.rootDir, config: this.config, fetchImpl: this.fetchImpl, now: this.now });
    if (this.fixtureMode) seedSyntheticPortfolio(this.db, this.now());
    await this.loadState();
    try {
      this.credentialsConfigured = Boolean(await loadFlexCredentials({ rootDir: this.rootDir, secretPath: this.config.flexSecretPath }));
    } catch (error) {
      this.credentialsConfigured = false;
      this.credentialsErrorCategory = error.category || 'authentication_error';
    }
    return this;
  }

  async close() {
    await this.releaseSyncLock();
    closePortfolioDatabase(this.dbHandle);
    this.dbHandle = null;
    this.db = null;
  }

  async loadState() {
    try { this.state = JSON.parse(await fs.readFile(path.join(this.config.stateDir, 'portfolio-sync.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') this.state = {}; }
  }

  async saveState(next = {}) {
    this.state = { ...this.state, ...next };
    const destination = path.join(this.config.stateDir, 'portfolio-sync.json');
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, destination);
  }

  accountKey(accountId) { return `acct_${hashKey('ibkr', accountId).slice(0, 24)}`; }

  databaseCounts() {
    const getCount = table => Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count || 0);
    const coverage = this.db.prepare('SELECT MIN(date) AS firstDate, MAX(date) AS lastDate FROM account_daily_snapshots').get();
    const latest = this.db.prepare('SELECT MAX(date) AS latestDate FROM account_daily_snapshots').get();
    return { accounts: getCount('portfolio_accounts'), snapshots: getCount('account_daily_snapshots'), cashFlows: getCount('cash_flows'), trades: getCount('trades'), positions: getCount('positions_daily'), incomeEvents: getCount('income_events'), performance: getCount('daily_performance'), firstDate: coverage.firstDate || null, lastDate: coverage.lastDate || null, latestDate: latest.latestDate || null };
  }

  lastSyncRun() {
    const row = this.db.prepare('SELECT run_id AS runId, trigger, started_at AS startedAt, ended_at AS endedAt, result, report_date AS reportDate, imported_row_counts AS importedRowCounts, warnings, error_category AS errorCategory, stage, ibkr_error_code AS ibkrErrorCode, diagnostics_json AS diagnosticsJson, external_request_count AS externalRequestCount FROM portfolio_sync_runs ORDER BY started_at DESC LIMIT 1').get() || null;
    if (!row) return null;
    return { ...row, diagnostics: parseJson(row.diagnosticsJson, []) };
  }

  getStatus(scheduler = null) {
    const counts = this.databaseCounts();
    const lastRun = this.lastSyncRun();
    const hasSuccessfulCache = Boolean(this.state.lastSuccessfulAt) || lastRun?.result === 'success' || counts.performance > 0;
    const status = this.fixtureMode || counts.performance > 0
      ? (lastRun?.result === 'failed' && !hasSuccessfulCache ? 'sync_error' : 'ready')
      : lastRun?.result === 'failed' ? 'sync_error' : 'disconnected';
    return {
      enabled: true,
      status,
      dataMode: this.fixtureMode ? 'synthetic-review-fixture' : 'local-production-cache',
      readOnly: true,
      automaticTrading: false,
      authConfigured: this.auth?.isConfigured() || false,
      credentialsConfigured: this.fixtureMode ? false : this.credentialsConfigured,
      accountCount: counts.accounts,
      accounts: this.db.prepare('SELECT masked_account_label AS label, base_currency AS baseCurrency, first_seen AS firstSeen, last_seen AS lastSeen FROM portfolio_accounts ORDER BY account_key').all(),
      historyStart: counts.firstDate,
      historyEnd: counts.lastDate,
      latestDataDate: counts.latestDate,
      recordCounts: { snapshots: counts.snapshots, cashFlows: counts.cashFlows, trades: counts.trades, positions: counts.positions, incomeEvents: counts.incomeEvents, performance: counts.performance },
      lastSync: lastRun ? { trigger: lastRun.trigger, startedAt: lastRun.startedAt, endedAt: lastRun.endedAt, result: lastRun.result, reportDate: lastRun.reportDate, errorCategory: lastRun.errorCategory, stage: lastRun.stage, ibkrErrorCode: lastRun.ibkrErrorCode, diagnostics: lastRun.diagnostics, externalRequestCount: lastRun.externalRequestCount } : null,
      lastSuccessfulAt: this.state.lastSuccessfulAt || null,
      lastSuccessfulDay: this.state.lastSuccessfulDay || null,
      nextScheduledAt: scheduler?.nextScheduledAt?.() || null,
      syncTime: this.config.syncTime,
      timezone: this.config.timezone,
      revisionWindowDays: this.config.revisionWindowDays,
      rawFlex: { enabled: this.config.preserveRawFlex, retentionDays: this.config.rawRetentionDays, diskUsageBytes: null },
      database: { available: Boolean(this.db), schemaVersion: this.dbHandle?.schemaVersion || null, quickCheck: this.db ? this.db.prepare('PRAGMA quick_check').get().quick_check === 'ok' : false }
    };
  }

  syncDue(day) {
    let lastAttemptDay = this.state.lastAttemptDay || null;
    if (!lastAttemptDay && this.state.lastAttemptAt) {
      try { lastAttemptDay = dayKey(this.state.lastAttemptAt, this.config.timezone); } catch { lastAttemptDay = null; }
    }
    return lastAttemptDay !== day;
  }

  async acquireSyncLock() {
    if (this.syncRunning) return false;
    const lockPath = path.join(this.config.stateDir, 'sync.lock');
    try { this.syncLockHandle = await fs.open(lockPath, 'wx'); } catch (error) { if (error.code === 'EEXIST') return false; throw error; }
    this.syncRunning = true;
    return true;
  }

  async releaseSyncLock() {
    const lockPath = path.join(this.config.stateDir, 'sync.lock');
    try { await this.syncLockHandle?.close(); } catch { /* lock cleanup is best effort */ }
    this.syncLockHandle = null;
    this.syncRunning = false;
    try { await fs.rm(lockPath, { force: true }); } catch { /* preserve service shutdown */ }
  }

  createRun(trigger) {
    const runId = `${new Date(this.now()).toISOString().replace(/[^0-9]/g, '')}-${crypto.randomBytes(5).toString('hex')}`;
    const startedAt = isoNow(this.now);
    this.db.prepare('INSERT INTO portfolio_sync_runs(run_id,trigger,started_at,result,imported_row_counts,warnings,stage,ibkr_error_code,diagnostics_json,external_request_count) VALUES(?,?,?,?,?,?,?,?,?,?)').run(runId, trigger, startedAt, 'running', '{}', '[]', 'start', null, '[]', 0);
    return { runId, startedAt };
  }

  finishRun(run, result, details = {}) {
    this.db.prepare('UPDATE portfolio_sync_runs SET ended_at=?,result=?,report_date=?,imported_row_counts=?,warnings=?,error_category=?,stage=?,ibkr_error_code=?,diagnostics_json=?,external_request_count=? WHERE run_id=?').run(isoNow(this.now), result, details.reportDate || null, JSON.stringify(details.importedRowCounts || {}), JSON.stringify(details.warnings || []), details.errorCategory || null, details.stage || null, details.ibkrErrorCode || null, JSON.stringify(details.diagnostics || []), Number(details.externalRequestCount || 0), run.runId);
  }

  async writeRawFlex(report) {
    if (!this.config.preserveRawFlex || !report?.rawXml) return null;
    const date = validDate(report.reportDate) ? report.reportDate : new Date(this.now()).toISOString().slice(0, 10);
    const destination = path.join(this.config.rawFlexDir, `activity-${date}.xml`);
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, report.rawXml, 'utf8');
    await fs.rename(temporary, destination);
    return destination;
  }

  async writeFlexCapabilityAudit(audit) {
    if (!audit) return null;
    const destination = path.join(this.config.auditDir, 'flex-capability.json');
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, destination);
    return destination;
  }

  importReport(report) {
    const importedAt = isoNow(this.now);
    const counts = { accounts: 0, snapshots: 0, cashFlows: 0, trades: 0, positions: 0, incomeEvents: 0, performance: 0 };
    const reportRowsByAccount = new Map();
    const accountKeys = new Set();
    withTransaction(this.db, () => {
      for (const statement of report.statements || []) {
        if (!statement.accountId) throw Object.assign(new Error('Flex statement has no account identifier'), { category: 'schema_error', stage: 'import_database' });
        const accountKey = this.accountKey(statement.accountId);
        accountKeys.add(accountKey);
        const baseCurrency = statement.baseCurrency || statement.snapshots.find(row => row.baseCurrency)?.baseCurrency;
        if (!baseCurrency) throw Object.assign(new Error('Flex statement has no base currency'), { category: 'schema_error', stage: 'import_database' });
        const existing = this.db.prepare('SELECT first_seen AS firstSeen, last_seen AS lastSeen FROM portfolio_accounts WHERE account_key=?').get(accountKey);
        const statementDates = [...statement.snapshots, ...statement.cashFlows, ...statement.trades, ...statement.positions, ...statement.incomeEvents].map(row => row.date).filter(validDate).sort();
        const firstSeen = statementDates[0] || existing?.firstSeen || null;
        const lastSeen = statementDates.at(-1) || existing?.lastSeen || null;
        this.db.prepare(`INSERT INTO portfolio_accounts(account_key,account_id,masked_account_label,base_currency,first_seen,last_seen,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account_key) DO UPDATE SET account_id=excluded.account_id, masked_account_label=excluded.masked_account_label, base_currency=excluded.base_currency, first_seen=COALESCE(portfolio_accounts.first_seen,excluded.first_seen), last_seen=MAX(portfolio_accounts.last_seen,excluded.last_seen), updated_at=excluded.updated_at`).run(accountKey, statement.accountId, maskAccountId(statement.accountId), baseCurrency, firstSeen, lastSeen, importedAt, importedAt);
        counts.accounts += existing ? 0 : 1;
        const snapshotByDate = new Map();
        for (const row of statement.snapshots) {
          if (!validDate(row.date)) continue;
          const current = snapshotByDate.get(row.date) || { date: row.date, baseCurrency };
          for (const field of ['netLiquidation', 'totalCash', 'grossPositionValue', 'stockMarketValue', 'optionMarketValue', 'otherMarketValue', 'accruedCash']) if (finite(row[field]) !== null) current[field] = finite(row[field]);
          snapshotByDate.set(row.date, current);
        }
        const snapshotInsert = this.db.prepare(`INSERT INTO account_daily_snapshots(account_key,date,base_currency,net_liquidation,total_cash,gross_position_value,stock_market_value,option_market_value,other_market_value,accrued_cash,source,imported_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_key,date) DO UPDATE SET base_currency=excluded.base_currency, net_liquidation=COALESCE(excluded.net_liquidation,account_daily_snapshots.net_liquidation), total_cash=COALESCE(excluded.total_cash,account_daily_snapshots.total_cash), gross_position_value=COALESCE(excluded.gross_position_value,account_daily_snapshots.gross_position_value), stock_market_value=COALESCE(excluded.stock_market_value,account_daily_snapshots.stock_market_value), option_market_value=COALESCE(excluded.option_market_value,account_daily_snapshots.option_market_value), other_market_value=COALESCE(excluded.other_market_value,account_daily_snapshots.other_market_value), accrued_cash=COALESCE(excluded.accrued_cash,account_daily_snapshots.accrued_cash), source=excluded.source, imported_at=excluded.imported_at`);
        for (const row of snapshotByDate.values()) { snapshotInsert.run(accountKey, row.date, row.baseCurrency, row.netLiquidation ?? null, row.totalCash ?? null, row.grossPositionValue ?? null, row.stockMarketValue ?? null, row.optionMarketValue ?? null, row.otherMarketValue ?? null, row.accruedCash ?? null, 'ibkr-flex', importedAt); counts.snapshots += 1; }
        const flowInsert = this.db.prepare('INSERT OR REPLACE INTO cash_flows(flow_id,account_key,occurred_at,date,type,amount,currency,base_amount,exchange_rate,description,source_id,source,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const row of statement.cashFlows) {
          if (!validDate(row.date) || finite(row.amount ?? row.baseAmount) === null) continue;
          const type = normalizeFlowType(row.type, row.amount);
          const amount = normalizeSignedFlow(type, row.baseAmount ?? row.amount);
          const sourceId = row.sourceId || hashKey('cash', accountKey, JSON.stringify(row));
          flowInsert.run(sourceId, accountKey, row.occurredAt, row.date, type, amount, row.currency || baseCurrency, finite(row.baseAmount) ?? amount, finite(row.exchangeRate), row.description, sourceId, 'ibkr-flex', importedAt); counts.cashFlows += 1;
        }
        const tradeInsert = this.db.prepare('INSERT OR REPLACE INTO trades(execution_id,account_key,symbol,conid,security_type,currency,occurred_at,date,side,quantity,price,proceeds,commission,realized_pnl,source_id,source,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const row of statement.trades) {
          if (!validDate(row.date)) continue;
          const sourceId = row.sourceId || hashKey('trade', accountKey, JSON.stringify(row));
          tradeInsert.run(sourceId, accountKey, row.symbol, row.conid, row.securityType, row.currency || baseCurrency, row.occurredAt, row.date, row.side, finite(row.quantity), finite(row.price), finite(row.proceeds), finite(row.commission), finite(row.realizedPnl), sourceId, 'ibkr-flex', importedAt); counts.trades += 1;
        }
        const positionInsert = this.db.prepare('INSERT OR REPLACE INTO positions_daily(position_key,account_key,date,conid,symbol,security_type,currency,quantity,market_price,market_value,cost_basis,unrealized_pnl,realized_pnl,source_id,source,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const row of statement.positions) {
          if (!validDate(row.date)) continue;
          const positionKey = hashKey('position', accountKey, row.date, row.conid || '', row.symbol || '', row.currency || '');
          positionInsert.run(positionKey, accountKey, row.date, row.conid, row.symbol, row.securityType, row.currency || baseCurrency, finite(row.quantity), finite(row.marketPrice ?? row.price), finite(row.marketValue), finite(row.costBasis), finite(row.unrealizedPnl), finite(row.realizedPnl), row.sourceId || positionKey, 'ibkr-flex', importedAt); counts.positions += 1;
        }
        const incomeInsert = this.db.prepare('INSERT OR REPLACE INTO income_events(event_id,account_key,date,occurred_at,type,symbol,amount,currency,base_amount,exchange_rate,description,source_id,source,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const row of statement.incomeEvents) {
          if (!validDate(row.date) || finite(row.amount ?? row.baseAmount) === null) continue;
          const eventId = row.sourceId || hashKey('income', accountKey, JSON.stringify(row));
          const typeText = String(row.type || row.section || 'other_income_expense').toLowerCase();
          const type = /dividend/.test(typeText) ? 'dividend' : /interest/.test(typeText) ? 'interest' : /withhold|tax/.test(typeText) ? 'withholding_tax' : /fee|commission/.test(typeText) ? 'fee' : 'other_income_expense';
          const amount = finite(row.baseAmount) ?? finite(row.amount);
          incomeInsert.run(eventId, accountKey, row.date, row.occurredAt, type, row.symbol, amount, row.currency || baseCurrency, amount, finite(row.exchangeRate), row.description, eventId, 'ibkr-flex', importedAt); counts.incomeEvents += 1;
        }
        reportRowsByAccount.set(accountKey, statement.reportedPerformance || []);
      }
      for (const accountKey of accountKeys) {
        const snapshots = this.db.prepare('SELECT date,net_liquidation AS netLiquidation,total_cash AS totalCash,gross_position_value AS grossPositionValue,base_currency AS baseCurrency,imported_at AS importedAt FROM account_daily_snapshots WHERE account_key=? ORDER BY date').all(accountKey);
        const flows = this.db.prepare('SELECT date,amount,base_amount AS baseAmount FROM cash_flows WHERE account_key=? ORDER BY date').all(accountKey);
        const rows = calculateDailyPerformance(snapshots, flows, reportRowsByAccount.get(accountKey) || []);
        this.db.prepare('DELETE FROM daily_performance WHERE account_key=?').run(accountKey);
        const performanceInsert = this.db.prepare('INSERT INTO daily_performance(account_key,date,begin_nav,end_nav,external_net_flow,pnl_amount,daily_return,cumulative_return,calculation_method,quality_status,reconciliation_difference,reported_pnl,reported_return,imported_at,total_cash,gross_position_value,flow_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const row of rows) { performanceInsert.run(accountKey, row.date, row.beginNav, row.endNav, row.externalNetFlow, row.pnlAmount, row.dailyReturn, row.cumulativeReturn, row.calculationMethod, row.qualityStatus, row.reconciliationDifference, row.reportedPnl, row.reportedReturn, importedAt, row.totalCash, row.grossPositionValue, row.flowCount); counts.performance += 1; }
      }
    });
    return counts;
  }

  async sync({ trigger = 'manual_cli' } = {}) {
    if (this.fixtureMode) return { ok: true, result: 'synthetic-review-fixture', status: 'ready', dataMode: 'synthetic-review-fixture', externalRequestCount: 0, importedRowCounts: this.databaseCounts() };
    if (!(await this.acquireSyncLock())) return { ok: false, result: 'locked', errorCategory: 'database_error', externalRequestCount: 0 };
    const run = this.createRun(trigger);
    try {
      const credentials = await loadFlexCredentials({ rootDir: this.rootDir, secretPath: this.config.flexSecretPath });
      this.credentialsConfigured = Boolean(credentials);
      if (!credentials) {
        await this.saveState({ lastAttemptAt: isoNow(this.now), lastResult: 'waiting_configuration' });
        this.finishRun(run, 'waiting_configuration', { errorCategory: 'authentication_error', stage: 'credential_check', externalRequestCount: 0 });
        return { ok: false, result: 'waiting_configuration', errorCategory: 'authentication_error', stage: 'credential_check', ibkrErrorCode: null, externalRequestCount: 0, diagnostics: [] };
      }
      if (this.databaseCounts().performance > 0) await atomicBackup(this.db, this.config.databasePath, this.config.backupsDir, this.now());
      const report = await this.flexClient.fetchReport();
      await this.writeFlexCapabilityAudit(report.capabilityAudit);
      await this.writeRawFlex(report);
      const importedRowCounts = this.importReport(report);
      const diagnostics = [...(report.diagnostics || []), { stage: 'import_database', outcome: 'success', externalRequestCount: report.externalRequestCount || 0 }];
      const finishedAt = isoNow(this.now);
      const successfulDay = report.reportDate || new Date(this.now()).toISOString().slice(0, 10);
      await this.saveState({ lastAttemptAt: finishedAt, lastSuccessfulAt: finishedAt, lastSuccessfulDay: successfulDay, lastImportedStatementDate: successfulDay, lastResult: 'success', lastErrorCategory: null });
      this.finishRun(run, 'success', { reportDate: report.reportDate, importedRowCounts, stage: 'import_database', ibkrErrorCode: null, diagnostics, externalRequestCount: report.externalRequestCount || 2, warnings: [...new Set([...(report.warnings || []), ...report.statements.flatMap(statement => statement.warnings || [])])] });
      return { ok: true, result: 'success', reportDate: report.reportDate, importedRowCounts, externalRequestCount: report.externalRequestCount || 2, diagnostics, status: 'ready' };
    } catch (error) {
      const errorCategory = error.category || error.errorCategory || 'database_error';
      try { await this.writeFlexCapabilityAudit(error.capabilityAudit); } catch { /* preserve original sync error */ }
      try { await this.writeRawFlex({ rawXml: error.rawXml, reportDate: error.reportDate }); } catch { /* preserve original sync error */ }
      const diagnostics = Array.isArray(error.diagnostics) ? error.diagnostics : this.flexClient?.diagnostics || [];
      if (error.stage === 'import_database' && !diagnostics.some(item => item.stage === 'import_database')) diagnostics.push({ stage: 'import_database', outcome: 'failure', externalRequestCount: error.externalRequestCount || this.flexClient?.externalRequestCount || 0, localErrorCategory: errorCategory });
      const ibkrErrorCode = error.ibkrErrorCode || error.errorCode || diagnostics.at(-1)?.errorCode || null;
      await this.saveState({ lastAttemptAt: isoNow(this.now), lastResult: 'failed', lastErrorCategory: errorCategory });
      this.finishRun(run, 'failed', { errorCategory, stage: error.stage || 'unknown', ibkrErrorCode, diagnostics, externalRequestCount: error.externalRequestCount || this.flexClient?.externalRequestCount || 0, warnings: error.warnings || [] });
      return { ok: false, result: 'failed', errorCategory, stage: error.stage || 'unknown', ibkrErrorCode, diagnostics, externalRequestCount: error.externalRequestCount || this.flexClient?.externalRequestCount || 0 };
    } finally {
      await this.releaseSyncLock();
    }
  }

  combinedPerformance() {
    const rows = this.db.prepare('SELECT date,begin_nav,end_nav,external_net_flow,pnl_amount,daily_return,cumulative_return,total_cash,gross_position_value,quality_status,calculation_method,reconciliation_difference,flow_count FROM daily_performance ORDER BY date').all();
    return combinePerformanceRows(rows);
  }

  resolveRange(range, customStart = null, customEnd = null) {
    const normalized = parseRange(range);
    if (!normalized) throw Object.assign(new Error('invalid-range'), { statusCode: 400, allowed: RANGE_KEYS });
    const rows = this.combinedPerformance();
    if (!rows.length) return { range: normalized, startDate: null, endDate: null, rows: [] };
    const first = rows[0].date;
    const last = rows.at(-1).date;
    let startDate = first;
    if (normalized === '1D') startDate = last;
    if (normalized === 'MTD') startDate = `${last.slice(0, 7)}-01`;
    if (normalized === '3M') startDate = dateShift(last, 'month', -3);
    if (normalized === '6M') startDate = dateShift(last, 'month', -6);
    if (normalized === 'YTD') startDate = `${last.slice(0, 4)}-01-01`;
    if (normalized === '1Y') startDate = dateShift(last, 'year', -1);
    if (normalized === 'CUSTOM') {
      if (!validDate(customStart) || !validDate(customEnd) || customStart > customEnd) throw Object.assign(new Error('invalid-custom-range'), { statusCode: 400 });
      if (customStart < first || customEnd > last) throw Object.assign(new Error('range-outside-history'), { statusCode: 400 });
      startDate = customStart;
      return { range: normalized, startDate, endDate: customEnd, rows: rows.filter(row => row.date >= startDate && row.date <= customEnd), firstDate: first, lastDate: last };
    }
    if (startDate < first) startDate = first;
    return { range: normalized, startDate, endDate: last, rows: rows.filter(row => row.date >= startDate && row.date <= last), firstDate: first, lastDate: last };
  }

  getSummary(range = '1Y', customStart = null, customEnd = null) {
    const resolved = this.resolveRange(range, customStart, customEnd);
    const summary = aggregatePerformance(resolved.rows);
    const latest = resolved.rows.at(-1) || null;
    return { range: resolved.range, startDate: resolved.startDate, endDate: resolved.endDate, historyCoverage: { startDate: resolved.firstDate || null, endDate: resolved.lastDate || null }, summary: { ...summary, currentNav: latest?.endNav ?? null, currentCash: latest?.totalCash ?? null, currentGrossPositionValue: latest?.grossPositionValue ?? null, todayPnl: latest?.pnlAmount ?? null, todayReturn: latest?.dailyReturn ?? null, baseCurrency: this.db.prepare('SELECT base_currency AS baseCurrency FROM portfolio_accounts ORDER BY updated_at DESC LIMIT 1').get()?.baseCurrency || null, accountCount: this.databaseCounts().accounts }, dataQuality: { statuses: [...new Set(resolved.rows.map(row => row.qualityStatus))], calculationMethods: [...new Set(resolved.rows.map(row => row.calculationMethod))] } };
  }

  benchmarkSeries(startDate, endDate) {
    const output = [];
    for (const benchmark of ['nasdaq100', 'sp500', 'soxx']) {
      const rows = this.db.prepare('SELECT date,value FROM benchmark_daily WHERE benchmark_id=? AND date>=? AND date<=? ORDER BY date').all(benchmark, startDate, endDate);
      if (!rows.length) continue;
      const first = Number(rows[0].value);
      output.push({ id: benchmark, label: benchmark === 'nasdaq100' ? 'Nasdaq-100' : benchmark === 'sp500' ? 'S&P 500' : 'SOXX', series: rows.map(row => ({ date: row.date, value: Number(row.value) / first - 1 })) });
    }
    return output;
  }

  getPerformance(range = '1Y', customStart = null, customEnd = null) {
    const resolved = this.resolveRange(range, customStart, customEnd);
    const rows = resolved.rows.slice(-MAX_API_POINTS);
    let factor = 1;
    const series = rows.map(row => {
      const dailyReturn = finite(row.dailyReturn);
      if (dailyReturn !== null && dailyReturn > -1) factor *= 1 + dailyReturn;
      return { date: row.date, pnlAmount: row.pnlAmount, cumulativeReturn: dailyReturn === null ? null : factor - 1, endNav: row.endNav, totalCash: row.totalCash, grossPositionValue: row.grossPositionValue, externalNetFlow: row.externalNetFlow, dailyReturn: row.dailyReturn, qualityStatus: row.qualityStatus, calculationMethod: row.calculationMethod, reconciliationDifference: row.reconciliationDifference, flowCount: row.flowCount };
    });
    return { range: resolved.range, startDate: resolved.startDate, endDate: resolved.endDate, historyCoverage: { startDate: resolved.firstDate || null, endDate: resolved.lastDate || null }, series, benchmarks: this.benchmarkSeries(resolved.startDate, resolved.endDate), monthly: monthlyPerformance(resolved.rows).slice(-24) };
  }

  getCalendar(month) {
    const selected = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : this.combinedPerformance().at(-1)?.date?.slice(0, 7) || null;
    if (!selected) return { month: null, entries: [], summary: aggregatePerformance([]) };
    const rows = this.combinedPerformance().filter(row => row.date.startsWith(selected));
    return { month: selected, entries: rows.map(row => ({ date: row.date, pnlAmount: row.pnlAmount, dailyReturn: row.dailyReturn, qualityStatus: row.qualityStatus })), summary: aggregatePerformance(rows) };
  }

  getContributions(range = '1Y', customStart = null, customEnd = null) {
    const resolved = this.resolveRange(range, customStart, customEnd);
    const start = resolved.startDate || '0000-01-01'; const end = resolved.endDate || '9999-12-31';
    const groups = new Map();
    const ensure = symbol => { if (!groups.has(symbol)) groups.set(symbol, { symbol, securityType: null, realizedPnl: 0, unrealizedChange: null, dividend: 0, interest: 0, fees: 0, totalContribution: 0 }); return groups.get(symbol); };
    for (const row of this.db.prepare('SELECT symbol,security_type AS securityType,realized_pnl AS realizedPnl,commission FROM trades WHERE date>=? AND date<=?').all(start, end)) {
      const item = ensure(row.symbol || '未标记'); item.securityType ||= row.securityType; item.realizedPnl += finite(row.realizedPnl) ?? 0; item.fees -= Math.abs(finite(row.commission) ?? 0);
    }
    for (const row of this.db.prepare('SELECT symbol,type,base_amount AS baseAmount,amount FROM income_events WHERE date>=? AND date<=?').all(start, end)) {
      const item = ensure(row.symbol || '账户收入'); const amount = finite(row.baseAmount ?? row.amount) ?? 0;
      if (row.type === 'dividend') item.dividend += amount; else if (row.type === 'interest') item.interest += amount; else item.fees -= Math.abs(amount);
    }
    const contributions = [...groups.values()].map(item => ({ ...item, totalContribution: item.realizedPnl + item.dividend + item.interest + item.fees }));
    contributions.sort((left, right) => right.totalContribution - left.totalContribution);
    return { range: resolved.range, startDate: resolved.startDate, endDate: resolved.endDate, contributions, limitations: ['区间未实现贡献暂不提供：当前模型未建立可靠的区间起点持仓配对。'] };
  }

  getCashFlows(range = '1Y', customStart = null, customEnd = null) {
    const resolved = this.resolveRange(range, customStart, customEnd);
    const rows = this.db.prepare('SELECT date,occurred_at AS occurredAt,type,amount,currency,base_amount AS baseAmount,description FROM cash_flows WHERE date>=? AND date<=? ORDER BY date,occurred_at').all(resolved.startDate || '0000-01-01', resolved.endDate || '9999-12-31');
    const summary = this.getSummary(range, customStart, customEnd).summary;
    return { range: resolved.range, startDate: resolved.startDate, endDate: resolved.endDate, flows: rows, bridge: { beginNav: summary.startNav, deposits: rows.filter(row => row.type === 'deposit').reduce((total, row) => total + (finite(row.baseAmount ?? row.amount) ?? 0), 0), withdrawals: rows.filter(row => row.type === 'withdrawal').reduce((total, row) => total + Math.abs(finite(row.baseAmount ?? row.amount) ?? 0), 0), investmentPnl: summary.pnlAmount, endNav: summary.endNav, reconciliationDifference: summary.reconciliationDifference }, note: '差额可能来自账户活动、汇率、税费、费用、corporate action或报告口径。' };
  }

  getPositions(date = null) {
    const target = validDate(date) ? date : this.databaseCounts().latestDate;
    if (!target) return { date: null, positions: [] };
    const rows = this.db.prepare(`SELECT symbol,security_type AS securityType,currency,SUM(quantity) AS quantity,SUM(market_value) AS marketValue,SUM(cost_basis) AS costBasis,SUM(unrealized_pnl) AS unrealizedPnl,SUM(realized_pnl) AS realizedPnl
      FROM positions_daily WHERE date=(SELECT MAX(date) FROM positions_daily WHERE date<=?) GROUP BY symbol,security_type,currency ORDER BY marketValue DESC`).all(target);
    const actualDate = this.db.prepare('SELECT MAX(date) AS date FROM positions_daily WHERE date<=?').get(target)?.date || null;
    return { date: actualDate, positions: rows.map(row => ({ ...row, quantity: finite(row.quantity), marketValue: finite(row.marketValue), costBasis: finite(row.costBasis), unrealizedPnl: finite(row.unrealizedPnl), realizedPnl: finite(row.realizedPnl) })) };
  }

  getTrades(range = '1Y', customStart = null, customEnd = null) {
    const resolved = this.resolveRange(range, customStart, customEnd);
    const rows = this.db.prepare('SELECT symbol,security_type AS securityType,currency,date,occurred_at AS occurredAt,side,quantity,price,proceeds,commission,realized_pnl AS realizedPnl FROM trades WHERE date>=? AND date<=? ORDER BY date DESC,occurred_at DESC LIMIT 1000').all(resolved.startDate || '0000-01-01', resolved.endDate || '9999-12-31');
    const completed = rows.filter(row => finite(row.realizedPnl) !== null);
    return { range: resolved.range, startDate: resolved.startDate, endDate: resolved.endDate, trades: rows, statistics: { tradeCount: rows.length, symbols: new Set(rows.map(row => row.symbol).filter(Boolean)).size, profitableTrades: completed.filter(row => row.realizedPnl > 0).length, losingTrades: completed.filter(row => row.realizedPnl < 0).length, winRate: completed.length ? completed.filter(row => row.realizedPnl > 0).length / completed.length : null, averagePositionDays: null, averagePosition: rows.length ? rows.reduce((total, row) => total + Math.abs(finite(row.proceeds) ?? 0), 0) / rows.length : null, turnover: null } };
  }

  getSyncStatus(scheduler = null) {
    const recentRuns = this.db.prepare('SELECT trigger,started_at AS startedAt,ended_at AS endedAt,result,report_date AS reportDate,error_category AS errorCategory,stage,ibkr_error_code AS ibkrErrorCode,diagnostics_json AS diagnosticsJson,external_request_count AS externalRequestCount FROM portfolio_sync_runs ORDER BY started_at DESC LIMIT 10').all().map(row => ({ ...row, diagnostics: parseJson(row.diagnosticsJson, []) }));
    return { ...this.getStatus(scheduler), recentRuns };
  }
}

module.exports = { MAX_API_POINTS, PortfolioService, RANGE_KEYS, combinePerformanceRows, parseRange };
