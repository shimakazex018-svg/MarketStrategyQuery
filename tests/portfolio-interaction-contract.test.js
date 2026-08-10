'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('portfolio authentication state machine stops unauthenticated auto-retries', async () => {
  const app = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  for (const state of ['unknown', 'checking', 'unauthenticated', 'authenticating', 'authenticated', 'error']) assert.match(app, new RegExp(`authState(?:\\s*[:=]|\\s*===)\\s*'${state}'`));
  assert.match(app, /state\.portfolio\.authState === 'unauthenticated' && !forceStatus/);
  assert.match(app, /portfolioAuthNeedsInitialLoad/);
  assert.match(app, /keepStableLogin/);
  assert.match(app, /requestGeneration === portfolioRequestGeneration/);
});

test('real interaction smoke is isolated from production and uses synthetic auth', async () => {
  const script = await fs.readFile(path.join(root, 'scripts', 'interaction-review', 'test-current.js'), 'utf8');
  assert.match(script, /startReviewServer\(\{ port: 0, authPassword: syntheticPassword \}\)/);
  assert.match(script, /mode: 'synthetic-review-fixture'/);
  assert.match(script, /productionPortUsed: false/);
  assert.match(script, /second < 30/);
  assert.match(script, /hasTouch: true/);
});
