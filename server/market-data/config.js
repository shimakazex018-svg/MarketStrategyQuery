'use strict';

const path = require('path');
const { loadProviderRegistry } = require('./provider-compliance');

function booleanEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function integerEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function loadMarketDataConfig(rootDir) {
  const providerRegistry = loadProviderRegistry(rootDir);
  const secUserAgentApp = String(process.env.SEC_USER_AGENT_APP || '').trim();
  const secUserAgentEmail = String(process.env.SEC_USER_AGENT_EMAIL || '').trim();
  const secBulkUpdateEnabled = booleanEnv('SEC_BULK_UPDATE_ENABLED', false);
  return {
    selfCalculatedMvp: true,
    enabled: booleanEnv('MARKET_DATA_ENABLED', true),
    timezone: process.env.MARKET_DATA_TIMEZONE || 'Asia/Shanghai',
    connectTimeoutMs: integerEnv('MARKET_DATA_CONNECT_TIMEOUT_MS', 10_000, 1_000, 60_000),
    requestTimeoutMs: integerEnv('MARKET_DATA_REQUEST_TIMEOUT_MS', 15_000, 1_000, 120_000),
    maxAttemptsPerDay: integerEnv('MARKET_DATA_MAX_ATTEMPTS_PER_DAY', 4, 1, 4),
    manualRefreshCooldownMinutes: integerEnv('MARKET_DATA_MANUAL_REFRESH_COOLDOWN_MINUTES', 30, 1, 1_440),
    providerDailyLimit: integerEnv('MARKET_DATA_PROVIDER_DAILY_LIMIT', 20, 1, 20),
    runtimeDir: path.join(rootDir, 'runtime-data', 'market-data'),
    runtimeRoot: path.join(rootDir, 'runtime-data'),
    providerRegistry,
    permissions: {
      cboe: booleanEnv('CBOE_DATA_LICENSE_CONFIRMED', false),
      secEdgar: Boolean(secBulkUpdateEnabled && secUserAgentApp && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(secUserAgentEmail)),
      cftc: true
    },
    sec: {
      userAgentApp: secUserAgentApp,
      userAgentEmail: secUserAgentEmail,
      bulkUpdateEnabled: secBulkUpdateEnabled,
      requestTimeoutMs: integerEnv('SEC_BULK_REQUEST_TIMEOUT_MS', 15_000, 1_000, 120_000),
      maxBytes: integerEnv('SEC_BULK_MAX_BYTES', 4_294_967_296, 1_000_000, 4_294_967_296)
    },
    fredApiKeyConfigured: Boolean(process.env.FRED_API_KEY)
  };
}

module.exports = { loadMarketDataConfig };
