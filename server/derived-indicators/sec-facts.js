'use strict';

const FACT_PRIORITIES = Object.freeze({
  netIncome: Object.freeze([
    { taxonomy: 'us-gaap', tag: 'NetIncomeLossAvailableToCommonStockholdersBasic' },
    { taxonomy: 'us-gaap', tag: 'NetIncomeLoss' },
    { taxonomy: 'us-gaap', tag: 'ProfitLoss' },
    { taxonomy: 'ifrs-full', tag: 'ProfitLossAttributableToOwnersOfParent' },
    { taxonomy: 'ifrs-full', tag: 'ProfitLoss' }
  ]),
  dilutedShares: Object.freeze([
    { taxonomy: 'us-gaap', tag: 'WeightedAverageNumberOfDilutedSharesOutstanding' },
    { taxonomy: 'ifrs-full', tag: 'WeightedAverageNumberOfSharesOutstandingDiluted' }
  ]),
  dilutedEps: Object.freeze([
    { taxonomy: 'us-gaap', tag: 'EarningsPerShareDiluted' },
    { taxonomy: 'ifrs-full', tag: 'DilutedEarningsLossPerShare' },
    { taxonomy: 'ifrs-full', tag: 'BasicAndDilutedEarningsLossPerShare' }
  ])
});

function factUnits(concept) {
  return concept && typeof concept === 'object' && concept.units && typeof concept.units === 'object'
    ? Object.entries(concept.units)
    : [];
}

function selectFactSeries(companyFacts, conceptName, priorities = FACT_PRIORITIES) {
  const candidates = priorities[conceptName];
  if (!Array.isArray(candidates)) throw new TypeError(`unknown SEC concept ${conceptName}`);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const concept = companyFacts?.facts?.[candidate.taxonomy]?.[candidate.tag];
    for (const [unit, facts] of factUnits(concept)) {
      if (!Array.isArray(facts) || !facts.length) continue;
      return {
        mapping: {
          taxonomy: candidate.taxonomy,
          tag: candidate.tag,
          unit,
          fallbackUsed: index > 0,
          confidence: index === 0 ? 'high' : index <= 2 ? 'medium' : 'low'
        },
        facts: facts.map(fact => ({
          ...fact,
          value: Number(fact.val),
          taxonomy: candidate.taxonomy,
          tag: candidate.tag,
          unit
        }))
      };
    }
  }
  return { mapping: null, facts: [] };
}

function periodType(fact) {
  if (fact.periodType) return fact.periodType;
  if (!fact.start || !fact.end) return 'instant';
  const days = (new Date(`${fact.end}T00:00:00Z`) - new Date(`${fact.start}T00:00:00Z`)) / 86_400_000 + 1;
  if (days <= 120) return 'quarter';
  if (days >= 300) return 'annual';
  return 'ytd';
}

function dedupeSecFacts(facts) {
  const selected = new Map();
  const replaced = [];
  for (const input of facts) {
    const fact = { ...input, value: Number(input.value ?? input.val), periodType: periodType(input) };
    if (!Number.isFinite(fact.value) || !fact.end) continue;
    const key = `${fact.start || ''}:${fact.end}:${fact.periodType}:${fact.fp || ''}`;
    const previous = selected.get(key);
    const rank = `${fact.filed || ''}:${fact.accn || ''}`;
    const previousRank = previous ? `${previous.filed || ''}:${previous.accn || ''}` : '';
    if (!previous || rank >= previousRank) {
      if (previous) replaced.push(previous);
      selected.set(key, fact);
    } else replaced.push(fact);
  }
  return {
    facts: [...selected.values()].sort((a, b) => a.end.localeCompare(b.end)),
    replaced
  };
}

function buildQuarterlyTtm(facts, { asOf = '9999-12-31' } = {}) {
  const deduped = dedupeSecFacts(facts);
  const quarters = deduped.facts
    .filter(fact => fact.periodType === 'quarter' && fact.end <= asOf)
    .sort((a, b) => b.end.localeCompare(a.end))
    .slice(0, 4)
    .sort((a, b) => a.end.localeCompare(b.end));
  if (quarters.length < 4) {
    return { status: 'insufficient_coverage', value: null, selectedFacts: quarters, replacedFacts: deduped.replaced };
  }
  for (let index = 1; index < quarters.length; index += 1) {
    if (quarters[index].start <= quarters[index - 1].end) {
      return { status: 'insufficient_coverage', value: null, reason: 'overlapping_quarters', selectedFacts: quarters, replacedFacts: deduped.replaced };
    }
  }
  return {
    status: 'fresh',
    value: quarters.reduce((sum, fact) => sum + fact.value, 0),
    start: quarters[0].start,
    end: quarters.at(-1).end,
    selectedFacts: quarters,
    replacedFacts: deduped.replaced,
    ignoredAnnualFacts: deduped.facts.filter(fact => fact.periodType === 'annual' && fact.end <= asOf)
  };
}

function applySplitAdjustments(facts, adjustments, kind) {
  if (!['perShare', 'shares'].includes(kind)) throw new TypeError('split adjustment kind must be perShare or shares');
  return facts.map(fact => {
    const cumulativeFactor = (adjustments || [])
      .filter(adjustment => fact.end < adjustment.effectiveDate)
      .reduce((factor, adjustment) => factor * Number(adjustment.factor), 1);
    if (!Number.isFinite(cumulativeFactor) || cumulativeFactor <= 0) throw new TypeError('invalid split factor');
    const value = Number(fact.value ?? fact.val);
    return { ...fact, value: kind === 'perShare' ? value / cumulativeFactor : value * cumulativeFactor, splitFactorApplied: cumulativeFactor };
  });
}

module.exports = {
  FACT_PRIORITIES,
  applySplitAdjustments,
  buildQuarterlyTtm,
  dedupeSecFacts,
  periodType,
  selectFactSeries
};

