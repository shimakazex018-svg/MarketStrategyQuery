'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createHttpServer } = require('../server');
const { loadPortfolioConfig } = require('../server/portfolio/config');
const { normalizeFlexReport } = require('../server/portfolio/flex-parser');
const { PortfolioService } = require('../server/portfolio/service');
const { writePasswordFile } = require('../server/portfolio/auth');
const { inspectContent } = require('../scripts/privacy/check-public-repo');

const rootDir = path.join(__dirname, '..');

function testConfig(runtimeRoot) {
  return {
    ...loadPortfolioConfig(rootDir),
    runtimeRoot,
    databasePath: ':memory:',
    rawFlexDir: path.join(runtimeRoot, 'raw-flex'),
    importsDir: path.join(runtimeRoot, 'imports'),
    backupsDir: path.join(runtimeRoot, 'backups'),
    auditDir: path.join(runtimeRoot, 'audit'),
    stateDir: path.join(runtimeRoot, 'state'),
    logsDir: path.join(runtimeRoot, 'logs'),
    secretsDir: path.join(runtimeRoot, 'secrets'),
    passwordPath: path.join(runtimeRoot, 'secrets', 'password.json'),
    flexSecretPath: path.join(runtimeRoot, 'secrets', 'ibkr-flex.json'),
    preserveRawFlex: false,
    flexPollAttempts: 0,
    flexPollDelayMs: 1
  };
}

const flexXml = `<FlexQueryResponse><FlexStatements><FlexStatement accountId="SIM000001" baseCurrency="USD" date="2026-08-07"><AccountInformation><NetLiquidation value="100000" date="2026-08-07"/><CashBalance value="22000" date="2026-08-07"/></AccountInformation><CashTransactions><CashTransaction transactionId="FLOW-1" date="2026-08-07" type="Deposit" amount="1000" currency="USD"/></CashTransactions></FlexStatement></FlexStatements></FlexQueryResponse>`;

test('public privacy scanner detects quoted JSON Flex secrets while accepting placeholders', () => {
  assert.deepEqual(inspectContent('config/fixture.json', '{"token":"<IBKR_FLEX_TOKEN>","queryId":"<IBKR_FLEX_QUERY_ID>"}'), []);
  const unsafeJson = `{"${'token'}":"${['opaque', 'value'].join('-')}","${'queryId'}":"${['123', '456'].join('-')}"}`;
  assert.deepEqual(inspectContent('config/fixture.json', unsafeJson), ['flex-token', 'flex-query-id']);
});

test('Flex field adapter preserves missing values instead of converting them to zero', () => {
  const report = normalizeFlexReport(flexXml);
  assert.equal(report.ok, true);
  const snapshot = report.statements[0].snapshots;
  assert.equal(snapshot.find(row => row.netLiquidation === 100000)?.netLiquidation, 100000);
  assert.equal(snapshot.find(row => row.totalCash === 22000)?.netLiquidation, null);
});

test('local import is idempotent and keeps NAV/cash semantics', async t => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'portfolio-import-test-'));
  t.after(() => fs.rm(runtimeRoot, { recursive: true, force: true }));
  const service = await new PortfolioService({ rootDir, config: testConfig(runtimeRoot), now: () => new Date('2026-08-08T00:00:00Z') }).init();
  t.after(() => service.close());
  const report = normalizeFlexReport(flexXml);
  service.importReport(report);
  service.importReport(report);
  const snapshot = service.db.prepare('SELECT net_liquidation,total_cash,gross_position_value FROM account_daily_snapshots').get();
  assert.deepEqual({ ...snapshot }, { net_liquidation: 100000, total_cash: 22000, gross_position_value: null });
  assert.equal(service.databaseCounts().snapshots, 1);
  assert.equal(service.databaseCounts().cashFlows, 1);
  assert.equal(service.getSummary('ALL').summary.currentNav, 100000);
});

test('synthetic review fixture is local-only and exposes required analysis sections', async t => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'portfolio-fixture-test-'));
  t.after(() => fs.rm(runtimeRoot, { recursive: true, force: true }));
  const service = await new PortfolioService({ rootDir, config: testConfig(runtimeRoot), fixtureMode: true, now: () => new Date('2026-08-09T00:00:00Z') }).init();
  t.after(() => service.close());
  const status = service.getStatus();
  assert.equal(status.dataMode, 'synthetic-review-fixture');
  assert.equal(status.accounts[0].label, 'SIM****0001');
  assert.equal(service.getPositions().positions.length, 3);
  assert.equal(service.getContributions('1Y').limitations.length > 0, true);
  const performance = service.getPerformance('1Y');
  assert.equal(performance.series.length > 200, true);
  assert.ok(Math.abs(performance.series[0].cumulativeReturn - performance.series[0].dailyReturn) < 1e-12);
  const sync = await service.sync();
  assert.equal(sync.result, 'synthetic-review-fixture');
  assert.equal(sync.externalRequestCount, 0);
});

test('portfolio API requires local session and exposes no trading method', async t => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'portfolio-api-test-'));
  t.after(() => fs.rm(runtimeRoot, { recursive: true, force: true }));
  const config = testConfig(runtimeRoot);
  await writePasswordFile(config.passwordPath, 'local-test-password-2026');
  const service = await new PortfolioService({ rootDir, config }).init();
  t.after(() => service.close());
  const server = createHttpServer(null, null, service, null);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const unauthorized = await fetch(`${base}/api/portfolio/summary`);
  assert.equal(unauthorized.status, 401);
  const login = await fetch(`${base}/api/portfolio/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'local-test-password-2026' }) });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.match(cookie, /^portfolio_session=/);
  const summary = await fetch(`${base}/api/portfolio/summary?range=ALL`, { headers: { Cookie: cookie } });
  assert.equal(summary.status, 200);
  assert.equal((await summary.json()).summary.accountCount, 0);
  const tradeRoute = await fetch(`${base}/api/portfolio/trade`, { headers: { Cookie: cookie } });
  assert.equal(tradeRoute.status, 404);
});
