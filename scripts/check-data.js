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

const stages = readJson('public/data/stages.json');
const options = readJson('public/data/options.json');
const indicators = readJson('public/data/indicators.json');
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
assertExactList(stages.map(stage => stage.id), stages.map(stage => stage.id), '阶段ID');
assertExactList(options.map(option => option.id), options.map(option => option.id), '期权ID');
assert(stages.every((stage, index) => stage.order === index + 1), '市场阶段order必须从1到9连续排列');

const knownOptions = new Set(optionNames);
stages.forEach(stage => {
  assertExactList(stage.allocations.map(item => item.ticker), allocationTickers, `${stage.name}仓位标的`);
  stage.options.forEach(item => assert(knownOptions.has(item.name), `${stage.name}引用了不存在的期权策略：${item.name}`));
});

rangeLabels.forEach(label => assert(appSource.includes(`'${label}'`), `前端时间范围缺少：${label}`));
rangeKeys.forEach(key => assert(appSource.includes(`'${key}'`), `前端时间范围键缺少：${key}`));

console.log('Data check passed: 9 stages, 8 options, 6 indicators, 7 ranges, and all references are valid.');
