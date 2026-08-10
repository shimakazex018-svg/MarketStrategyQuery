'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { findSensitiveText } = require('../scripts/visual-review/privacy');

const root = path.join(__dirname, '..');
const current = path.join(root, 'previews', 'current');

test('visual privacy scanner detects private paths, private IPs and credential terms without treating market 10.x text as an IP', () => {
  const windowsUserPath = ['C:', 'Users', 'person'].join('\\');
  const drivePath = ['D:', 'project'].join('\\');
  const private192 = ['192', '168', '1', '8'].join('.');
  const private10 = ['10', '0', '0', '8'].join('.');
  const private172 = ['172', '20', '0', '8'].join('.');
  for (const value of [windowsUserPath, drivePath, private192, private10, private172, 'ZeroTier', 'api_key', 'bearer token', 'PID 99']) assert.notEqual(findSensitiveText(value).length, 0);
  assert.deepEqual(findSensitiveText('10.5 percent drawdown'), []);
});

test('current visual review has its bounded WebP set and a relative-link manifest', async () => {
  const required = ['manifest.md', 'contact-sheet.webp', 'desktop.webp', 'ipad.webp', 'iphone.webp', 'indicator-pe-desktop.webp', 'iphone-dialog-scroll.webp', 'home-desktop.webp', 'settings-desktop.webp', 'portfolio-desktop.webp', 'portfolio-ipad.webp', 'portfolio-iphone.webp', 'portfolio-calendar.webp', 'portfolio-performance.webp'];
  const files = await fs.readdir(current); for (const file of required) assert.equal(files.includes(file), true, `${file} missing`);
  assert.equal(files.filter(file => file.endsWith('.webp')).length <= 14, true);
  const manifest = await fs.readFile(path.join(current, 'manifest.md'), 'utf8');
  assert.match(manifest, /portfolioDataMode: synthetic-review-fixture/i); assert.match(manifest, /containsRealAccountData: false/i); assert.match(manifest, /repositoryVisibility: public/i); assert.match(manifest, /\[portfolio-desktop\.webp\]\(portfolio-desktop\.webp\)/); assert.match(manifest, /Route changed: false/); assert.match(manifest, /Scroll position preserved: true/);
  assert.equal(findSensitiveText(manifest).length, 0);
  for (const file of required.filter(file => file.endsWith('.webp'))) assert.equal((await fs.stat(path.join(current, file))).size < 3 * 1024 * 1024, true);
});

test('visual capture scripts retain fixed viewport, WebP, privacy, and local-only contracts', async () => {
  const capture = await fs.readFile(path.join(root, 'scripts', 'visual-review', 'capture-current.js'), 'utf8');
  assert.match(capture, /127\.0\.0\.1:48101/); assert.match(capture, /type: 'webp'/); assert.match(capture, /1440, height: 900/); assert.match(capture, /768, height: 1024/); assert.match(capture, /390, height: 844/); assert.match(capture, /assertPrivateText/); assert.match(capture, /External browser requests are forbidden/);
});

test('settings review defaults recent acquisition records to ten with an expand control', async () => {
  const app = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(app, /rows\.slice\(10\)/); assert.match(app, /展开全部/); assert.match(app, /收起/); assert.match(app, /settingsCodeLabel/);
});
