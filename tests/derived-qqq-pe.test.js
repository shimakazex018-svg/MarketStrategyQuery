'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { calculateQqqPe } = require('../server/derived-indicators/qqq-pe');
const {
  applySplitAdjustments,
  buildQuarterlyTtm,
  dedupeSecFacts,
  selectFactSeries
} = require('../server/derived-indicators/sec-facts');

const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'derived-indicators', 'qqq-pe-sample.json'), 'utf8'));

test('SEC field mapping follows GAAP priority and records fallback metadata', () => {
  const companyFacts = { facts: { 'us-gaap': {
    NetIncomeLoss: { units: { USD: [{ start: '2025-01-01', end: '2025-03-31', val: 10 }] } },
    EarningsPerShareDiluted: { units: { 'USD/shares': [{ start: '2025-01-01', end: '2025-03-31', val: 1.25 }] } }
  } } };
  const netIncome = selectFactSeries(companyFacts, 'netIncome');
  const eps = selectFactSeries(companyFacts, 'dilutedEps');
  assert.equal(netIncome.mapping.tag, 'NetIncomeLoss');
  assert.equal(netIncome.mapping.fallbackUsed, true);
  assert.equal(eps.mapping.tag, 'EarningsPerShareDiluted');
  assert.equal(eps.facts[0].value, 1.25);
});

test('SEC field mapping supports IFRS fallback tags', () => {
  const companyFacts = { facts: { 'ifrs-full': {
    ProfitLossAttributableToOwnersOfParent: { units: { EUR: [{ start: '2025-01-01', end: '2025-03-31', val: 8 }] } }
  } } };
  const selected = selectFactSeries(companyFacts, 'netIncome');
  assert.equal(selected.mapping.taxonomy, 'ifrs-full');
  assert.equal(selected.mapping.unit, 'EUR');
  assert.equal(selected.mapping.confidence, 'low');
});

test('quarterly TTM de-duplicates revisions and does not double count an overlapping annual fact', () => {
  const facts = [
    { start: '2024-01-01', end: '2024-12-31', value: 100, filed: '2025-02-01', accn: 'annual', periodType: 'annual', form: '10-K' },
    { start: '2024-01-01', end: '2024-03-31', value: 20, filed: '2024-04-20', accn: 'q1-old', periodType: 'quarter', form: '10-Q' },
    { start: '2024-01-01', end: '2024-03-31', value: 22, filed: '2024-05-01', accn: 'q1-amended', periodType: 'quarter', form: '10-Q/A' },
    { start: '2024-04-01', end: '2024-06-30', value: 24, filed: '2024-07-20', accn: 'q2', periodType: 'quarter', form: '10-Q' },
    { start: '2024-07-01', end: '2024-09-30', value: 26, filed: '2024-10-20', accn: 'q3', periodType: 'quarter', form: '10-Q' },
    { start: '2024-10-01', end: '2024-12-31', value: 30, filed: '2025-02-01', accn: 'q4', periodType: 'quarter', form: '10-K' }
  ];
  const result = buildQuarterlyTtm(facts, { asOf: '2025-02-02' });
  assert.equal(result.status, 'fresh');
  assert.equal(result.value, 102);
  assert.equal(result.selectedFacts.length, 4);
  assert.equal(result.replacedFacts.some(fact => fact.accn === 'q1-old'), true);
  assert.equal(result.ignoredAnnualFacts.length, 1);
  assert.equal(dedupeSecFacts(facts).facts.length, 5);
});

test('quarterly TTM rejects insufficient and overlapping quarter samples', () => {
  const insufficient = buildQuarterlyTtm([
    { start: '2025-01-01', end: '2025-03-31', value: 1, periodType: 'quarter' }
  ]);
  assert.equal(insufficient.status, 'insufficient_coverage');
  const overlap = buildQuarterlyTtm([
    { start: '2024-01-01', end: '2024-04-01', value: 1, periodType: 'quarter' },
    { start: '2024-04-01', end: '2024-06-30', value: 1, periodType: 'quarter' },
    { start: '2024-07-01', end: '2024-09-30', value: 1, periodType: 'quarter' },
    { start: '2024-10-01', end: '2024-12-31', value: 1, periodType: 'quarter' }
  ]);
  assert.equal(overlap.reason, 'overlapping_quarters');
});

test('explicit stock split adjustment keeps per-share and share facts on a common basis', () => {
  const facts = [{ end: '2024-01-01', value: 4 }, { end: '2025-01-01', value: 3 }];
  const split = [{ effectiveDate: '2024-06-01', factor: 2 }];
  assert.deepEqual(applySplitAdjustments(facts, split, 'perShare').map(fact => fact.value), [2, 3]);
  assert.deepEqual(applySplitAdjustments(facts, split, 'shares').map(fact => fact.value), [8, 3]);
});

test('QQQ PE prototype calculates both methods and exposes loss-treatment differences', () => {
  const result = calculateQqqPe(sample);
  assert.equal(result.status, 'demo');
  assert.equal(result.componentCount, 6);
  assert.equal(result.coverage.price.coverageRatio, 1);
  assert.equal(result.lossMakingWeight, 0.12);
  assert.equal(result.methods.weightedEarningsYield.eligible, true);
  assert.equal(result.methods.aggregateMarketCapToEarnings.eligible, true);
  assert.ok(result.methods.weightedEarningsYield.includingLosses.value > result.methods.weightedEarningsYield.excludingLossesRenormalized.value);
  assert.notEqual(result.methods.weightedEarningsYield.includingLosses.value, result.methods.aggregateMarketCapToEarnings.includingLosses.value);
  assert.equal(result.defaultMethod, null);
  assert.equal(result.value, null);
});

test('QQQ PE refuses low coverage, currency mismatch, near-zero and negative denominators', () => {
  const missingPrice = sample.map(component => component.ticker === 'SAMPLEF' ? { ...component, price: null } : component);
  assert.equal(calculateQqqPe(missingPrice).status, 'insufficient_coverage');
  assert.equal(calculateQqqPe(sample.map((component, index) => index === 0 ? { ...component, financialCurrency: 'EUR' } : component)).status, 'insufficient_coverage');

  const cancel = [
    { ticker: 'A', weight: 0.5, weightAsOf: '2026-01-02', price: 100, ttmEps: 10 },
    { ticker: 'B', weight: 0.5, weightAsOf: '2026-01-02', price: 100, ttmEps: -10 }
  ];
  assert.equal(calculateQqqPe(cancel).status, 'insufficient_coverage');
  const negative = cancel.map(component => ({ ...component, ttmEps: -10 }));
  assert.equal(calculateQqqPe(negative).status, 'insufficient_coverage');
});
