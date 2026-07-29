'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('dashboard owns the six indicator explanations and removes the legacy navigation route', async () => {
  const [app, html] = await Promise.all([
    fs.readFile(path.join(root, 'public', 'app.js'), 'utf8'),
    fs.readFile(path.join(root, 'public', 'index.html'), 'utf8')
  ]);
  assert.doesNotMatch(html, /href="#\/indicators"/);
  assert.match(app, /function indicatorInfoMeta\(/);
  assert.match(app, /history\.replaceState\(null, '', `\$\{location\.pathname\}\$\{location\.search\}#\/`\)/);
  assert.doesNotMatch(app, /else if \(route === '\/indicators'\)/);
  assert.doesNotMatch(app, /else if \(route\.startsWith\('\/indicators\/'\)\)/);
  assert.doesNotMatch(app, /function indicatorsTemplate\(/);
  assert.doesNotMatch(app, /function metricDetailTemplate\(/);
});

test('each dashboard card uses a real accessible dialog button without hash navigation', async () => {
  const app = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(app, /<button class="metric-info-button" type="button"/);
  assert.match(app, /aria-haspopup="dialog" aria-expanded="false" aria-controls="indicatorDialog"/);
  assert.match(app, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*void requestIndicatorDialog\(button\)/);
  assert.doesNotMatch(app, /href="#\/indicators\/\$\{escapeHtml\(indicator\.id\)\}"/);
});

test('indicator dialog uses a body portal, FLIP geometry, focus handling and scroll restoration', async () => {
  const [app, css] = await Promise.all([
    fs.readFile(path.join(root, 'public', 'app.js'), 'utf8'),
    fs.readFile(path.join(root, 'public', 'styles.css'), 'utf8')
  ]);
  assert.match(app, /portal\.id = 'indicator-dialog-portal'/);
  assert.match(app, /getBoundingClientRect\(\)/);
  assert.match(app, /scaleX.*triggerRect\.width/);
  assert.match(app, /document\.body\.append\(portal\)/);
  assert.match(app, /window\.scrollTo\(\{ top: indicatorDialogState\.scrollY/);
  assert.match(app, /document\.addEventListener\('keydown', keydown\)/);
  assert.match(app, /trigger\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(css, /#indicator-dialog-portal/);
  assert.match(css, /body\.dialog-open \{ position: fixed/);
});

test('dialog content is derived from loaded indicator metadata and never fetches provider data', async () => {
  const app = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  const start = app.indexOf('function createIndicatorDialog');
  const end = app.indexOf('function bindCommonEvents');
  const dialogSource = app.slice(start, end);
  assert.match(dialogSource, /state\.marketData\[indicator\.id\]/);
  assert.doesNotMatch(dialogSource, /fetch\(/);
  assert.match(dialogSource, /指标意义/);
  assert.match(dialogSource, /数据来源与口径/);
  assert.match(dialogSource, /使用限制/);
});
