'use strict';

const fs = require('fs');
const path = require('path');
const { loadProviderRegistry } = require('../server/market-data/provider-compliance');

const ROOT = path.join(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactList(actual, expected, label) {
  assert(actual.length === expected.length, `${label}数量应为${expected.length}，实际为${actual.length}`);
  assert(new Set(actual).size === actual.length, `${label}存在重复项`);
  expected.forEach(item => assert(actual.includes(item), `${label}缺少：${item}`));
}

function assertText(value, label) {
  assert(typeof value === 'string' && value.trim(), `${label}必须是非空文本`);
}

function assertTextArray(value, label) {
  assert(Array.isArray(value) && value.length, `${label}必须是非空数组`);
  value.forEach((item, index) => assertText(item, `${label}[${index}]`));
}

const stages = readJson('public/data/stages.json');
const options = readJson('public/data/options.json');
const indicators = readJson('public/data/indicators.json');
const cycleShape = readJson('public/data/cycle-shape.json');
const indicatorCatalog = readJson('config/indicator-catalog.json');
const signalRules = readJson('config/market-signal-rules.json');
const appSource = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const providerRegistry = loadProviderRegistry(ROOT);

const stageNames = ['高位震荡', '震荡下跌', '单边下跌', '恐慌暴跌', '底部震荡', '右侧反转', '单边上涨', '震荡上涨', '加速上涨／过热'];
const optionNames = ['Protective Put', 'Collar', 'Put Debit Spread', 'Put Credit Spread', 'Covered Call', 'Cash-Secured Put', 'Call Debit Spread', 'Long Call'];
const indicatorNames = ['Nasdaq-100 PE', 'S&P 500 PE', 'VIX恐慌指数', 'VXN纳斯达克波动率指数', 'Nasdaq-100指数', 'S&P 500指数'];
const allocationTickers = ['QQQ', 'SOXX', 'SOXL', '现金/SGOV'];
const rangeLabels = ['1个月', '3个月', '6个月', '1年', '3年', '5年', '10年'];
const rangeKeys = ['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y'];

assert(appSource.includes('function hasFiniteValue(value)'), '前端必须区分null空值与数值0');
assert(!appSource.includes('Number.isFinite(Number(market.secondaryValue))'), 'PE副值不得把null格式化为0');

assertExactList(stages.map(stage => stage.name), stageNames, '市场阶段');
assertExactList(options.map(option => option.english), optionNames, '期权策略');
assertExactList(indicators.map(indicator => indicator.name), indicatorNames, '指标');
assert(new Set(stages.map(stage => stage.id)).size === stages.length, '阶段ID存在重复项');
assert(new Set(options.map(option => option.id)).size === options.length, '期权ID存在重复项');
assert(stages.every((stage, index) => stage.order === index + 1), '市场阶段order必须从1到9连续排列');
assertText(cycleShape.label, 'cycleShape.label');
assertText(cycleShape.disclaimer, 'cycleShape.disclaimer');
assertExactList(cycleShape.stages.map(stage => stage.id), stages.map(stage => stage.id), '周期图阶段');
cycleShape.stages.forEach(stage => {
  assertText(stage.summary, `cycleShape.${stage.id}.summary`);
  assert(Array.isArray(stage.points) && stage.points.length >= 2, `cycleShape.${stage.id}.points至少需要两个数据点`);
  stage.points.forEach((value, index) => assert(Number.isFinite(value) && value >= 0 && value <= 100, `cycleShape.${stage.id}.points[${index}]必须在0至100之间`));
});

const knownOptions = new Set(optionNames);
const knownStageIds = new Set(stages.map(stage => stage.id));
const knownStageNames = new Set(stageNames);
const guidanceLevels = ['recommended', 'optional', 'cautious', 'avoid'];
const stageTextFields = ['summary', 'marketDefinition', 'direction', 'risk', 'strategyProfile', 'worstCase', 'invalidation', 'opportunityCost', 'riskNotice'];
stages.forEach(stage => {
  stageTextFields.forEach(field => assertText(stage[field], `${stage.name}.${field}`));
  assertTextArray(stage.conditions, `${stage.name}.conditions`);
  assertExactList(stage.allocations.map(item => item.ticker), allocationTickers, `${stage.name}仓位标的`);
  stage.allocations.forEach(item => ['range', 'role'].forEach(field => assertText(item[field], `${stage.name}.${item.ticker}.${field}`)));
  allocationTickers.forEach(ticker => {
    const rule = stage.assetRules?.[ticker];
    assert(rule, `${stage.name}.assetRules缺少${ticker}`);
    ['increaseWhen', 'reduceWhen', 'avoidWhen', 'risk'].forEach(field => assertText(rule[field], `${stage.name}.${ticker}.${field}`));
  });
  ['previous', 'next'].forEach(position => {
    const adjacent = stage.adjacentStages?.[position];
    assert(adjacent && knownStageIds.has(adjacent.id), `${stage.name}.${position}引用了不存在的阶段ID`);
    assertText(adjacent.difference, `${stage.name}.${position}.difference`);
  });
  const classifiedOptions = guidanceLevels.flatMap(level => {
    assertTextArray(stage.optionGuidance?.[level], `${stage.name}.optionGuidance.${level}`);
    return stage.optionGuidance[level];
  });
  assertExactList(classifiedOptions, optionNames, `${stage.name}期权分级`);
  assertText(stage.optionGuidance.note, `${stage.name}.optionGuidance.note`);
  ['initial', 'worsening', 'unchanged', 'improving'].forEach(key => assertTextArray(stage.actionPlan?.[key], `${stage.name}.actionPlan.${key}`));
  ['transitionConditions', 'returnSources', 'lossSources'].forEach(field => assertTextArray(stage[field], `${stage.name}.${field}`));
  stage.options.forEach(item => assert(knownOptions.has(item.name), `${stage.name}引用了不存在的期权策略：${item.name}`));
});

const optionTextFields = ['name', 'english', 'category', 'purpose', 'bias', 'structure', 'cashflow', 'maxGain', 'maxLoss', 'breakeven', 'dteLogic', 'strikeLogic', 'thetaImpact', 'ivImpact', 'earlyExit', 'expiration', 'risk', 'opportunityCost'];
options.forEach(option => {
  optionTextFields.forEach(field => assertText(option[field], `${option.english}.${field}`));
  assert(['保护', '进攻', '收益增强'].includes(option.category), `${option.english}.category无效`);
  ['buyLegs', 'sellLegs'].forEach(field => assert(Array.isArray(option[field]), `${option.english}.${field}必须是数组`));
  assertTextArray(option.underlyings, `${option.english}.underlyings`);
  assertTextArray(option.idealStages, `${option.english}.idealStages`);
  option.idealStages.forEach(name => assert(knownStageNames.has(name), `${option.english}引用了不存在的适用阶段：${name}`));
  assertTextArray(option.unsuitableStages, `${option.english}.unsuitableStages`);
  ['up', 'sideways', 'down'].forEach(key => assertText(option.performance?.[key], `${option.english}.performance.${key}`));
  assert(Array.isArray(option.variables) && option.variables.length, `${option.english}.variables必须是非空数组`);
  option.variables.forEach((variable, index) => ['symbol', 'meaning'].forEach(field => assertText(variable[field], `${option.english}.variables[${index}].${field}`)));
  ['scenario', 'calculation', 'conclusion'].forEach(field => assertText(option.formulaExample?.[field], `${option.english}.formulaExample.${field}`));
});

indicators.forEach(indicator => {
  ['definition', 'interpretation', 'marketRelation', 'limitations'].forEach(field => assertText(indicator[field], `${indicator.name}.${field}`));
  assert(['derived', 'manual', 'official', 'demo', 'unavailable'].includes(indicator.dataMode), `${indicator.name}.dataMode无效`);
  if (indicator.dataMode === 'demo') {
    assertText(indicator.demoSource, `${indicator.name}.demoSource`);
    assertText(indicator.demoMessage, `${indicator.name}.demoMessage`);
  } else assertText(indicator.unavailableMessage, `${indicator.name}.unavailableMessage`);
});

rangeLabels.forEach(label => assert(appSource.includes(`'${label}'`), `前端时间范围缺少：${label}`));
rangeKeys.forEach(key => assert(appSource.includes(`'${key}'`), `前端时间范围键缺少：${key}`));
assertExactList(providerRegistry.providers.map(provider => provider.providerId), ['sec-edgar', 'cftc', 'cboe', 'ibkr', 'twelve-data', 'alpha-vantage', 'ishares-soxx', 'worldperatio'], 'Provider登记');
providerRegistry.providers.forEach(provider => {
  const selected = ['sec-edgar', 'cftc', 'ishares-soxx', 'worldperatio'].includes(provider.providerId);
  assert(provider.enabled === selected, `${provider.providerId}启用状态与合规选择不一致`);
});

assert(indicatorCatalog.schemaVersion === 1, 'indicator catalog schemaVersion must be 1');
assert(Array.isArray(indicatorCatalog.entries) && indicatorCatalog.entries.length >= 40, 'indicator catalog must contain the audited indicator set');
const catalogIds = new Set();
const catalogCategories = new Set(['valuation', 'trend_momentum', 'fear_positioning', 'macro_credit', 'semiconductor']);
const catalogDisplayStatuses = new Set(['core_ui', 'existing_ui', 'catalog_only_without_input', 'visible_when_local_ohlcv_available', 'catalog_only_when_self_calculated_inputs_available', 'not_displayed', 'link_only', 'external_reference_only']);
const catalogRequired = ['id', 'displayName', 'aliases', 'category', 'implementationStatus', 'displayStatus', 'acquisitionMode', 'rawInputs', 'provider', 'source', 'frequency', 'formulaVersion', 'licenseComplianceStatus', 'historyCapability', 'uiGroup', 'limitations'];
indicatorCatalog.entries.forEach(entry => {
  catalogRequired.forEach(field => assert(Object.hasOwn(entry, field), `indicator catalog entry ${entry.id || 'unknown'} is missing ${field}`));
  assert(!catalogIds.has(entry.id), `indicator catalog contains duplicate id ${entry.id}`);
  catalogIds.add(entry.id);
  assert(/^[a-z0-9_-]+$/.test(entry.id), `indicator catalog id is invalid: ${entry.id}`);
  assertText(entry.displayName, `${entry.id}.displayName`);
  assertTextArray(entry.aliases, `${entry.id}.aliases`);
  assert(catalogCategories.has(entry.category) && catalogCategories.has(entry.uiGroup), `${entry.id} has an invalid category or uiGroup`);
  assertTextArray(entry.rawInputs, `${entry.id}.rawInputs`);
  assertText(entry.provider, `${entry.id}.provider`);
  assertText(entry.source, `${entry.id}.source`);
  assertText(entry.frequency, `${entry.id}.frequency`);
  assert(catalogDisplayStatuses.has(entry.displayStatus), `${entry.id} has an invalid displayStatus`);
  assert(entry.formulaVersion === null || typeof entry.formulaVersion === 'string', `${entry.id}.formulaVersion must be text or null`);
  assertText(entry.licenseComplianceStatus, `${entry.id}.licenseComplianceStatus`);
  assertText(entry.historyCapability, `${entry.id}.historyCapability`);
  assertTextArray(entry.limitations, `${entry.id}.limitations`);
  assert(Array.isArray(entry.referenceUrls), `${entry.id}.referenceUrls must be an array`);
  assert(entry.referenceUrls.every(url => typeof url === 'string' && /^https:\/\//.test(url)), `${entry.id}.referenceUrls must contain https URLs`);
  if (entry.displayStatus === 'link_only') {
    assert(entry.implementationStatus === 'external_blocked', `${entry.id} link_only entries must be blocked external references`);
    assert(entry.referenceUrls.length > 0, `${entry.id} link_only entries must have at least one reference URL`);
  }
  if (entry.displayStatus === 'external_reference_only') {
    assert(entry.implementationStatus === 'external_blocked', `${entry.id} external_reference_only entries must be blocked external references`);
    assert(entry.referenceUrls.length === 0, `${entry.id} external_reference_only entries cannot claim a clickable URL`);
  }
});
['nasdaq100_pe', 'sp500_pe', 'vix', 'vxn', 'nasdaq100_index', 'sp500_index', 'naaim_exposure', 'drawdown-analysis', 'qqq-vs-ma200', 'qqq-momentum-20', 'qqq-momentum-120', 'qqq-52w-high-distance', 'qqq-52w-max-drawdown', 'soxx-relative-qqq', 'qqq-rv20', 'qqq-rv20-percentile', 'nasdaq-cot-positioning', 'risk-appetite', 'qqq-ema-5', 'qqq-ema-20', 'qqq-ema-60', 'qqq-ema-200', 'qqq-rsi', 'qqq-macd', 'qqq-macd-histogram', 'qqq-volume-relative', 'qqq-return-25', 'follow-through-day', 'top-risk-rsi', 'top-risk-volume', 'top-risk-macd', 'bottom-candidate-rsi', 'bottom-candidate-volume'].forEach(id => assert(catalogIds.has(id), `indicator catalog is missing audited id ${id}`));
assert(signalRules.schemaVersion === 1 && signalRules.status === 'provisional' && signalRules.ownership === 'owner-defined', 'market signal rules must remain explicitly provisional and owner-defined');
assert(signalRules.rsi.period === 14 && signalRules.macd.fastPeriod === 12 && signalRules.macd.slowPeriod === 26 && signalRules.macd.signalPeriod === 9, 'technical indicator periods must be explicit');
console.log(`Data check passed: 9 complete stages, 8 complete options, 6 core indicators, ${indicatorCatalog.entries.length} catalog entries, 7 ranges, and all references are valid.`);
