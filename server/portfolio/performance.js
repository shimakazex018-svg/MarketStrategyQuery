'use strict';

function finite(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function productReturn(values) {
  let factor = 1;
  let count = 0;
  for (const value of values) {
    const number = finite(value);
    if (number === null || number <= -1) continue;
    factor *= 1 + number;
    count += 1;
  }
  return count ? factor - 1 : null;
}

function isExternalCashFlow(flow) {
  if (flow?.external === true) return true;
  return ['deposit', 'withdrawal'].includes(String(flow?.type || '').toLowerCase());
}

function calculateDailyPerformance(snapshots, cashFlows = [], reported = []) {
  const ordered = [...snapshots].filter(item => item?.date && finite(item.netLiquidation) !== null).sort((a, b) => a.date.localeCompare(b.date));
  const flowsByDate = new Map();
  for (const flow of cashFlows) {
    if (!flow?.date || !isExternalCashFlow(flow)) continue;
    const current = flowsByDate.get(flow.date) || { amount: 0, count: 0 };
    const amount = finite(flow.baseAmount ?? flow.amount) ?? 0;
    current.amount += amount;
    current.count += 1;
    flowsByDate.set(flow.date, current);
  }
  const reportedByDate = new Map(reported.filter(item => item?.date).map(item => [item.date, item]));
  let previous = null;
  let cumulativeFactor = 1;
  return ordered.map((snapshot, index) => {
    const endNav = finite(snapshot.netLiquidation);
    const flow = flowsByDate.get(snapshot.date)?.amount || 0;
    const beginNav = previous === null ? null : previous;
    const pnl = beginNav === null ? null : endNav - beginNav - flow;
    const dailyReturn = beginNav && beginNav !== 0 && pnl !== null ? pnl / beginNav : null;
    if (dailyReturn !== null && dailyReturn > -1) cumulativeFactor *= 1 + dailyReturn;
    const reportedRow = reportedByDate.get(snapshot.date);
    const reportedPnl = finite(reportedRow?.realizedPnl ?? reportedRow?.pnlAmount);
    const reportedReturn = finite(reportedRow?.dailyReturn);
    const reconciliationDifference = pnl === null || reportedPnl === null ? null : pnl - reportedPnl;
    const hasIndependentResult = reportedPnl !== null || reportedReturn !== null;
    const pnlOutlier = reconciliationDifference !== null && Math.abs(reconciliationDifference) > Math.max(1, Math.abs(pnl || 0) * 0.02);
    const returnOutlier = reportedReturn !== null && dailyReturn !== null && Math.abs(dailyReturn - reportedReturn) > 0.0005;
    const qualityStatus = beginNav === null || endNav === null
      ? 'incomplete'
      : !hasIndependentResult
        ? 'computed'
        : pnlOutlier || returnOutlier
          ? 'warning'
          : 'reconciled';
    const reconciliationStatus = beginNav === null || endNav === null
      ? 'incomplete'
      : !hasIndependentResult
        ? 'not_available'
        : pnlOutlier || returnOutlier
          ? 'outlier'
          : 'within_tolerance';
    previous = endNav;
    return {
      date: snapshot.date,
      beginNav,
      endNav,
      externalNetFlow: flow,
      pnlAmount: pnl,
      dailyReturn,
      cumulativeReturn: dailyReturn === null ? null : cumulativeFactor - 1,
      calculationMethod: hasIndependentResult ? 'ibkr_reported' : 'daily_flow_adjusted_return',
      qualityStatus,
      reconciliationStatus,
      reconciliationDifference,
      reportedPnl,
      reportedReturn,
      totalCash: finite(snapshot.totalCash),
      grossPositionValue: finite(snapshot.grossPositionValue),
      baseCurrency: snapshot.baseCurrency || null,
      importedAt: snapshot.importedAt || null,
      flowCount: flowsByDate.get(snapshot.date)?.count || 0,
      index
    };
  });
}

function aggregatePerformance(rows) {
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  if (!ordered.length) return { startDate: null, endDate: null, startNav: null, endNav: null, externalNetFlow: 0, pnlAmount: null, cumulativeReturn: null, reconciliationDifference: null, qualityStatus: 'incomplete', reconciliationStatus: 'incomplete', pointCount: 0 };
  const sum = field => ordered.reduce((total, row) => total + (finite(row[field]) ?? 0), 0);
  return {
    startDate: ordered[0].date,
    endDate: ordered.at(-1).date,
    startNav: finite(ordered[0].beginNav),
    endNav: finite(ordered.at(-1).endNav),
    externalNetFlow: sum('externalNetFlow'),
    pnlAmount: ordered.some(row => finite(row.pnlAmount) !== null) ? sum('pnlAmount') : null,
    cumulativeReturn: productReturn(ordered.map(row => row.dailyReturn)),
    reconciliationDifference: ordered.some(row => finite(row.reconciliationDifference) !== null) ? sum('reconciliationDifference') : null,
    qualityStatus: ordered.some(row => row.qualityStatus === 'warning') ? 'warning' : ordered.some(row => row.qualityStatus === 'incomplete') ? 'incomplete' : ordered.some(row => row.qualityStatus === 'computed') ? 'computed' : 'reconciled',
    reconciliationStatus: ordered.some(row => row.reconciliationStatus === 'outlier') ? 'outlier' : ordered.some(row => row.reconciliationStatus === 'incomplete') ? 'incomplete' : ordered.some(row => row.reconciliationStatus === 'not_available') ? 'not_available' : 'within_tolerance',
    pointCount: ordered.length,
    profitableDays: ordered.filter(row => finite(row.pnlAmount) > 0).length,
    losingDays: ordered.filter(row => finite(row.pnlAmount) < 0).length,
    largestGain: ordered.reduce((best, row) => finite(row.pnlAmount) !== null && (best === null || row.pnlAmount > best) ? row.pnlAmount : best, null),
    largestLoss: ordered.reduce((best, row) => finite(row.pnlAmount) !== null && (best === null || row.pnlAmount < best) ? row.pnlAmount : best, null)
  };
}

function monthlyPerformance(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, items]) => ({ month, ...aggregatePerformance(items), benchmarkReturn: null }));
}

function maskAccountId(accountId) {
  const value = String(accountId || '');
  if (!value) return 'IBKR主账户';
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`;
}

function sourceText(row) {
  return [row?.rawType, row?.rawCategory, row?.rawSubCategory, row?.type, row?.section, row?.description]
    .filter(value => value !== null && value !== undefined)
    .join(' ')
    .toLowerCase();
}

function classifyCashActivity(row = {}) {
  const text = sourceText(row);
  const amount = finite(row.baseAmount ?? row.amount);
  if (/withhold|withholding|tax/.test(text)) return { type: 'withholding_tax', storage: 'income', external: false };
  if (/commission|fee|fees|charge|expense/.test(text)) return { type: 'fee', storage: 'income', external: false };
  if (/dividend/.test(text)) return { type: 'dividend', storage: 'income', external: false };
  if (/interest/.test(text)) return { type: 'interest', storage: 'income', external: false };
  if (/internal|transfer|sweep|currency|conversion|foreign exchange|corporate action/.test(text)) return { type: 'internal_transfer', storage: 'cash_flow', external: false };
  if (/deposits?\s*\/\s*withdrawals?/.test(text)) {
    if (amount !== null && amount < 0) return { type: 'withdrawal', storage: 'cash_flow', external: true };
    if (amount !== null && amount > 0) return { type: 'deposit', storage: 'cash_flow', external: true };
  }
  if (/withdraw|outgoing|debit|出金/.test(text)) return { type: 'withdrawal', storage: 'cash_flow', external: true };
  if (/deposit|incoming|credit|入金/.test(text)) return { type: 'deposit', storage: 'cash_flow', external: true };
  return { type: 'other_income_expense', storage: 'income', external: false };
}

function normalizeFlowType(value, amount) {
  return classifyCashActivity({ type: value, amount }).type;
}

function normalizeSignedFlow(type, amount) {
  const value = Math.abs(finite(amount) ?? 0);
  return type === 'withdrawal' ? -value : type === 'deposit' ? value : finite(amount) ?? 0;
}

module.exports = { aggregatePerformance, calculateDailyPerformance, classifyCashActivity, finite, isExternalCashFlow, maskAccountId, monthlyPerformance, normalizeFlowType, normalizeSignedFlow, productReturn };
