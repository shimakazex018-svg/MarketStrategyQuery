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
const robustFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'derived-indicators', 'qqq-pe-robust-30.json'), 'utf8'));

function assertClose(actual, expected, epsilon = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not within ${epsilon} of ${expected}`);
}

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

test('QQQ PE raw calculation preserves losses and keeps exclusion as a diagnostic', () => {
  const result = calculateQqqPe(sample);
  assert.equal(result.status, 'robust_method_unavailable');
  assert.equal(result.rawStatus, 'demo');
  assert.equal(result.robustStatus, 'robust_method_unavailable');
  assert.equal(result.componentCount, 6);
  assert.equal(result.coverage.price.coverageRatio, 1);
  assert.equal(result.lossMakingWeight, 0.12);
  assert.equal(result.lossMakingCount, 1);
  assert.equal(result.algorithmRaw, 'PE-Q1-RAW-v1');
  assert.equal(result.algorithmRobust, 'PE-Q1-ROBUST-WMAD4-v1');
  assert.ok(result.rawPE > result.excludeLossDiagnosticPE);
  assert.equal(result.robustPE, null);
  assert.ok(result.qualityFlags.includes('robust_method_unavailable'));
  assert.equal(result.methods.weightedEarningsYield.eligible, true);
  assert.equal(result.methods.aggregateMarketCapToEarnings.eligible, true);
  assert.ok(result.methods.weightedEarningsYield.includingLosses.value > result.methods.weightedEarningsYield.excludingLossesRenormalized.value);
  assert.notEqual(result.methods.weightedEarningsYield.includingLosses.value, result.methods.aggregateMarketCapToEarnings.includingLosses.value);
  assert.equal(result.defaultMethod, null);
  assert.equal(result.value, null);
  assert.equal(result.algorithmRaw, 'PE-Q1-RAW-v1');
  assert.equal(result.denominatorStability.raw.classification, 'stable_positive');
  assert.equal(result.dataDate, '2026-01-02');
  assert.equal(result.dataDates.priceDateProvenance, 'legacy_fallback');
  assert.equal(result.methods.aggregateMarketCapToEarnings.diagnosticOnly, true);
  assert.match(result.methods.aggregateMarketCapToEarnings.calculationObject, /full_market_cap/);
  assert.equal(result.methods.aggregateMarketCapToEarnings.diagnostics.epsNetIncome.consistent, true);
  assert.equal(result.methods.aggregateMarketCapToEarnings.diagnostics.sharePriceDatesAligned, false);
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
  assert.equal(calculateQqqPe(cancel).rawPE, null);
  assert.ok(calculateQqqPe(cancel).qualityFlags.includes('unstable_denominator'));
  const negative = cancel.map(component => ({ ...component, ttmEps: -10 }));
  assert.equal(calculateQqqPe(negative).status, 'insufficient_coverage');
  assert.equal(calculateQqqPe(negative).rawPE, null);
  assert.ok(calculateQqqPe(negative).rawEarningsYield < 0);
});

test('robust PE matches raw PE when the 30-component fixture has no outliers', () => {
  const result = calculateQqqPe(robustFixture);
  assert.equal(result.status, 'demo');
  assert.equal(result.validComponentCount, 30);
  assert.equal(result.outlierCount, 0);
  assert.equal(result.outlierWeight, 0);
  assertClose(result.rawPE, result.robustPE);
  assert.equal(result.lossMakingCount, 3);
  assertClose(result.lossMakingWeight, 0.1);
  assert.ok(result.weightedMAD > 0);
  assertClose(result.robustScale, 1.4826 * result.weightedMAD);
  assert.deepEqual(result.rawRobustDifference, { signed: 0, absolute: 0 });
  assert.ok(result.lowerBound < -0.03);
  assert.ok(result.upperBound > 0.135);
});

test('robust PE winsorizes one extreme positive earnings yield without deleting it', () => {
  const components = robustFixture.map(component => component.ticker === 'ROB30' ? { ...component, ttmEps: 100 } : component);
  const result = calculateQqqPe(components);
  assert.equal(result.outlierCount, 1);
  assert.equal(result.affectedConstituents[0].ticker, 'ROB30');
  assert.equal(result.affectedConstituents[0].direction, 'upper');
  assert.ok(result.affectedConstituents[0].adjustedEarningsYield < result.affectedConstituents[0].originalEarningsYield);
  assert.ok(result.rawPE < result.robustPE);
  assert.ok(result.rawRobustDifference.signed > 0);
  assertClose(result.rawRobustDifference.absolute, Math.abs(result.robustPE - result.rawPE));
});

test('explicit price and financial dates are reported and inconsistent price dates block formal output', () => {
  const dated = robustFixture.map(component => ({
    ...component,
    priceAsOf: '2026-01-02',
    financialAsOf: '2025-12-31',
    dilutedSharesAsOf: '2025-12-31'
  }));
  const valid = calculateQqqPe(dated, { requireExplicitDates: true });
  assert.equal(valid.status, 'demo');
  assert.equal(valid.dataDate, '2026-01-02');
  assert.deepEqual(valid.dataDates, {
    weightAsOf: '2026-01-02',
    priceAsOf: '2026-01-02',
    priceDateValues: ['2026-01-02'],
    financialAsOfStart: '2025-12-31',
    financialAsOfEnd: '2025-12-31',
    priceDateProvenance: 'explicit',
    financialDateProvenance: 'explicit'
  });
  assert.equal(valid.methods.aggregateMarketCapToEarnings.diagnostics.sharePriceDatesAligned, false);

  const inconsistent = dated.map((component, index) => index === 0 ? { ...component, priceAsOf: '2026-01-03' } : component);
  const rejected = calculateQqqPe(inconsistent, { requireExplicitDates: true });
  assert.equal(rejected.rawPE, null);
  assert.equal(rejected.status, 'insufficient_coverage');
  assert.ok(rejected.qualityFlags.includes('price_date_invalid'));
});

test('robust PE winsorizes one extreme loss but keeps ordinary loss makers unchanged', () => {
  const components = robustFixture.map(component => component.ticker === 'ROB01' ? { ...component, ttmEps: -100 } : component);
  const result = calculateQqqPe(components);
  assert.equal(result.lossMakingCount, 3);
  assert.equal(result.outlierCount, 1);
  assert.equal(result.affectedConstituents[0].ticker, 'ROB01');
  assert.equal(result.affectedConstituents[0].direction, 'lower');
  assert.ok(result.rawPE > result.robustPE);
  const ordinaryLosses = calculateQqqPe(robustFixture);
  assert.equal(ordinaryLosses.lossMakingCount, 3);
  assert.equal(ordinaryLosses.affectedConstituents.some(component => ['ROB01', 'ROB02', 'ROB03'].includes(component.ticker)), false);
});

test('multiple outliers are deterministic and retain their original weights', () => {
  const components = robustFixture.map(component => {
    if (component.ticker === 'ROB29') return { ...component, ttmEps: 100 };
    if (component.ticker === 'ROB30') return { ...component, ttmEps: -100 };
    return component;
  });
  const result = calculateQqqPe(components);
  assert.equal(result.outlierCount, 2);
  assert.deepEqual(result.affectedConstituents.map(component => component.ticker), ['ROB29', 'ROB30']);
  assertClose(result.outlierWeight, 2 / 30);
  assert.deepEqual(result.affectedConstituents.map(component => component.reason), [
    'outside_weighted_mad_4_scale_bounds',
    'outside_weighted_mad_4_scale_bounds'
  ]);
});

test('large-weight outlier returns diagnostics but cannot be fresh', () => {
  const components = robustFixture.map(component => component.ticker === 'ROB30' ? { ...component, weight: 10, ttmEps: 100 } : component);
  const result = calculateQqqPe(components, { validStatus: 'fresh' });
  assert.equal(result.robustStatus, 'quality_warning');
  assert.equal(result.status, 'quality_warning');
  assert.ok(result.outlierWeight > 0.10);
  assert.ok(result.qualityFlags.includes('outlier_weight_exceeds_10_percent'));
  assert.ok(result.qualityFlags.includes('quality_warning'));
  assert.ok(result.robustPE > 0);
});

test('weighted MAD zero, fewer than 20 components and formal count below 80 use explicit fallback states', () => {
  const zeroMad = calculateQqqPe(robustFixture.map(component => ({ ...component, ttmEps: 5 })));
  assert.equal(zeroMad.robustStatus, 'robust_method_unavailable');
  assert.equal(zeroMad.robustPE, null);
  assert.equal(zeroMad.weightedMAD, 0);
  assert.ok(zeroMad.qualityFlags.includes('robust_method_unavailable'));

  const small = calculateQqqPe(robustFixture.slice(0, 19));
  assert.equal(small.robustStatus, 'robust_method_unavailable');
  assert.equal(small.validComponentCount, 19);

  const formal = calculateQqqPe(robustFixture, { formalFullUniverse: true });
  assert.equal(formal.status, 'insufficient_coverage');
  assert.equal(formal.rawPE, null);
  assert.ok(formal.qualityFlags.includes('valid_component_count_below_80'));
});

test('near-zero, raw-negative and robust-negative earnings yields never produce positive PE', () => {
  const nearZero = calculateQqqPe(robustFixture.map((component, index) => ({ ...component, ttmEps: index < 15 ? 1 : -1 })));
  assert.equal(nearZero.rawPE, null);
  assert.ok(nearZero.qualityFlags.includes('unstable_denominator'));

  const rawNegative = calculateQqqPe(robustFixture.map(component => ({ ...component, ttmEps: -1 })));
  assert.equal(rawNegative.rawPE, null);
  assert.ok(rawNegative.rawEarningsYield < 0);

  const robustNegative = calculateQqqPe(robustFixture.map((component, index) => ({ ...component, ttmEps: -20 + index * 0.5 })));
  assert.equal(robustNegative.robustPE, null);
  assert.ok(robustNegative.robustEarningsYield < 0);
  assert.ok(robustNegative.qualityFlags.includes('non_positive_robust_earnings_yield'));

  const symmetricNearZero = Array.from({ length: 30 }, (_, index) => {
    const signed = index < 15 ? index - 15 : index - 14;
    return {
      ticker: `ZERO${String(index + 1).padStart(2, '0')}`,
      weight: 1,
      weightAsOf: '2026-01-02',
      priceAsOf: '2026-01-02',
      financialAsOf: '2025-12-31',
      price: 100,
      ttmEps: signed,
      priceCurrency: 'USD',
      financialCurrency: 'USD'
    };
  });
  const robustNearZero = calculateQqqPe(symmetricNearZero, { requireExplicitDates: true });
  assert.equal(robustNearZero.robustPE, null);
  assert.equal(robustNearZero.denominatorStability.robust.classification, 'near_zero');
  assert.ok(robustNearZero.qualityFlags.includes('unstable_denominator'));
});

test('input order and global weight scale do not change robust PE results', () => {
  const withOutlier = robustFixture.map(component => component.ticker === 'ROB30' ? { ...component, ttmEps: 100 } : component);
  const original = calculateQqqPe(withOutlier);
  const reversed = calculateQqqPe([...withOutlier].reverse());
  const scaled = calculateQqqPe(withOutlier.map(component => ({ ...component, weight: component.weight * 0.01 })));
  for (const result of [reversed, scaled]) {
    assertClose(result.rawPE, original.rawPE);
    assertClose(result.robustPE, original.robustPE);
    assertClose(result.lowerBound, original.lowerBound);
    assertClose(result.upperBound, original.upperBound);
    assertClose(result.outlierWeight, original.outlierWeight);
    assert.deepEqual(result.affectedConstituents.map(component => component.ticker), ['ROB30']);
  }
});

test('non-finite EPS or price disables robust method without inventing a PE threshold', () => {
  const badEps = calculateQqqPe(robustFixture.map(component => component.ticker === 'ROB30' ? { ...component, ttmEps: Infinity } : component));
  assert.equal(badEps.rawStatus, 'demo');
  assert.equal(badEps.robustStatus, 'robust_method_unavailable');
  assert.equal(badEps.robustPE, null);
  assert.deepEqual(badEps.nonFiniteTickers, ['ROB30']);
  assert.ok(badEps.qualityFlags.includes('non_finite_input'));

  const badPrice = calculateQqqPe(robustFixture.map(component => component.ticker === 'ROB30' ? { ...component, price: NaN } : component));
  assert.equal(badPrice.robustStatus, 'robust_method_unavailable');
  assert.equal(badPrice.priceCoverageWeight, 29 / 30);
});

test('split-adjustment error is exposed as an outlier and high affected weight warning', () => {
  const splitError = robustFixture.map(component => component.ticker === 'ROB30'
    ? { ...component, weight: 10, ttmEps: component.ttmEps * 100 }
    : component);
  const result = calculateQqqPe(splitError, { validStatus: 'fresh' });
  assert.equal(result.affectedConstituents[0].ticker, 'ROB30');
  assert.equal(result.affectedConstituents[0].direction, 'upper');
  assert.equal(result.status, 'quality_warning');
  assert.ok(result.qualityFlags.includes('outlier_weight_exceeds_10_percent'));
});
