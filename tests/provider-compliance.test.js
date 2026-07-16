'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const test = require('node:test');
const {
  isProviderEffectivelyEnabled,
  loadProviderRegistry,
  validateProvider,
  validateProviderRegistry
} = require('../server/market-data/provider-compliance');
const { loadMarketDataConfig } = require('../server/market-data/config');

function provider(overrides = {}) {
  return {
    providerId: 'fixture-provider',
    providerName: 'Synthetic fixture provider',
    targetIndicators: ['vix'],
    technicalStatus: 'synthetic_test_only',
    complianceStatus: 'approved',
    selectionStatus: 'selected',
    accountRequirement: 'none',
    subscriptionRequirement: 'none',
    internalDisplayAllowed: true,
    localCacheAllowed: true,
    cacheRetention: 'test lifetime only',
    historicalStorageAllowed: true,
    attributionRequirement: 'synthetic fixture',
    writtenConfirmationRequired: false,
    termsCheckedAt: '2099-01-15',
    technicalCheckedAt: '2099-01-15',
    conditionsSatisfied: true,
    enabled: true,
    notes: 'Contains no real market data.',
    ...overrides
  };
}

test('production registry enables approved providers and records WorldPEratio owner risk acceptance', () => {
  const registry = loadProviderRegistry(path.join(__dirname, '..'));
  assert.deepEqual(registry.providers.map(item => item.providerId), ['sec-edgar', 'cftc', 'cboe', 'ibkr', 'twelve-data', 'alpha-vantage', 'worldperatio']);
  assert.deepEqual(registry.providers.filter(item => item.enabled).map(item => item.providerId), ['sec-edgar', 'cftc', 'worldperatio']);
  assert.deepEqual(registry.providers.filter(item => isProviderEffectivelyEnabled(item)).map(item => item.providerId), ['sec-edgar', 'cftc', 'worldperatio']);
  assert.equal(registry.providers.find(item => item.providerId === 'ibkr').selectionStatus, 'not_selected_by_owner');
  const worldPERatio = registry.providers.find(item => item.providerId === 'worldperatio');
  assert.equal(worldPERatio.selectionStatus, 'selected');
  assert.equal(worldPERatio.complianceStatus, 'approved_with_conditions');
  assert.equal(worldPERatio.conditionsSatisfied, true);
  assert.equal(worldPERatio.riskAcceptance, 'owner_accepted_limited_internal_use');
});

test('pending, rejected, unavailable and not-evaluated providers cannot be enabled', () => {
  for (const complianceStatus of ['pending_written_confirmation', 'rejected', 'technically_unavailable', 'not_evaluated']) {
    assert.throws(() => validateProvider(provider({ complianceStatus })), /cannot be enabled/);
  }
});

test('approved-with-conditions requires all conditions to be satisfied', () => {
  assert.throws(() => validateProvider(provider({ complianceStatus: 'approved_with_conditions', conditionsSatisfied: false })), /cannot be enabled/);
  assert.equal(isProviderEffectivelyEnabled(provider({ complianceStatus: 'approved_with_conditions', conditionsSatisfied: true })), true);
});

test('risk acceptance must be non-empty text when present', () => {
  assert.equal(validateProvider(provider({ riskAcceptance: 'synthetic_owner_acceptance' })).riskAcceptance, 'synthetic_owner_acceptance');
  assert.throws(() => validateProvider(provider({ riskAcceptance: '' })), /riskAcceptance/);
});

test('registry rejects duplicate provider ids', () => {
  assert.throws(() => validateProviderRegistry({ schemaVersion: 1, providers: [provider(), provider()] }), /duplicate providerId/);
});

test('provider selection status is explicit and validated', () => {
  assert.throws(() => validateProvider(provider({ selectionStatus: 'unknown' })), /selectionStatus/);
  assert.equal(validateProvider(provider({ selectionStatus: 'deferred', enabled: false })).selectionStatus, 'deferred');
  assert.equal(validateProvider(provider({ selectionStatus: 'candidate', enabled: false })).selectionStatus, 'candidate');
});

test('SEC production permission requires explicit opt-in, app name and valid contact email', () => {
  const names = ['SEC_BULK_UPDATE_ENABLED', 'SEC_USER_AGENT_APP', 'SEC_USER_AGENT_EMAIL'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.SEC_BULK_UPDATE_ENABLED = 'true';
    process.env.SEC_USER_AGENT_APP = 'MarketStrategyQuery';
    delete process.env.SEC_USER_AGENT_EMAIL;
    assert.equal(loadMarketDataConfig(path.join(__dirname, '..')).permissions.secEdgar, false);
    process.env.SEC_USER_AGENT_EMAIL = 'invalid';
    assert.equal(loadMarketDataConfig(path.join(__dirname, '..')).permissions.secEdgar, false);
    process.env.SEC_USER_AGENT_EMAIL = 'fixture@example.invalid';
    assert.equal(loadMarketDataConfig(path.join(__dirname, '..')).permissions.secEdgar, true);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
