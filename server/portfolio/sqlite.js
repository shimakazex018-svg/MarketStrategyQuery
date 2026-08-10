'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 2;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS portfolio_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_accounts (
  account_key TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  masked_account_label TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  first_seen TEXT,
  last_seen TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_daily_snapshots (
  account_key TEXT NOT NULL,
  date TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  net_liquidation REAL,
  total_cash REAL,
  gross_position_value REAL,
  stock_market_value REAL,
  option_market_value REAL,
  other_market_value REAL,
  accrued_cash REAL,
  source TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (account_key, date),
  FOREIGN KEY (account_key) REFERENCES portfolio_accounts(account_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_date ON account_daily_snapshots(date);

CREATE TABLE IF NOT EXISTS cash_flows (
  flow_id TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  occurred_at TEXT,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT,
  base_amount REAL,
  exchange_rate REAL,
  description TEXT,
  source_id TEXT,
  source TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  FOREIGN KEY (account_key) REFERENCES portfolio_accounts(account_key) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_flows_source ON cash_flows(account_key, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_flows_date ON cash_flows(account_key, date);

CREATE TABLE IF NOT EXISTS trades (
  execution_id TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  symbol TEXT,
  conid TEXT,
  security_type TEXT,
  currency TEXT,
  occurred_at TEXT,
  date TEXT NOT NULL,
  side TEXT,
  quantity REAL,
  price REAL,
  proceeds REAL,
  commission REAL,
  realized_pnl REAL,
  source_id TEXT,
  source TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  FOREIGN KEY (account_key) REFERENCES portfolio_accounts(account_key) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_source ON trades(account_key, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(account_key, date);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(account_key, symbol);

CREATE TABLE IF NOT EXISTS positions_daily (
  position_key TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  date TEXT NOT NULL,
  conid TEXT,
  symbol TEXT,
  security_type TEXT,
  currency TEXT,
  quantity REAL,
  market_price REAL,
  market_value REAL,
  cost_basis REAL,
  unrealized_pnl REAL,
  realized_pnl REAL,
  source_id TEXT,
  source TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  FOREIGN KEY (account_key) REFERENCES portfolio_accounts(account_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_positions_date ON positions_daily(account_key, date);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions_daily(account_key, symbol);

CREATE TABLE IF NOT EXISTS income_events (
  event_id TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  date TEXT NOT NULL,
  occurred_at TEXT,
  type TEXT NOT NULL,
  symbol TEXT,
  amount REAL NOT NULL,
  currency TEXT,
  base_amount REAL,
  exchange_rate REAL,
  description TEXT,
  source_id TEXT,
  source TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  FOREIGN KEY (account_key) REFERENCES portfolio_accounts(account_key) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_income_source ON income_events(account_key, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_income_date ON income_events(account_key, date);

CREATE TABLE IF NOT EXISTS daily_performance (
  account_key TEXT NOT NULL,
  date TEXT NOT NULL,
  begin_nav REAL,
  end_nav REAL,
  external_net_flow REAL,
  pnl_amount REAL,
  daily_return REAL,
  cumulative_return REAL,
  calculation_method TEXT,
  quality_status TEXT NOT NULL,
  reconciliation_difference REAL,
  reported_pnl REAL,
  reported_return REAL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (account_key, date),
  FOREIGN KEY (account_key) REFERENCES portfolio_accounts(account_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_performance_date ON daily_performance(date);

CREATE TABLE IF NOT EXISTS benchmark_daily (
  benchmark_id TEXT NOT NULL,
  date TEXT NOT NULL,
  value REAL NOT NULL,
  daily_return REAL,
  cumulative_return REAL,
  source TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (benchmark_id, date)
);
CREATE INDEX IF NOT EXISTS idx_benchmark_date ON benchmark_daily(benchmark_id, date);

CREATE TABLE IF NOT EXISTS portfolio_sync_runs (
  run_id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  result TEXT NOT NULL,
  report_date TEXT,
  imported_row_counts TEXT,
  warnings TEXT,
  error_category TEXT,
  external_request_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON portfolio_sync_runs(started_at);
`;

async function openPortfolioDatabase(databasePath) {
  if (databasePath !== ':memory:') await fs.mkdir(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  let current = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (current < 1) {
    db.exec(SCHEMA_SQL);
    db.exec('PRAGMA user_version=1');
    current = 1;
  }
  if (current < 2) {
    const columns = new Set(db.prepare('PRAGMA table_info(daily_performance)').all().map(row => row.name));
    if (!columns.has('total_cash')) db.exec('ALTER TABLE daily_performance ADD COLUMN total_cash REAL');
    if (!columns.has('gross_position_value')) db.exec('ALTER TABLE daily_performance ADD COLUMN gross_position_value REAL');
    if (!columns.has('flow_count')) db.exec('ALTER TABLE daily_performance ADD COLUMN flow_count INTEGER NOT NULL DEFAULT 0');
    db.exec('PRAGMA user_version=2');
  }
  const quickCheck = db.prepare('PRAGMA quick_check').get().quick_check;
  if (quickCheck !== 'ok') {
    db.close();
    throw new Error('portfolio-database-quick-check-failed');
  }
  return { db, databasePath, schemaVersion: SCHEMA_VERSION };
}

function withTransaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = callback();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  }
}

async function atomicBackup(db, databasePath, backupsDir, now = new Date()) {
  if (databasePath === ':memory:') return null;
  await fs.mkdir(backupsDir, { recursive: true });
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const destination = path.join(backupsDir, `portfolio-${stamp}.sqlite`);
  const temporary = `${destination}.${process.pid}.tmp`;
  await fs.copyFile(databasePath, temporary);
  const handle = await fs.open(temporary, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, destination);
  return destination;
}

function closePortfolioDatabase(handle) {
  handle?.db?.close();
}

module.exports = { SCHEMA_VERSION, SCHEMA_SQL, atomicBackup, closePortfolioDatabase, openPortfolioDatabase, withTransaction };
