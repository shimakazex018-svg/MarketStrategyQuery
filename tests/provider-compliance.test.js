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
    termsCheckedAt: '2026-07-15',
    technicalCheckedAt: '2026-07-15',
    conditionsSatisfied: true,
    enabled: true,
    notes: 'Contains no real market data.',
    ...overrides
  };
}

test('production registry is valid and all deferred providers are disabled', () => {
  const registry = loadProviderRegistry(path.join(__dirname, '..'));
  assert.deepEqual(registry.providers.map(item => item.providerId), ['cboe', 'ibkr', 'twelve-data', 'alpha-vantage']);
  assert.equal(registry.providers.every(item => item.enabled === false), true);
  assert.equal(registry.providers.every(item => isProviderEffectivelyEnabled(item) === false), true);
  assert.equal(registry.providers.find(item => item.providerId === 'ibkr').selectionStatus, 'not_selected_by_owner');
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

test('registry rejects duplicate provider ids', () => {
  assert.throws(() => validateProviderRegistry({ schemaVersion: 1, providers: [provider(), provider()] }), /duplicate providerId/);
});

test('provider selection status is explicit and validated', () => {
  assert.throws(() => validateProvider(provider({ selectionStatus: 'unknown' })), /selectionStatus/);
  assert.equal(validateProvider(provider({ selectionStatus: 'deferred', enabled: false })).selectionStatus, 'deferred');
});
