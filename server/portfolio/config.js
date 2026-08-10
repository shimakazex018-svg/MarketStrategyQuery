'use strict';

const path = require('node:path');

function booleanEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function integerEnv(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function parseSyncTime(value, fallback = '10:30') {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? `${match[1]}:${match[2]}` : fallback;
}

function loadPortfolioConfig(rootDir) {
  const runtimeRoot = path.join(rootDir, 'runtime-data', 'portfolio-analysis');
  return {
    rootDir,
    runtimeRoot,
    databasePath: path.join(runtimeRoot, 'portfolio.sqlite'),
    rawFlexDir: path.join(runtimeRoot, 'raw-flex'),
    importsDir: path.join(runtimeRoot, 'imports'),
    backupsDir: path.join(runtimeRoot, 'backups'),
    auditDir: path.join(runtimeRoot, 'audit'),
    stateDir: path.join(runtimeRoot, 'state'),
    logsDir: path.join(runtimeRoot, 'logs'),
    secretsDir: path.join(runtimeRoot, 'secrets'),
    flexSecretPath: path.join(runtimeRoot, 'secrets', 'ibkr-flex.json'),
    passwordPath: path.join(runtimeRoot, 'secrets', 'portfolio-password.json'),
    timezone: process.env.PORTFOLIO_TIMEZONE || 'Asia/Shanghai',
    syncTime: parseSyncTime(process.env.PORTFOLIO_SYNC_TIME, '10:30'),
    revisionWindowDays: integerEnv('PORTFOLIO_REVISION_WINDOW_DAYS', 7, 1, 30),
    sessionTtlMs: integerEnv('PORTFOLIO_SESSION_TTL_HOURS', 8, 1, 168) * 60 * 60 * 1000,
    secureCookie: booleanEnv('PORTFOLIO_SECURE_COOKIE', false),
    rawRetentionDays: 180,
    flexEndpoint: process.env.PORTFOLIO_FLEX_ENDPOINT || 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService',
    flexTimeoutMs: integerEnv('PORTFOLIO_FLEX_TIMEOUT_MS', 30_000, 2_000, 120_000),
    flexMaxReportBytes: integerEnv('PORTFOLIO_FLEX_MAX_REPORT_BYTES', 64 * 1024 * 1024, 1_000_000, 256 * 1024 * 1024),
    flexPollAttempts: integerEnv('PORTFOLIO_FLEX_POLL_ATTEMPTS', 2, 0, 3),
    flexPollDelayMs: integerEnv('PORTFOLIO_FLEX_POLL_DELAY_MS', 4_000, 1_000, 30_000),
    preserveRawFlex: booleanEnv('PORTFOLIO_PRESERVE_RAW_FLEX', true),
    fixtureMode: process.env.PORTFOLIO_REVIEW_FIXTURE === 'synthetic-review-fixture'
      || process.env.PORTFOLIO_DATA_MODE === 'synthetic-review-fixture'
      ? 'synthetic-review-fixture' : 'local-production-cache'
  };
}

module.exports = { booleanEnv, integerEnv, loadPortfolioConfig, parseSyncTime };
