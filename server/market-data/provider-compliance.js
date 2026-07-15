'use strict';

const fs = require('fs');
const path = require('path');

const VALID_COMPLIANCE_STATUSES = new Set([
  'approved',
  'approved_with_conditions',
  'pending_written_confirmation',
  'rejected',
  'technically_unavailable',
  'not_evaluated'
]);

const VALID_SELECTION_STATUSES = new Set([
  'selected',
  'deferred',
  'not_selected_by_owner'
]);

const REQUIRED_TEXT_FIELDS = [
  'providerId',
  'providerName',
  'technicalStatus',
  'complianceStatus',
  'selectionStatus',
  'accountRequirement',
  'subscriptionRequirement',
  'cacheRetention',
  'attributionRequirement',
  'termsCheckedAt',
  'technicalCheckedAt',
  'notes'
];

const REQUIRED_BOOLEAN_FIELDS = [
  'internalDisplayAllowed',
  'localCacheAllowed',
  'historicalStorageAllowed',
  'writtenConfirmationRequired',
  'conditionsSatisfied',
  'enabled'
];

function isComplianceApproved(provider) {
  return provider?.complianceStatus === 'approved'
    || (provider?.complianceStatus === 'approved_with_conditions' && provider.conditionsSatisfied === true);
}

function isProviderEffectivelyEnabled(provider) {
  return provider?.enabled === true && isComplianceApproved(provider);
}

function validateProvider(provider) {
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) throw new TypeError('provider must be an object');
  for (const field of REQUIRED_TEXT_FIELDS) {
    if (typeof provider[field] !== 'string' || !provider[field].trim()) throw new TypeError(`provider.${field} must be non-empty text`);
  }
  if (!/^[a-z0-9-]+$/.test(provider.providerId)) throw new TypeError('provider.providerId is invalid');
  if (!VALID_COMPLIANCE_STATUSES.has(provider.complianceStatus)) throw new TypeError('provider.complianceStatus is invalid');
  if (!VALID_SELECTION_STATUSES.has(provider.selectionStatus)) throw new TypeError('provider.selectionStatus is invalid');
  if (!Array.isArray(provider.targetIndicators) || !provider.targetIndicators.length) throw new TypeError('provider.targetIndicators must be a non-empty array');
  if (new Set(provider.targetIndicators).size !== provider.targetIndicators.length) throw new TypeError('provider.targetIndicators contains duplicates');
  for (const indicatorId of provider.targetIndicators) {
    if (!/^[a-z0-9-]+$/.test(indicatorId)) throw new TypeError('provider.targetIndicators contains an invalid id');
  }
  for (const field of REQUIRED_BOOLEAN_FIELDS) {
    if (typeof provider[field] !== 'boolean') throw new TypeError(`provider.${field} must be boolean`);
  }
  if (provider.enabled && !isComplianceApproved(provider)) {
    throw new TypeError(`provider ${provider.providerId} cannot be enabled with complianceStatus ${provider.complianceStatus}`);
  }
  return { ...provider, targetIndicators: [...provider.targetIndicators] };
}

function validateProviderRegistry(registry) {
  if (!registry || typeof registry !== 'object' || !Number.isInteger(registry.schemaVersion)) {
    throw new TypeError('provider registry schemaVersion is invalid');
  }
  if (!Array.isArray(registry.providers) || !registry.providers.length) throw new TypeError('provider registry must contain providers');
  const providers = registry.providers.map(validateProvider);
  if (new Set(providers.map(provider => provider.providerId)).size !== providers.length) {
    throw new TypeError('provider registry contains duplicate providerId values');
  }
  return { ...registry, providers };
}

function loadProviderRegistry(rootDir) {
  const filePath = path.join(rootDir, 'config', 'market-data-providers.json');
  return validateProviderRegistry(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function providerById(registry, providerId) {
  return registry?.providers?.find(provider => provider.providerId === providerId) || null;
}

module.exports = {
  VALID_COMPLIANCE_STATUSES,
  VALID_SELECTION_STATUSES,
  isComplianceApproved,
  isProviderEffectivelyEnabled,
  loadProviderRegistry,
  providerById,
  validateProvider,
  validateProviderRegistry
};
