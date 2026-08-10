'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const formatter = require('../public/portfolio-calendar');

const root = path.join(__dirname, '..');

test('portfolio calendar formats full signed USD amounts without scientific notation', () => {
  assert.equal(formatter.formatFullAmount(123.45), '+$123.45');
  assert.equal(formatter.formatFullAmount(-987.65), '-$987.65');
  assert.equal(formatter.formatFullAmount(12345.67), '+$12,345.67');
  assert.equal(formatter.formatFullAmount(-98765.43), '-$98,765.43');
  assert.equal(formatter.formatFullAmount(128532.41), '+$128,532.41');
  assert.equal(formatter.formatFullAmount(-1234567.89), '-$1,234,567.89');
  assert.equal(formatter.formatFullAmount(0), '$0.00');
});

test('portfolio calendar compact preview uses K and M only while keeping the sign', () => {
  assert.equal(formatter.formatCompactAmount(123.45), '+$123.45');
  assert.equal(formatter.formatCompactAmount(-987.65), '-$987.65');
  assert.equal(formatter.formatCompactAmount(12345.67), '+$12.3K');
  assert.equal(formatter.formatCompactAmount(-98765.43), '-$98.8K');
  assert.equal(formatter.formatCompactAmount(128532.41), '+$128.5K');
  assert.equal(formatter.formatCompactAmount(-1234567.89), '-$1.23M');
  assert.doesNotMatch(formatter.formatCompactAmount(1234567.89), /e[+-]?\d/i);
});

test('portfolio calendar tooltip formats date, return precision and quality labels', () => {
  assert.equal(formatter.formatDate('2026-08-10'), '2026年8月10日');
  assert.equal(formatter.formatReturn(0.012345), '+1.2345%');
  assert.equal(formatter.formatReturn(-0.010524), '-1.0524%');
  assert.equal(formatter.formatReturn(0), '0.0000%');
  assert.equal(formatter.formatReturn(0.000031), '+0.0031%');
  assert.equal(formatter.qualityLabel('computed'), 'Computed');
  assert.equal(formatter.qualityLabel('incomplete'), 'Incomplete');
});

test('calendar UI uses one shared popover and presentation-only formatting', async () => {
  const app = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  const css = await fs.readFile(path.join(root, 'public', 'styles.css'), 'utf8');
  const index = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(index, /styles\.css\?v=[0-9a-f]{7,40}/);
  assert.match(index, /portfolio-calendar\.js\?v=[0-9a-f]{7,40}/);
  assert.match(index, /app\.js\?v=[0-9a-f]{7,40}/);
  assert.match(app, /data-portfolio-calendar-popover/);
  assert.match(app, /data-calendar-full/);
  assert.match(app, /data-calendar-return/);
  assert.match(app, /formatCompactAmount/);
  assert.match(app, /portfolioCalendarCleanup/);
  assert.match(app, /positionTooltipAtPointer/);
  assert.match(app, /positionPopoverAtCell/);
  assert.match(app, /pointermove/);
  assert.match(app, /clientX/);
  assert.match(app, /clientY/);
  assert.match(app, /requestAnimationFrame/);
  assert.match(css, /\.portfolio-calendar-popover/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /font-variant-numeric: tabular-nums/);
});
