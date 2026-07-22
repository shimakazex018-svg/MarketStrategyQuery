'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { createHttpServer } = require('../server');

test('full-history API returns every validated point without the 240-point chart sample', async t => {
  const history = Array.from({ length: 500 }, (_, index) => ({
    date: new Date(Date.UTC(2097, 0, 1 + index)).toISOString().slice(0, 10),
    value: 100 + index
  }));
  const service = {
    getIndicatorHistory(id, range) {
      return id === 'nasdaq100_index'
        ? { metricId: id, range, history, historyStart: history[0].date, historyEnd: history.at(-1).date }
        : null;
    },
    getIndicator: () => null,
    getStatus: () => ({ ok: true })
  };
  const server = createHttpServer(service);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/market-data/metrics/nasdaq100_index/history?range=ALL`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.range, 'ALL');
  assert.equal(payload.history.length, 500);
});

test('drawdown page registers route, navigation, controls, states and responsive content contracts', async () => {
  const root = path.join(__dirname, '..');
  const [html, app, css] = await Promise.all([
    fs.readFile(path.join(root, 'public', 'index.html'), 'utf8'),
    fs.readFile(path.join(root, 'public', 'app.js'), 'utf8'),
    fs.readFile(path.join(root, 'public', 'styles.css'), 'utf8')
  ]);
  assert.equal((html.match(/#\/drawdown-analysis/g) || []).length, 2);
  for (const contract of [
    '/drawdown-analysis', 'Nasdaq-100指数', 'S&P 500指数', '近1年', '近3年', '近5年', '近10年',
    '近15年', '近20年', '全历史', '暂时无法读取该对象的历史数据。',
    '当前区间内有效数据不足，无法计算回撤。', '对比对象在当前区间内缺少足够数据。'
  ]) assert.match(app, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const contract of ['SOXX半导体ETF', 'iShares Semiconductor ETF（SOXX）', 'SOXX NAV', '不是PHLX Semiconductor Sector Index（SOX）']) {
    assert.match(app, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const selector of ['drawdown-control-grid', 'drawdown-summary-grid', 'drawdown-chart-stack', 'drawdown-event-list', 'annual-return-grid']) {
    assert.match(css, new RegExp(`\\.${selector}`));
  }
});
