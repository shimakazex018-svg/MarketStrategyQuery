'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const interactions = require('../public/drawdown-chart-interactions.js');

const irregularPoints = [
  { date: '2024-01-02', value: 100 },
  { date: '2024-01-05', value: 101 },
  { date: '2024-01-12', value: null },
  { date: '2024-01-18', value: 103 },
  { date: '2024-01-31', value: 104 }
];

test('日期游标只吸附到有效真实交易日，并在中点稳定选择较晚日期', () => {
  assert.equal(interactions.findNearestDataPointByDate(irregularPoints, '2024-01-03').date, '2024-01-02');
  assert.equal(interactions.findNearestDataPointByDate(irregularPoints, '2024-01-10').date, '2024-01-05');
  assert.equal(interactions.findNearestDataPointByDate(irregularPoints, '2024-01-24').date, '2024-01-18');
  assert.equal(interactions.findNearestDataPointByDate(irregularPoints, '2024-01-25').date, '2024-01-31');
});

test('日期游标在图表边界夹紧，不会创建范围外日期', () => {
  assert.equal(interactions.findNearestDataPointByDate(irregularPoints, '2023-12-01').date, '2024-01-02');
  assert.equal(interactions.findNearestDataPointByDate(irregularPoints, '2024-02-01').date, '2024-01-31');
  assert.equal(interactions.mapClientXToDate(-20, { left: 100, width: 400 }, '2024-01-02', '2024-01-31'), '2024-01-02');
  assert.equal(interactions.mapClientXToDate(800, { left: 100, width: 400 }, '2024-01-02', '2024-01-31'), '2024-01-31');
});

test('鼠标坐标按真实日期范围映射，并在缩放后的画布中保持日期一致', () => {
  const start = '2024-01-02';
  const end = '2024-01-31';
  const wide = interactions.findNearestDataPointByX(irregularPoints, 300, { left: 100, width: 400 }, start, end);
  const narrow = interactions.findNearestDataPointByX(irregularPoints, 200, { left: 100, width: 200 }, start, end);
  assert.equal(wide.date, narrow.date);
  assert.equal(interactions.mapDateToX(start, start, end), 18);
  assert.equal(interactions.mapDateToX(end, start, end), 982);
  assert.equal(interactions.pointerPositionInViewBox(300, { left: 100, width: 400 }), 500);
});

test('空值、无效日期和无可用点不会被用作游标数据', () => {
  assert.deepEqual(interactions.validPoints(irregularPoints).map(point => point.date), ['2024-01-02', '2024-01-05', '2024-01-18', '2024-01-31']);
  assert.equal(interactions.findNearestDataPointByDate([], '2024-01-02'), null);
  assert.equal(interactions.findNearestDataPointByDate([{ date: 'invalid', value: 1 }], '2024-01-02'), null);
  assert.equal(interactions.mapClientXToDate(200, { left: 0, width: 100 }, 'invalid', '2024-01-31'), null);
});
