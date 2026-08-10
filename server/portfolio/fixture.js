'use strict';

const { calculateDailyPerformance } = require('./performance');
const { withTransaction } = require('./sqlite');

function isoDate(date) { return date.toISOString().slice(0, 10); }

function seedSyntheticPortfolio(db, now = new Date()) {
  if (db.prepare('SELECT value FROM portfolio_meta WHERE key=?').get('synthetic-review-fixture')) return false;
  const importedAt = new Date(now).toISOString();
  const accountKey = 'fixture-sim-000001';
  const baseCurrency = 'USD';
  const snapshots = [];
  const cashFlows = [];
  const performance = [];
  const benchmarkRows = { nasdaq100: [], sp500: [] };
  let nav = 100_000;
  let index = 0;
  for (let cursor = new Date('2025-08-01T00:00:00Z'); cursor <= new Date('2026-08-07T00:00:00Z'); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if ([0, 6].includes(cursor.getUTCDay())) continue;
    const date = isoDate(cursor);
    let flow = 0;
    let flowType = null;
    if (date === '2025-10-06') { flow = 5_000; flowType = 'deposit'; }
    if (date === '2026-01-12') { flow = -1_200; flowType = 'withdrawal'; }
    if (date === '2026-04-06') { flow = 2_500; flowType = 'deposit'; }
    const pnl = 78 + Math.sin(index / 4.7) * 260 + Math.cos(index / 17) * 130 + (index % 29 === 0 ? -720 : 0);
    nav += flow + pnl;
    const totalCash = 22_000 + Math.sin(index / 14) * 1_200 + flow * 0.35;
    const grossPositionValue = nav - totalCash;
    snapshots.push({ accountKey, date, baseCurrency, netLiquidation: Number(nav.toFixed(2)), totalCash: Number(totalCash.toFixed(2)), grossPositionValue: Number(grossPositionValue.toFixed(2)), stockMarketValue: Number((grossPositionValue * 0.82).toFixed(2)), optionMarketValue: Number((grossPositionValue * 0.12).toFixed(2)), otherMarketValue: Number((grossPositionValue * 0.06).toFixed(2)), accruedCash: 42.15, source: 'synthetic-review-fixture', importedAt });
    if (flowType) cashFlows.push({ flowId: `fixture-flow-${date}`, accountKey, date, occurredAt: `${date}T15:30:00Z`, type: flowType, amount: flow, baseAmount: flow, currency: baseCurrency, description: flowType === 'deposit' ? 'Synthetic contribution' : 'Synthetic withdrawal', sourceId: `fixture-flow-${date}`, source: 'synthetic-review-fixture', importedAt });
    const ndxValue = 100 + index * 0.075 + Math.sin(index / 11) * 2.8;
    const spValue = 100 + index * 0.052 + Math.cos(index / 13) * 1.8;
    benchmarkRows.nasdaq100.push({ benchmarkId: 'nasdaq100', date, value: Number(ndxValue.toFixed(4)) });
    benchmarkRows.sp500.push({ benchmarkId: 'sp500', date, value: Number(spValue.toFixed(4)) });
    index += 1;
  }
  const daily = calculateDailyPerformance(snapshots.map(item => ({ date: item.date, netLiquidation: item.netLiquidation, totalCash: item.totalCash, grossPositionValue: item.grossPositionValue, baseCurrency: baseCurrency, importedAt })), cashFlows);
  performance.push(...daily.map(item => ({ ...item, accountKey, importedAt })));
  const latestDate = snapshots.at(-1).date;
  const positions = [
    { symbol: 'AAPL', conid: 'SIM-AAPL', securityType: 'STK', quantity: 120, marketPrice: 228.4, marketValue: 27_408, costBasis: 22_000, unrealizedPnl: 5_408, realizedPnl: 820 },
    { symbol: 'QQQ', conid: 'SIM-QQQ', securityType: 'ETF', quantity: 65, marketPrice: 548.2, marketValue: 35_633, costBasis: 30_100, unrealizedPnl: 5_533, realizedPnl: 1_280 },
    { symbol: 'MSFT', conid: 'SIM-MSFT', securityType: 'STK', quantity: 50, marketPrice: 514.8, marketValue: 25_740, costBasis: 23_800, unrealizedPnl: 1_940, realizedPnl: 410 }
  ].map((item, positionIndex) => ({ ...item, positionKey: `fixture-position-${positionIndex}`, accountKey, date: latestDate, currency: baseCurrency, sourceId: `fixture-position-${positionIndex}`, source: 'synthetic-review-fixture', importedAt }));
  const trades = [];
  for (let tradeIndex = 0; tradeIndex < 28; tradeIndex += 1) {
    const date = snapshots[Math.min(8 + tradeIndex * 8, snapshots.length - 1)].date;
    const symbol = ['AAPL', 'QQQ', 'MSFT'][tradeIndex % 3];
    const side = tradeIndex % 2 ? 'SELL' : 'BUY';
    trades.push({ executionId: `fixture-trade-${tradeIndex + 1}`, accountKey, symbol, conid: `SIM-${symbol}`, securityType: symbol === 'QQQ' ? 'ETF' : 'STK', currency: baseCurrency, occurredAt: `${date}T14:${String(10 + tradeIndex % 40).padStart(2, '0')}:00Z`, date, side, quantity: 10 + (tradeIndex % 5) * 5, price: Number((180 + tradeIndex * 2.3).toFixed(2)), proceeds: Number((tradeIndex % 2 ? 1 : -1) * (180 + tradeIndex * 2.3) * (10 + (tradeIndex % 5) * 5).toFixed(2)), commission: 1.25, realizedPnl: side === 'SELL' ? Number((120 + tradeIndex * 8.5).toFixed(2)) : null, sourceId: `fixture-trade-${tradeIndex + 1}`, source: 'synthetic-review-fixture', importedAt });
  }
  const incomeEvents = [];
  for (let eventIndex = 0; eventIndex < 18; eventIndex += 1) {
    const snapshot = snapshots[15 + eventIndex * 12];
    if (!snapshot) break;
    const isDividend = eventIndex % 3 !== 0;
    incomeEvents.push({ eventId: `fixture-income-${eventIndex + 1}`, accountKey, date: snapshot.date, occurredAt: `${snapshot.date}T16:00:00Z`, type: isDividend ? 'dividend' : 'interest', symbol: isDividend ? ['AAPL', 'QQQ'][eventIndex % 2] : null, amount: Number((isDividend ? 24 + eventIndex * 2 : 8 + eventIndex).toFixed(2)), baseAmount: Number((isDividend ? 24 + eventIndex * 2 : 8 + eventIndex).toFixed(2)), currency: baseCurrency, description: isDividend ? 'Synthetic dividend' : 'Synthetic interest', sourceId: `fixture-income-${eventIndex + 1}`, source: 'synthetic-review-fixture', importedAt });
  }

  withTransaction(db, () => {
    db.prepare('INSERT INTO portfolio_meta(key,value,updated_at) VALUES(?,?,?)').run('synthetic-review-fixture', 'true', importedAt);
    db.prepare('INSERT INTO portfolio_accounts(account_key,account_id,masked_account_label,base_currency,first_seen,last_seen,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(accountKey, 'SIM000001', 'SIM****0001', baseCurrency, snapshots[0].date, latestDate, importedAt, importedAt);
    const snapshotInsert = db.prepare('INSERT INTO account_daily_snapshots(account_key,date,base_currency,net_liquidation,total_cash,gross_position_value,stock_market_value,option_market_value,other_market_value,accrued_cash,source,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const item of snapshots) snapshotInsert.run(item.accountKey, item.date, item.baseCurrency, item.netLiquidation, item.totalCash, item.grossPositionValue, item.stockMarketValue, item.optionMarketValue, item.otherMarketValue, item.accruedCash, item.source, item.importedAt);
    const flowInsert = db.prepare('INSERT INTO cash_flows(flow_id,account_key,occurred_at,date,type,amount,currency,base_amount,exchange_rate,description,source_id,source,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const item of cashFlows) flowInsert.run(item.flowId, item.accountKey, item.occurredAt, item.date, item.type, item.amount, item.currency, item.baseAmount, 1, item.description, item.sourceId, item.source, item.importedAt);
    const performanceInsert = db.prepare('INSERT INTO daily_performance(account_key,date,begin_nav,end_nav,external_net_flow,pnl_amount,daily_return,cumulative_return,calculation_method,quality_status,reconciliation_status,reconciliation_difference,reported_pnl,reported_return,imported_at,total_cash,gross_position_value,flow_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const item of performance) performanceInsert.run(item.accountKey, item.date, item.beginNav, item.endNav, item.externalNetFlow, item.pnlAmount, item.dailyReturn, item.cumulativeReturn, item.calculationMethod, item.qualityStatus, item.reconciliationStatus, item.reconciliationDifference, item.reportedPnl, item.reportedReturn, item.importedAt, item.totalCash, item.grossPositionValue, item.flowCount);
    const benchmarkInsert = db.prepare('INSERT INTO benchmark_daily(benchmark_id,date,value,daily_return,cumulative_return,source,imported_at) VALUES(?,?,?,?,?,?,?)');
    for (const rows of Object.values(benchmarkRows)) {
      let previous = null; let cumulative = 1;
      for (const item of rows) {
        const dailyReturn = previous === null ? null : item.value / previous - 1;
        if (dailyReturn !== null) cumulative *= 1 + dailyReturn;
        benchmarkInsert.run(item.benchmarkId, item.date, item.value, dailyReturn, dailyReturn === null ? null : cumulative - 1, 'synthetic-review-fixture', importedAt);
        previous = item.value;
      }
    }
    const positionInsert = db.prepare('INSERT INTO positions_daily(position_key,account_key,date,conid,symbol,security_type,currency,quantity,market_price,market_value,cost_basis,unrealized_pnl,realized_pnl,source_id,source,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const item of positions) positionInsert.run(item.positionKey, item.accountKey, item.date, item.conid, item.symbol, item.securityType, item.currency, item.quantity, item.marketPrice, item.marketValue, item.costBasis, item.unrealizedPnl, item.realizedPnl, item.sourceId, item.source, item.importedAt);
    const tradeInsert = db.prepare('INSERT INTO trades(execution_id,account_key,symbol,conid,security_type,currency,occurred_at,date,side,quantity,price,proceeds,commission,realized_pnl,source_id,source,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const item of trades) tradeInsert.run(item.executionId, item.accountKey, item.symbol, item.conid, item.securityType, item.currency, item.occurredAt, item.date, item.side, item.quantity, item.price, item.proceeds, item.commission, item.realizedPnl, item.sourceId, item.source, item.importedAt);
    const incomeInsert = db.prepare('INSERT INTO income_events(event_id,account_key,date,occurred_at,type,symbol,amount,currency,base_amount,exchange_rate,description,source_id,source,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const item of incomeEvents) incomeInsert.run(item.eventId, item.accountKey, item.date, item.occurredAt, item.type, item.symbol, item.amount, item.currency, item.baseAmount, 1, item.description, item.sourceId, item.source, item.importedAt);
  });
  return true;
}

module.exports = { seedSyntheticPortfolio };
