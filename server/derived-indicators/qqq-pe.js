'use strict';

const { finiteNumber, summarizeWeightedCoverage } = require('./coverage');

const ALGORITHM_VERSION = 'QQQ-PE-PROTOTYPE-v1';
const DEFAULT_THRESHOLDS = Object.freeze({ financialCoverage: 0.90, priceCoverage: 0.95, denominatorEpsilon: 1e-10 });

function positive(value) {
  return finiteNumber(value) && Number(value) > 0;
}

function compatibleCurrency(component) {
  return !component.financialCurrency || !component.priceCurrency || component.financialCurrency === component.priceCurrency;
}

function peFromYield(components, { excludeLosses, epsilon }) {
  const eligible = components.filter(component => positive(component.price) && finiteNumber(component.ttmEps) && compatibleCurrency(component)
    && (!excludeLosses || Number(component.ttmEps) > 0));
  const includedWeight = eligible.reduce((sum, component) => sum + Number(component.weight), 0);
  if (!(includedWeight > 0)) return { value: null, denominator: null, includedWeight: 0, contributions: [] };
  const contributions = eligible.map(component => {
    const normalizedWeight = Number(component.weight) / includedWeight;
    const earningsYield = Number(component.ttmEps) / Number(component.price);
    return { ticker: component.ticker, normalizedWeight, earningsYield, contribution: normalizedWeight * earningsYield };
  });
  const denominator = contributions.reduce((sum, component) => sum + component.contribution, 0);
  const value = Math.abs(denominator) <= epsilon ? null : 1 / denominator;
  return { value: Number.isFinite(value) && value > 0 ? value : null, rawValue: value, denominator, includedWeight, contributions };
}

function peFromAggregate(components, { excludeLosses, epsilon }) {
  const eligible = components.filter(component => positive(component.price) && positive(component.dilutedShares)
    && finiteNumber(component.ttmNetIncome) && compatibleCurrency(component)
    && (!excludeLosses || Number(component.ttmNetIncome) > 0));
  const contributions = eligible.map(component => ({
    ticker: component.ticker,
    marketCap: Number(component.price) * Number(component.dilutedShares),
    earnings: Number(component.ttmNetIncome)
  }));
  const marketCap = contributions.reduce((sum, component) => sum + component.marketCap, 0);
  const earnings = contributions.reduce((sum, component) => sum + component.earnings, 0);
  const value = Math.abs(earnings) <= epsilon ? null : marketCap / earnings;
  return { value: Number.isFinite(value) && value > 0 ? value : null, rawValue: value, marketCap, earnings, contributions };
}

function calculateQqqPe(components, options = {}) {
  if (!Array.isArray(components) || components.length < 1) throw new TypeError('QQQ PE components must be a non-empty array');
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
  const priceCoverage = summarizeWeightedCoverage(components, component => positive(component.price));
  const methodAFinancialCoverage = summarizeWeightedCoverage(components, component => finiteNumber(component.ttmEps) && compatibleCurrency(component));
  const methodBFinancialCoverage = summarizeWeightedCoverage(components, component => positive(component.dilutedShares)
    && finiteNumber(component.ttmNetIncome) && compatibleCurrency(component));
  const currencyMismatches = components.filter(component => !compatibleCurrency(component)).map(component => component.ticker);
  const weightDates = new Set(components.map(component => component.weightAsOf).filter(Boolean));
  const weightDateValid = weightDates.size === 1 && components.every(component => component.weightAsOf);

  const methodA = {
    includingLosses: peFromYield(components, { excludeLosses: false, epsilon: thresholds.denominatorEpsilon }),
    excludingLossesRenormalized: peFromYield(components, { excludeLosses: true, epsilon: thresholds.denominatorEpsilon })
  };
  const methodB = {
    includingLosses: peFromAggregate(components, { excludeLosses: false, epsilon: thresholds.denominatorEpsilon }),
    excludingLosses: peFromAggregate(components, { excludeLosses: true, epsilon: thresholds.denominatorEpsilon })
  };
  const methodAEligible = priceCoverage.coverageRatio >= thresholds.priceCoverage
    && methodAFinancialCoverage.coverageRatio >= thresholds.financialCoverage
    && weightDateValid && currencyMismatches.length === 0
    && methodA.includingLosses.value !== null && methodA.excludingLossesRenormalized.value !== null;
  const methodBEligible = priceCoverage.coverageRatio >= thresholds.priceCoverage
    && methodBFinancialCoverage.coverageRatio >= thresholds.financialCoverage
    && weightDateValid && currencyMismatches.length === 0
    && methodB.includingLosses.value !== null && methodB.excludingLosses.value !== null;

  const status = methodAEligible || methodBEligible ? (options.validStatus || 'demo') : 'insufficient_coverage';
  return {
    status,
    value: null,
    defaultMethod: null,
    algorithmVersion: ALGORITHM_VERSION,
    dataNature: options.dataNature || 'synthetic_fixture',
    weightAsOf: weightDateValid ? [...weightDates][0] : null,
    coverage: { price: priceCoverage, methodAFinancial: methodAFinancialCoverage, methodBFinancial: methodBFinancialCoverage },
    lossMakingWeight: summarizeWeightedCoverage(components, component => finiteNumber(component.ttmEps) && Number(component.ttmEps) < 0).coveredWeight,
    currencyMismatches,
    methods: {
      weightedEarningsYield: { eligible: methodAEligible, ...methodA },
      aggregateMarketCapToEarnings: { eligible: methodBEligible, ...methodB }
    },
    thresholds,
    componentCount: components.length
  };
}

module.exports = { ALGORITHM_VERSION, DEFAULT_THRESHOLDS, calculateQqqPe };

