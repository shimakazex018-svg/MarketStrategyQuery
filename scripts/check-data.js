'use strict';

const fs = require('fs');
const path = require('path');

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
const appSource = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');

const stageNames = ['高位震荡', '震荡下跌', '单边下跌', '恐慌暴跌', '底部震荡', '右侧反转', '单边上涨', '震荡上涨', '加速上涨／过热'];
const optionNames = ['Protective Put', 'Collar', 'Put Debit Spread', 'Put Credit Spread', 'Covered Call', 'Cash-Secured Put', 'Call Debit Spread', 'Long Call'];
const indicatorNames = ['PE', '前瞻PE', 'VIX', 'VXN', '恐慌贪婪指数', '基金经理仓位指数'];
const allocationTickers = ['QQQ', 'SOXX', 'SOXL', '现金/SGOV'];
const rangeLabels = ['1个月', '3个月', '6个月', '1年', '3年', '5年', '10年'];
const rangeKeys = ['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y'];

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

rangeLabels.forEach(label => assert(appSource.includes(`'${label}'`), `前端时间范围缺少：${label}`));
rangeKeys.forEach(key => assert(appSource.includes(`'${key}'`), `前端时间范围键缺少：${key}`));

console.log('Data check passed: 9 complete stages, 8 complete options, 6 indicators, 7 ranges, and all references are valid.');
