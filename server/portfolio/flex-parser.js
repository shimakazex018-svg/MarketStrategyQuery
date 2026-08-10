'use strict';

const REQUIRED_SECTIONS = Object.freeze(['date', 'base_currency', 'net_asset_value']);

const ERROR_CATEGORIES = Object.freeze({
  1001: 'report_generation_pending', 1003: 'report_generation_pending', 1004: 'report_generation_pending',
  1005: 'report_generation_pending', 1006: 'report_generation_pending', 1007: 'report_generation_pending',
  1008: 'report_generation_pending', 1009: 'report_generation_pending', 1019: 'report_generation_pending',
  1012: 'invalid_token', 1015: 'invalid_token', 1013: 'authentication_error',
  1014: 'invalid_query', 1016: 'authentication_error', 1017: 'invalid_query', 1018: 'http_error',
  1020: 'schema_error', 1021: 'http_error'
});

const SECTION_KINDS = Object.freeze({
  accountinformation: 'snapshot', accountsummary: 'snapshot', financialsummary: 'snapshot',
  netassetvalue: 'snapshot', nav: 'snapshot', cashreport: 'snapshot', cashbalance: 'snapshot',
  cashtransaction: 'cashFlow', cashtransactions: 'cashFlow', cashflow: 'cashFlow', cashflows: 'cashFlow',
  depositswithdrawals: 'cashFlow', externalcashflow: 'cashFlow', transaction: 'transaction', transactions: 'transaction',
  trade: 'trade', trades: 'trade', execution: 'trade', executions: 'trade',
  openposition: 'position', openpositions: 'position', position: 'position', positions: 'position',
  dividend: 'income', dividends: 'income', interest: 'income', fee: 'income', fees: 'income',
  commission: 'income', commissions: 'income', withholdingtax: 'income', incomeevent: 'income', incomeevents: 'income',
  mtmperformance: 'performance', performance: 'performance', dailyperformance: 'performance',
  realizedunrealizedpnl: 'performance', pnl: 'performance'
});

const REQUIRED_FIELD_ALIASES = Object.freeze({
  accountId: ['accountid', 'acctid', 'account'],
  date: ['date', 'reportdate', 'tradedate', 'transactiondate', 'settlementdate', 'fromdate', 'todate'],
  occurredAt: ['datetime', 'date/time', 'executiontime', 'transactiontime', 'tradetime', 'time'],
  baseCurrency: ['basecurrency', 'basecurr', 'accountbasecurrency'],
  currency: ['currency', 'curr'],
  netLiquidation: ['netliquidation', 'netassetvalue', 'nav', 'netliquidationvalue', 'endingnav', 'endingnetliquidation'],
  totalCash: ['totalcash', 'cashbalance', 'cash', 'cashvalue'],
  grossPositionValue: ['grosspositionvalue', 'grossposition', 'grossmarketvalue'],
  stockMarketValue: ['stockmarketvalue', 'stockvalue', 'equitymarketvalue'],
  optionMarketValue: ['optionmarketvalue', 'optionvalue'],
  otherMarketValue: ['othermarketvalue', 'otherassetvalue'],
  accruedCash: ['accruedcash', 'accrued'],
  type: ['type', 'transactiontype', 'activitytype', 'incometype', 'category', 'subtype'],
  amount: ['amount', 'cashamount', 'netamount', 'totalamount', 'value'],
  baseAmount: ['baseamount', 'baseamountvalue', 'basevalue', 'amountbase'],
  exchangeRate: ['exchangerate', 'fxrate', 'rate'],
  description: ['description', 'details', 'memo', 'name'],
  sourceId: ['sourceid', 'transactionid', 'tradeid', 'executionid', 'activityid', 'id'],
  symbol: ['symbol', 'ticker', 'asset', 'underlying'],
  conid: ['conid', 'contractid'],
  securityType: ['assetclass', 'securitytype', 'sectype', 'type'],
  side: ['side', 'buy/sell', 'buysell', 'action'],
  quantity: ['quantity', 'qty', 'position'],
  price: ['price', 'tradeprice', 'marketprice'],
  marketPrice: ['marketprice', 'price'],
  marketValue: ['marketvalue', 'positionvalue'],
  costBasis: ['costbasis', 'cost'],
  unrealizedPnl: ['unrealizedpnl', 'unrealizedprofitloss', 'unrealizedgainloss'],
  realizedPnl: ['realizedpnl', 'realizedprofitloss', 'realizedgainloss'],
  proceeds: ['proceeds', 'netproceeds'],
  commission: ['commission', 'commissions', 'fees', 'fee'],
  dailyReturn: ['dailyreturn', 'return', 'twrr', 'twr'],
  cumulativeReturn: ['cumulativereturn', 'cumulativetwr']
});

function normalizeName(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function decodeXml(value) {
  return String(value || '').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function parseAttributes(source) {
  const attrs = Object.create(null);
  const pattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("[^"]*"|'[^']*')/g;
  let match;
  while ((match = pattern.exec(source))) attrs[match[1]] = decodeXml(match[2].slice(1, -1));
  return attrs;
}

function parseXml(xml) {
  if (typeof xml !== 'string' || !xml.trim()) throw new TypeError('Flex XML is empty');
  const root = { name: '#document', attrs: Object.create(null), children: [], text: '' };
  const stack = [root];
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/\s*([A-Za-z_:][A-Za-z0-9_.:-]*)\s*>|<\s*([A-Za-z_:][A-Za-z0-9_.:-]*)([^>]*)>|([^<]+)/gi;
  let match;
  while ((match = tokens.exec(xml))) {
    if (match[0].startsWith('<!--') || match[0].startsWith('<?') || /^<!DOCTYPE/i.test(match[0])) continue;
    if (match[0].startsWith('<![CDATA[')) { stack.at(-1).text += match[0].slice(9, -3); continue; }
    if (match[1]) {
      const closing = normalizeName(match[1]);
      const index = [...stack].reverse().findIndex(node => normalizeName(node.name) === closing);
      if (index < 0) throw new TypeError('Flex XML contains an invalid closing tag');
      stack.splice(stack.length - index - 1);
      continue;
    }
    if (match[2]) {
      const node = { name: match[2], attrs: parseAttributes(match[3] || ''), children: [], text: '' };
      stack.at(-1).children.push(node);
      const selfClosing = /\/\s*$/.test(match[3] || '');
      if (!selfClosing) stack.push(node);
      continue;
    }
    if (match[4]) stack.at(-1).text += decodeXml(match[4]);
  }
  if (stack.length !== 1) throw new TypeError('Flex XML is incomplete');
  return root;
}

function findAll(node, predicate, output = []) {
  if (predicate(node)) output.push(node);
  for (const child of node.children || []) findAll(child, predicate, output);
  return output;
}

function nodeText(node) {
  return [node.text || '', ...(node.children || []).map(nodeText)].join(' ').trim();
}

function flattenNode(node) {
  const values = Object.create(null);
  for (const [key, value] of Object.entries(node.attrs || {})) values[normalizeName(key)] = String(value).trim();
  for (const child of node.children || []) {
    if (!child.children.length) values[normalizeName(child.name)] = nodeText(child);
  }
  return values;
}

function pick(values, aliases) {
  for (const alias of aliases) {
    const value = values[normalizeName(alias)];
    if (value !== undefined && value !== '') return value;
  }
  return null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().replace(/,/g, '').replace(/^\((.*)\)$/, '-$1');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function dateOrNull(value) {
  const match = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/.exec(String(value || '').trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function canonicalRecord(node, kind, context) {
  const values = flattenNode(node);
  const result = { section: node.name, kind, accountId: context.accountId || pick(values, REQUIRED_FIELD_ALIASES.accountId) };
  const nodeKind = normalizeName(node.name);
  for (const [field, aliases] of Object.entries(REQUIRED_FIELD_ALIASES)) {
    if (field === 'accountId') continue;
    let raw = pick(values, aliases);
    if (raw === null && values.value !== undefined) {
      const valueNodes = {
        netLiquidation: ['netliquidation', 'netassetvalue', 'nav', 'endingnav'],
        totalCash: ['totalcash', 'cashbalance', 'cash'],
        grossPositionValue: ['grosspositionvalue', 'grossmarketvalue'],
        stockMarketValue: ['stockmarketvalue', 'stockvalue'],
        optionMarketValue: ['optionmarketvalue', 'optionvalue'],
        marketValue: ['marketvalue', 'positionvalue']
      };
      if (valueNodes[field]?.includes(nodeKind)) raw = values.value;
    }
    if (['date'].includes(field)) result[field] = dateOrNull(raw);
    else if (['occurredAt'].includes(field)) result[field] = raw || null;
    else if (['symbol', 'conid', 'securityType', 'currency', 'baseCurrency', 'type', 'side', 'description', 'sourceId'].includes(field)) result[field] = raw || null;
    else result[field] = numberOrNull(raw);
  }
  result.date = result.date || context.reportDate || null;
  result.baseCurrency = result.baseCurrency || context.baseCurrency || null;
  return result;
}

function hasCandidate(record, kind) {
  if (!record.date && kind !== 'snapshot') return false;
  if (kind === 'snapshot') return Number.isFinite(record.netLiquidation) || Number.isFinite(record.totalCash) || Number.isFinite(record.grossPositionValue) || Number.isFinite(record.marketValue);
  if (kind === 'trade') return Boolean(record.symbol || record.conid) && (Number.isFinite(record.quantity) || Number.isFinite(record.price) || record.side);
  if (kind === 'position') return Boolean(record.symbol || record.conid) && (Number.isFinite(record.quantity) || Number.isFinite(record.marketValue));
  if (kind === 'cashFlow' || kind === 'income') return Number.isFinite(record.amount) || Number.isFinite(record.baseAmount);
  if (kind === 'performance') return Number.isFinite(record.endNav) || Number.isFinite(record.netLiquidation) || Number.isFinite(record.realizedPnl) || Number.isFinite(record.dailyReturn);
  return false;
}

function addRecord(statement, record) {
  const kind = record.kind === 'transaction'
    ? (record.symbol || record.conid || record.quantity !== null ? 'trade' : 'cashFlow') : record.kind;
  record.kind = kind;
  if (!hasCandidate(record, kind)) return;
  if (kind === 'snapshot') statement.snapshots.push(record);
  else if (kind === 'cashFlow') statement.cashFlows.push(record);
  else if (kind === 'trade') statement.trades.push(record);
  else if (kind === 'position') statement.positions.push(record);
  else if (kind === 'income') statement.incomeEvents.push(record);
  else if (kind === 'performance') statement.reportedPerformance.push(record);
  statement.sections.add(record.section);
}

function walkStatement(node, statement, context, inheritedKind = null) {
  const name = normalizeName(node.name);
  const kind = SECTION_KINDS[name] || inheritedKind;
  const values = flattenNode(node);
  const nextContext = {
    accountId: context.accountId || pick(values, REQUIRED_FIELD_ALIASES.accountId),
    baseCurrency: context.baseCurrency || pick(values, REQUIRED_FIELD_ALIASES.baseCurrency),
    reportDate: context.reportDate || dateOrNull(pick(values, REQUIRED_FIELD_ALIASES.date))
  };
  if (kind) addRecord(statement, canonicalRecord(node, kind, nextContext));
  for (const child of node.children || []) walkStatement(child, statement, nextContext, kind);
}

function statementFromNode(node) {
  const values = flattenNode(node);
  const statement = {
    accountId: pick(values, REQUIRED_FIELD_ALIASES.accountId),
    baseCurrency: pick(values, REQUIRED_FIELD_ALIASES.baseCurrency) || pick(values, REQUIRED_FIELD_ALIASES.currency),
    reportDate: dateOrNull(pick(values, REQUIRED_FIELD_ALIASES.date)),
    snapshots: [], cashFlows: [], trades: [], positions: [], incomeEvents: [], reportedPerformance: [],
    sections: new Set(), warnings: [], unsupportedSections: []
  };
  walkStatement(node, statement, statement);
  statement.accountId ||= statement.snapshots.find(item => item.accountId)?.accountId
    || statement.cashFlows.find(item => item.accountId)?.accountId
    || statement.trades.find(item => item.accountId)?.accountId || null;
  statement.baseCurrency ||= statement.snapshots.find(item => item.baseCurrency)?.baseCurrency || null;
  statement.reportDate ||= [...statement.snapshots, ...statement.cashFlows, ...statement.trades, ...statement.positions, ...statement.incomeEvents, ...statement.reportedPerformance].map(item => item.date).filter(Boolean).sort().at(-1) || null;
  statement.sections = [...statement.sections];
  const present = new Set(statement.sections.map(normalizeName));
  for (const required of REQUIRED_SECTIONS) {
    if (!present.has(normalizeName(required)) && !(required === 'date' && statement.reportDate) && !(required === 'base_currency' && statement.baseCurrency) && !(required === 'net_asset_value' && statement.snapshots.some(item => Number.isFinite(item.netLiquidation)))) statement.unsupportedSections.push(required);
  }
  if (!statement.reportDate) statement.warnings.push('missing_report_date');
  if (!statement.baseCurrency) statement.warnings.push('missing_base_currency');
  return statement;
}

function normalizeFlexReport(xml) {
  const root = parseXml(xml);
  const status = (findAll(root, node => normalizeName(node.name) === 'status')[0] && nodeText(findAll(root, node => normalizeName(node.name) === 'status')[0]) || '').toLowerCase();
  const errorCode = nodeText(findAll(root, node => normalizeName(node.name) === 'errorcode')[0] || { text: '', children: [] }) || null;
  const errorMessage = nodeText(findAll(root, node => normalizeName(node.name) === 'errormessage')[0] || { text: '', children: [] }) || null;
  const referenceCode = nodeText(findAll(root, node => normalizeName(node.name) === 'referencecode')[0] || { text: '', children: [] }) || null;
  const responseUrl = nodeText(findAll(root, node => normalizeName(node.name) === 'responseurl')[0] || { text: '', children: [] }) || null;
  if (status === 'fail' || errorCode) {
    return { ok: false, errorCode, errorMessage: errorMessage || 'IBKR Flex request failed', errorCategory: ERROR_CATEGORIES[Number(errorCode)] || 'schema_error', referenceCode, responseUrl, rawXml: xml };
  }
  const statementNodes = findAll(root, node => normalizeName(node.name) === 'flexstatement');
  const statements = (statementNodes.length ? statementNodes : [root]).map(statementFromNode).filter(statement => statement.accountId || statement.snapshots.length || statement.trades.length || statement.positions.length || statement.cashFlows.length || statement.incomeEvents.length);
  if (!statements.length && referenceCode) return { ok: true, status: status || 'success', referenceCode, responseUrl, statements: [], rawXml: xml };
  if (!statements.length) return { ok: false, errorCode: null, errorMessage: 'Flex report contains no supported statements', errorCategory: 'schema_error', referenceCode, responseUrl, rawXml: xml };
  const reportDate = statements.map(item => item.reportDate).filter(Boolean).sort().at(-1) || null;
  return { ok: true, status: status || 'success', referenceCode, responseUrl, reportDate, statements, rawXml: xml };
}

function parseFlexError(xml) {
  const parsed = normalizeFlexReport(xml);
  return parsed.ok ? null : parsed;
}

module.exports = { ERROR_CATEGORIES, REQUIRED_SECTIONS, decodeXml, normalizeFlexReport, numberOrNull, parseFlexError, parseXml };
