'use strict';

const { summarizeWeightedCoverage } = require('./coverage');

const RAW_ALGORITHM_VERSION = 'PE-Q1-RAW-v1';
const ROBUST_ALGORITHM_VERSION = 'PE-Q1-ROBUST-WMAD4-v1';
const ALGORITHM_VERSION = RAW_ALGORITHM_VERSION;
const DEFAULT_THRESHOLDS = Object.freeze({
  financialCoverage: 0.90,
  priceCoverage: 0.95,
  provisionalFinancialCoverage: 0.70,
  provisionalPriceCoverage: 0.80,
  denominatorEpsilon: 1e-10,
  minimumRobustComponents: 20,
  minimumFormalComponents: 80,
  robustMadMultiplier: 4,
  maximumOutlierWeight: 0.10,
  maximumFreshWeightPriceBusinessDays: 5,
  provisionalWeightPriceBusinessDays: 20,
  maximumRawRobustRelativeDifference: 0.25,
  majorConstituentWeight: 0.02
});

function finiteNumeric(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function positive(value) {
  return finiteNumeric(value) && Number(value) > 0;
}

function compatibleCurrency(component) {
  return !component.financialCurrency || !component.priceCurrency || component.financialCurrency === component.priceCurrency;
}

function dateSummary(components, field, fallbackField, { requireExplicit = false } = {}) {
  const explicitValues = components.map(component => component[field]).filter(Boolean);
  const values = components.map(component => component[field] || (!requireExplicit ? component[fallbackField] : null)).filter(Boolean);
  const unique = [...new Set(values)].sort();
  return {
    value: unique.length === 1 && values.length === components.length ? unique[0] : null,
    values: unique,
    complete: values.length === components.length,
    consistent: unique.length === 1 && values.length === components.length,
    provenance: explicitValues.length === components.length ? 'explicit' : requireExplicit ? 'missing' : 'legacy_fallback'
  };
}

function denominatorStability(value, epsilon) {
  let classification = 'unavailable';
  if (Number.isFinite(value)) {
    if (Math.abs(value) <= epsilon) classification = 'near_zero';
    else if (value < 0) classification = 'negative';
    else classification = 'stable_positive';
  }
  return {
    stable: classification === 'stable_positive',
    classification,
    denominator: Number.isFinite(value) ? value : null,
    absoluteDenominator: Number.isFinite(value) ? Math.abs(value) : null,
    epsilon
  };
}

function businessDayDistance(left, right) {
  if (!left || !right) return null;
  const start = new Date(`${left < right ? left : right}T00:00:00Z`);
  const end = new Date(`${left < right ? right : left}T00:00:00Z`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return null;
  let count = 0;
  for (let cursor = new Date(start.valueOf()); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

function epsNetIncomeDiagnostics(components, tolerance = 1e-6) {
  const affectedConstituents = [];
  for (const component of components) {
    if (!finiteNumeric(component.ttmEps) || !finiteNumeric(component.ttmNetIncome) || !positive(component.dilutedShares)) continue;
    const reportedEps = Number(component.ttmEps);
    const impliedEps = Number(component.ttmNetIncome) / Number(component.dilutedShares);
    const scale = Math.max(Math.abs(reportedEps), Math.abs(impliedEps), 1e-12);
    const relativeDifference = Math.abs(reportedEps - impliedEps) / scale;
    if (relativeDifference > tolerance) affectedConstituents.push({ ticker: component.ticker, reportedEps, impliedEps, relativeDifference });
  }
  return { consistent: affectedConstituents.length === 0, tolerance, affectedConstituents };
}

function hasNonFiniteFinancialInput(component) {
  return [component.price, component.ttmEps].some(value => value !== null && value !== undefined && value !== '' && !Number.isFinite(Number(value)));
}

function weightedMedian(items, valueSelector) {
  const ordered = items
    .map(item => ({ item, value: Number(valueSelector(item)), weight: Number(item.weight) }))
    .filter(entry => Number.isFinite(entry.value) && Number.isFinite(entry.weight) && entry.weight >= 0)
    .sort((left, right) => left.value - right.value || String(left.item.ticker || '').localeCompare(String(right.item.ticker || '')));
  const totalWeight = ordered.reduce((sum, entry) => sum + entry.weight, 0);
  if (!(totalWeight > 0)) return null;
  const midpoint = totalWeight / 2;
  const tolerance = Number.EPSILON * Math.max(1, totalWeight) * 16;
  let cumulative = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index];
    cumulative += entry.weight;
    if (Math.abs(cumulative - midpoint) <= tolerance) {
      const next = ordered.slice(index + 1).find(candidate => candidate.weight > 0);
      return next ? (entry.value + next.value) / 2 : entry.value;
    }
    if (cumulative > midpoint) return entry.value;
  }
  return ordered[ordered.length - 1].value;
}

function inversePositiveYield(earningsYield, epsilon) {
  if (!Number.isFinite(earningsYield) || earningsYield <= epsilon) return null;
  const value = 1 / earningsYield;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function excludeLossDiagnostic(eligible, epsilon) {
  const profitable = eligible.filter(component => Number(component.ttmEps) > 0);
  const includedWeight = profitable.reduce((sum, component) => sum + Number(component.weight), 0);
  if (!(includedWeight > 0)) return { value: null, earningsYield: null, includedWeight: 0, contributions: [] };
  const contributions = profitable.map(component => {
    const normalizedWeight = Number(component.weight) / includedWeight;
    const earningsYield = Number(component.ttmEps) / Number(component.price);
    return { ticker: component.ticker, normalizedWeight, earningsYield, contribution: normalizedWeight * earningsYield };
  });
  const earningsYield = contributions.reduce((sum, component) => sum + component.contribution, 0);
  return { value: inversePositiveYield(earningsYield, epsilon), earningsYield, includedWeight, contributions };
}

function peFromAggregate(components, { excludeLosses, epsilon }) {
  const eligible = components.filter(component => positive(component.price) && positive(component.dilutedShares)
    && finiteNumeric(component.ttmNetIncome) && compatibleCurrency(component)
    && (!excludeLosses || Number(component.ttmNetIncome) > 0));
  const contributions = eligible.map(component => ({
    ticker: component.ticker,
    marketCap: Number(component.price) * Number(component.dilutedShares),
    earnings: Number(component.ttmNetIncome)
  }));
  const marketCap = contributions.reduce((sum, component) => sum + component.marketCap, 0);
  const earnings = contributions.reduce((sum, component) => sum + component.earnings, 0);
  const rawValue = Math.abs(earnings) <= epsilon ? null : marketCap / earnings;
  return { value: Number.isFinite(rawValue) && rawValue > 0 ? rawValue : null, rawValue, marketCap, earnings, contributions };
}

function calculateQqqPe(components, options = {}) {
  if (!Array.isArray(components) || components.length < 1) throw new TypeError('QQQ PE components must be a non-empty array');
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
  const qualityFlags = [];
  const addFlag = flag => { if (!qualityFlags.includes(flag)) qualityFlags.push(flag); };

  const priceCoverage = summarizeWeightedCoverage(components, component => positive(component.price));
  const financialCoverage = summarizeWeightedCoverage(components, component => finiteNumeric(component.ttmEps) && compatibleCurrency(component));
  const methodBFinancialCoverage = summarizeWeightedCoverage(components, component => positive(component.dilutedShares)
    && finiteNumeric(component.ttmNetIncome) && compatibleCurrency(component));
  const totalWeight = priceCoverage.totalWeight;
  const currencyMismatches = components.filter(component => !compatibleCurrency(component)).map(component => component.ticker);
  const nonFiniteTickers = components.filter(hasNonFiniteFinancialInput).map(component => component.ticker);
  const weightDates = new Set(components.map(component => component.weightAsOf).filter(Boolean));
  const weightDateValid = weightDates.size === 1 && components.every(component => component.weightAsOf);
  const eligible = components.filter(component => positive(component.price) && finiteNumeric(component.ttmEps) && compatibleCurrency(component));
  const priceDates = dateSummary(eligible, 'priceAsOf', 'weightAsOf', { requireExplicit: options.requireExplicitDates === true });
  const financialDates = dateSummary(eligible, 'financialAsOf', 'weightAsOf', { requireExplicit: options.requireExplicitDates === true });
  const weightAsOf = weightDateValid ? [...weightDates][0] : null;
  const weightPriceBusinessDays = businessDayDistance(weightAsOf, priceDates.value);

  const contributions = eligible.map(component => {
    const normalizedWeight = Number(component.weight) / totalWeight;
    const earningsYield = Number(component.ttmEps) / Number(component.price);
    return {
      ticker: component.ticker,
      weight: normalizedWeight,
      originalWeight: Number(component.weight),
      earningsYield,
      contribution: normalizedWeight * earningsYield
    };
  });
  const rawYieldCandidate = contributions.reduce((sum, component) => sum + component.contribution, 0);
  const rawEarningsYield = Number.isFinite(rawYieldCandidate) ? rawYieldCandidate : null;
  const lossMaking = contributions.filter(component => component.earningsYield < 0);
  const lossMakingWeight = lossMaking.reduce((sum, component) => sum + component.weight, 0);
  const excludeLoss = excludeLossDiagnostic(eligible, thresholds.denominatorEpsilon);

  if (financialCoverage.coverageRatio < thresholds.financialCoverage) addFlag('financial_coverage_below_threshold');
  if (priceCoverage.coverageRatio < thresholds.priceCoverage) addFlag('price_coverage_below_threshold');
  if (!weightDateValid) addFlag('weight_date_invalid');
  if (!priceDates.consistent) addFlag('price_date_invalid');
  if (!financialDates.complete) addFlag('financial_date_missing');
  if (currencyMismatches.length) addFlag('currency_mismatch');
  if (nonFiniteTickers.length) addFlag('non_finite_input');
  if (rawEarningsYield !== null && Math.abs(rawEarningsYield) <= thresholds.denominatorEpsilon) addFlag('unstable_denominator');
  if (rawEarningsYield !== null && rawEarningsYield <= 0) addFlag('non_positive_raw_earnings_yield');

  const formalCountEligible = !options.formalFullUniverse || eligible.length >= thresholds.minimumFormalComponents;
  if (!formalCountEligible) addFlag('valid_component_count_below_80');
  if (weightPriceBusinessDays !== null && weightPriceBusinessDays > thresholds.maximumFreshWeightPriceBusinessDays) addFlag('weight_price_date_gap_exceeds_5_business_days');
  if (weightPriceBusinessDays !== null && weightPriceBusinessDays > thresholds.provisionalWeightPriceBusinessDays) addFlag('weight_price_date_gap_exceeds_20_business_days');
  const mvpPolicy = options.statusPolicy === 'mvp';
  const minimumCoverageEligible = financialCoverage.coverageRatio >= thresholds.provisionalFinancialCoverage
    && priceCoverage.coverageRatio >= thresholds.provisionalPriceCoverage;
  const traceableDates = weightDateValid && priceDates.complete && financialDates.complete;
  const minimumQualityEligible = minimumCoverageEligible
    && traceableDates
    && currencyMismatches.length === 0
    && rawEarningsYield !== null;
  const legacyBaseQualityEligible = financialCoverage.coverageRatio >= thresholds.financialCoverage
    && priceCoverage.coverageRatio >= thresholds.priceCoverage
    && weightDateValid
    && priceDates.consistent
    && financialDates.complete
    && currencyMismatches.length === 0
    && formalCountEligible
    && rawEarningsYield !== null;
  const baseQualityEligible = mvpPolicy ? minimumQualityEligible : legacyBaseQualityEligible;
  const rawPE = baseQualityEligible ? inversePositiveYield(rawEarningsYield, thresholds.denominatorEpsilon) : null;
  let rawStatus = baseQualityEligible && rawPE !== null ? (options.validStatus || (mvpPolicy ? 'provisional' : 'demo')) : 'insufficient_coverage';

  let weightedMedianEarningsYield = null;
  let weightedMAD = null;
  let lowerBound = null;
  let upperBound = null;
  let robustScale = null;
  let robustEarningsYield = null;
  let robustPE = null;
  let affectedConstituents = [];
  let outlierWeight = 0;
  let robustMethodAvailable = eligible.length >= thresholds.minimumRobustComponents && nonFiniteTickers.length === 0;

  if (robustMethodAvailable) {
    weightedMedianEarningsYield = weightedMedian(eligible, component => Number(component.ttmEps) / Number(component.price));
    const deviations = eligible.map(component => ({
      ...component,
      deviation: Math.abs((Number(component.ttmEps) / Number(component.price)) - weightedMedianEarningsYield)
    }));
    weightedMAD = weightedMedian(deviations, component => component.deviation);
    robustScale = weightedMAD === null ? null : 1.4826 * weightedMAD;
    lowerBound = robustScale === null ? null : weightedMedianEarningsYield - thresholds.robustMadMultiplier * robustScale;
    upperBound = robustScale === null ? null : weightedMedianEarningsYield + thresholds.robustMadMultiplier * robustScale;
    robustMethodAvailable = Number.isFinite(weightedMedianEarningsYield) && Number.isFinite(weightedMAD) && weightedMAD > 0
      && Number.isFinite(lowerBound) && Number.isFinite(upperBound) && lowerBound <= upperBound;
  }

  if (robustMethodAvailable) {
    const robustContributions = eligible.map(component => {
      const originalEarningsYield = Number(component.ttmEps) / Number(component.price);
      const adjustedEarningsYield = Math.min(upperBound, Math.max(lowerBound, originalEarningsYield));
      const weight = Number(component.weight) / totalWeight;
      if (adjustedEarningsYield !== originalEarningsYield) {
        affectedConstituents.push({
          ticker: component.ticker,
          weight,
          originalEarningsYield,
          adjustedEarningsYield,
          direction: originalEarningsYield < lowerBound ? 'lower' : 'upper',
          reason: 'outside_weighted_mad_4_scale_bounds'
        });
      }
      return weight * adjustedEarningsYield;
    });
    robustEarningsYield = robustContributions.reduce((sum, contribution) => sum + contribution, 0);
    if (!Number.isFinite(robustEarningsYield)) {
      robustEarningsYield = null;
      robustMethodAvailable = false;
    }
    affectedConstituents.sort((left, right) => String(left.ticker).localeCompare(String(right.ticker)));
    outlierWeight = affectedConstituents.reduce((sum, component) => sum + component.weight, 0);
    if (robustEarningsYield !== null && Math.abs(robustEarningsYield) <= thresholds.denominatorEpsilon) addFlag('unstable_denominator');
    if (robustEarningsYield !== null && robustEarningsYield <= 0) addFlag('non_positive_robust_earnings_yield');
    if (baseQualityEligible) robustPE = inversePositiveYield(robustEarningsYield, thresholds.denominatorEpsilon);
  }

  if (!robustMethodAvailable) {
    weightedMedianEarningsYield = Number.isFinite(weightedMedianEarningsYield) ? weightedMedianEarningsYield : null;
    weightedMAD = Number.isFinite(weightedMAD) ? weightedMAD : null;
    lowerBound = Number.isFinite(lowerBound) ? lowerBound : null;
    upperBound = Number.isFinite(upperBound) ? upperBound : null;
    robustScale = Number.isFinite(robustScale) ? robustScale : null;
    robustEarningsYield = null;
    robustPE = null;
    affectedConstituents = [];
    outlierWeight = 0;
    addFlag('robust_method_unavailable');
  }

  let robustStatus;
  if (!baseQualityEligible) robustStatus = 'insufficient_coverage';
  else if (!robustMethodAvailable) robustStatus = 'robust_method_unavailable';
  else if (robustPE === null) robustStatus = 'insufficient_coverage';
  else if (outlierWeight > thresholds.maximumOutlierWeight) {
    robustStatus = 'quality_warning';
    addFlag('outlier_weight_exceeds_10_percent');
    addFlag('quality_warning');
  } else robustStatus = options.validStatus || 'demo';

  let status = rawStatus;
  if (rawStatus !== 'insufficient_coverage') {
    if (robustStatus === 'robust_method_unavailable') status = robustStatus;
    else if (robustStatus === 'quality_warning') status = robustStatus;
  }

  const aggregateIncludingLosses = peFromAggregate(components, { excludeLosses: false, epsilon: thresholds.denominatorEpsilon });
  const aggregateExcludingLosses = peFromAggregate(components, { excludeLosses: true, epsilon: thresholds.denominatorEpsilon });
  const aggregateComponents = components.filter(component => positive(component.price) && positive(component.dilutedShares)
    && finiteNumeric(component.ttmNetIncome) && compatibleCurrency(component));
  const sharePriceDateAlignment = aggregateComponents.map(component => ({
    ticker: component.ticker,
    priceAsOf: component.priceAsOf || null,
    dilutedSharesAsOf: component.dilutedSharesAsOf || component.financialAsOf || null,
    aligned: Boolean(component.priceAsOf && (component.dilutedSharesAsOf || component.financialAsOf)
      && component.priceAsOf === (component.dilutedSharesAsOf || component.financialAsOf))
  }));
  const aggregateDiagnostics = {
    epsNetIncome: epsNetIncomeDiagnostics(aggregateComponents),
    sharePriceDatesAligned: sharePriceDateAlignment.length > 0 && sharePriceDateAlignment.every(component => component.aligned),
    sharePriceDateAlignment
  };
  const rawRobustDifference = rawPE !== null && robustPE !== null
    ? { signed: robustPE - rawPE, absolute: Math.abs(robustPE - rawPE) }
    : null;
  const rawRobustRelativeDifference = rawRobustDifference && rawPE > 0
    ? rawRobustDifference.absolute / rawPE
    : null;
  if (rawRobustRelativeDifference !== null && rawRobustRelativeDifference > thresholds.maximumRawRobustRelativeDifference) {
    addFlag('raw_robust_difference_abnormally_large');
  }
  const missingTickers = [...new Set([
    ...priceCoverage.missingTickers,
    ...financialCoverage.missingTickers
  ])].sort();
  const majorMissingTickers = components
    .filter(component => missingTickers.includes(component.ticker) && Number(component.weight) / totalWeight >= thresholds.majorConstituentWeight)
    .map(component => component.ticker)
    .sort();
  if (majorMissingTickers.length) addFlag('major_constituent_missing');
  const externalQualityFlags = Array.isArray(options.qualityFlags) ? options.qualityFlags : [];
  externalQualityFlags.forEach(addFlag);

  let qualityStatus = null;
  if (mvpPolicy) {
    const rawStable = denominatorStability(rawEarningsYield, thresholds.denominatorEpsilon).stable;
    const robustStable = denominatorStability(robustEarningsYield, thresholds.denominatorEpsilon).stable;
    const warning = outlierWeight > thresholds.maximumOutlierWeight
      || (weightPriceBusinessDays !== null && weightPriceBusinessDays > thresholds.maximumFreshWeightPriceBusinessDays)
      || majorMissingTickers.length > 0
      || rawRobustRelativeDifference > thresholds.maximumRawRobustRelativeDifference
      || externalQualityFlags.length > 0;
    if (warning) {
      qualityStatus = 'quality_warning';
      addFlag('quality_warning');
    }
    const freshEligible = rawPE !== null && robustPE !== null
      && financialCoverage.coverageRatio >= thresholds.financialCoverage
      && priceCoverage.coverageRatio >= thresholds.priceCoverage
      && traceableDates && priceDates.consistent
      && rawStable && robustStable
      && outlierWeight <= thresholds.maximumOutlierWeight
      && (weightPriceBusinessDays === null || weightPriceBusinessDays <= thresholds.maximumFreshWeightPriceBusinessDays)
      && currencyMismatches.length === 0
      && !externalQualityFlags.length;
    if (rawPE === null || robustPE === null || !minimumQualityEligible || !rawStable || !robustStable) {
      status = 'insufficient_coverage';
      rawStatus = rawPE === null ? 'insufficient_coverage' : 'provisional';
    } else status = freshEligible ? 'fresh' : 'provisional';
    robustStatus = robustPE === null ? 'insufficient_coverage' : status;
  }

  return {
    status,
    qualityStatus,
    statusMessage: status === 'provisional' ? '初步估算，部分成分数据缺失或日期并非完全一致。' : null,
    rawStatus,
    robustStatus,
    value: null,
    defaultMethod: null,
    rawPE,
    robustPE,
    excludeLossDiagnosticPE: excludeLoss.value,
    rawEarningsYield,
    robustEarningsYield,
    denominatorStability: {
      raw: denominatorStability(rawEarningsYield, thresholds.denominatorEpsilon),
      robust: denominatorStability(robustEarningsYield, thresholds.denominatorEpsilon)
    },
    algorithmRaw: RAW_ALGORITHM_VERSION,
    algorithmRobust: ROBUST_ALGORITHM_VERSION,
    algorithmVersion: RAW_ALGORITHM_VERSION,
    weightedMedianEarningsYield,
    weightedMedian: weightedMedianEarningsYield,
    weightedMAD,
    robustScale,
    lowerBound,
    upperBound,
    outlierCount: affectedConstituents.length,
    outlierWeight,
    rawRobustDifference,
    rawRobustRelativeDifference,
    lossMakingCount: lossMaking.length,
    lossMakingWeight,
    financialCoverageWeight: financialCoverage.coverageRatio,
    priceCoverageWeight: priceCoverage.coverageRatio,
    affectedConstituents,
    qualityFlags,
    missingConstituentCount: missingTickers.length,
    missingTickers,
    majorMissingTickers,
    dataNature: options.dataNature || 'synthetic_fixture',
    weightAsOf,
    weightPriceBusinessDays,
    dataDate: priceDates.value,
    dataDates: {
      weightAsOf: weightDateValid ? [...weightDates][0] : null,
      priceAsOf: priceDates.value,
      priceDateValues: priceDates.values,
      financialAsOfStart: financialDates.values[0] || null,
      financialAsOfEnd: financialDates.values.at(-1) || null,
      priceDateProvenance: priceDates.provenance,
      financialDateProvenance: financialDates.provenance
    },
    validComponentCount: eligible.length,
    componentCount: components.length,
    calculatedAt: (options.calculatedAt instanceof Date ? options.calculatedAt : new Date(options.calculatedAt || Date.now())).toISOString(),
    currencyMismatches,
    nonFiniteTickers,
    coverage: { price: priceCoverage, methodAFinancial: financialCoverage, methodBFinancial: methodBFinancialCoverage },
    methods: {
      weightedEarningsYield: {
        eligible: rawStatus !== 'insufficient_coverage',
        includingLosses: {
          value: rawPE,
          rawValue: rawEarningsYield === null || Math.abs(rawEarningsYield) <= thresholds.denominatorEpsilon ? null : 1 / rawEarningsYield,
          denominator: rawEarningsYield,
          includedWeight: contributions.reduce((sum, component) => sum + component.weight, 0),
          contributions
        },
        excludingLossesRenormalized: {
          value: excludeLoss.value,
          denominator: excludeLoss.earningsYield,
          includedWeight: excludeLoss.includedWeight,
          contributions: excludeLoss.contributions
        }
      },
      aggregateMarketCapToEarnings: {
        eligible: methodBFinancialCoverage.coverageRatio >= thresholds.financialCoverage
          && priceCoverage.coverageRatio >= thresholds.priceCoverage && weightDateValid && currencyMismatches.length === 0,
        diagnosticOnly: true,
        calculationObject: 'covered_companies_full_market_cap_to_full_net_income_not_qqq_weighted_portfolio',
        diagnostics: aggregateDiagnostics,
        includingLosses: aggregateIncludingLosses,
        excludingLosses: aggregateExcludingLosses
      }
    },
    thresholds
  };
}

module.exports = {
  ALGORITHM_VERSION,
  RAW_ALGORITHM_VERSION,
  ROBUST_ALGORITHM_VERSION,
  DEFAULT_THRESHOLDS,
  businessDayDistance,
  calculateQqqPe,
  weightedMedian
};
