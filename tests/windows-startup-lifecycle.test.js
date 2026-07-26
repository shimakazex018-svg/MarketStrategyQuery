'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const windowsScripts = path.join(__dirname, '..', 'scripts', 'windows');
const read = name => fs.readFileSync(path.join(windowsScripts, name), 'utf8');

test('silent Windows task uses a hidden long-running PowerShell host with bounded restart', () => {
  const registration = read('register-market-autostart.ps1');
  const host = read('run-market-host.ps1');
  assert.match(registration, /MarketCycleStrategy-Autostart/);
  assert.match(registration, /-AtLogOn/);
  assert.match(registration, /-WindowStyle Hidden/);
  assert.match(registration, /-MultipleInstances IgnoreNew/);
  assert.match(registration, /-RestartCount 3/);
  assert.match(registration, /-RestartInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(host, /Start-Process[\s\S]*-WindowStyle Hidden/);
  assert.match(host, /\$process\.WaitForExit\(\)/);
});

test('market startup protects the port and writes ignored runtime state instead of a console-only lifecycle', () => {
  const common = read('market-runtime-common.ps1');
  const host = read('run-market-host.ps1');
  const stop = read('stop-market.ps1');
  assert.match(common, /Join-Path \$runtimeRoot "process\\market-cycle\.pid"/);
  assert.match(common, /Join-Path \$runtimeRoot "logs\\market-cycle"/);
  assert.match(common, /MaximumBytes = 10MB/);
  assert.match(common, /Test-MarketProcess/);
  assert.match(host, /port_occupied/);
  assert.match(host, /Test-MarketHealth/);
  assert.match(stop, /Refusing to stop/);
  assert.doesNotMatch(stop, /taskkill\s+\/F\s+\/IM\s+node\.exe/i);
});
