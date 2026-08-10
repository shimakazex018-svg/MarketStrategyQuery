'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createHttpServer } = require('../server');
const { loadPortfolioConfig } = require('../server/portfolio/config');
const { buildFlexCapabilityAudit, inspectFlexResponse, normalizeFlexReport, validateFlexCore } = require('../server/portfolio/flex-parser');
const { FLEX_USER_AGENT, FlexClient, isAllowedRedirect } = require('../server/portfolio/flex-client');
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
const syntheticOfficialCoreFlexXml = `<FlexQueryResponse><FlexStatements><FlexStatement fromDate="2025-01-01" toDate="2026-08-07"><AccountInformation accountId="SIM000001" currency="USD"/><EquitySummaryInBase><EquitySummaryByReportDateInBase accountId="SIM000001" currency="USD" reportDate="2026-08-07" total="100000" cash="22000"/></EquitySummaryInBase><CashTransactions><CashTransaction accountId="SIM000001" reportDate="2026-08-07" type="Deposit" amount="1000" currency="USD" transactionID="SYNTH-FLOW-1"/></CashTransactions></FlexStatement></FlexStatements></FlexQueryResponse>`;

function mockFlexResponse(body, status = 200, contentType = 'application/xml', extraHeaders = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ 'content-type': contentType, ...extraHeaders }),
    arrayBuffer: async () => Buffer.from(body, 'utf8')
  };
}

async function createMockFlexClient(t, responses, options = {}) {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'portfolio-flex-client-test-'));
  t.after(() => fs.rm(runtimeRoot, { recursive: true, force: true }));
  const secretPath = path.join(runtimeRoot, 'secrets', 'ibkr-flex.json');
  await fs.mkdir(path.dirname(secretPath), { recursive: true });
  await fs.writeFile(secretPath, '{"token":"<TEST_TOKEN>","queryId":"<TEST_QUERY_ID>"}\n', 'utf8');
  const calls = [];
  const config = {
    flexSecretPath: secretPath,
    flexEndpoint: 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService',
    flexTimeoutMs: 2_000,
    flexMaxReportBytes: 1_000_000,
    flexPollAttempts: 0,
    flexPollDelayMs: 1,
    ...options
  };
  const client = new FlexClient({
    rootDir,
    config,
    fetchImpl: async (url, requestOptions) => {
      calls.push({ url: String(url), requestOptions });
      return responses.shift();
    },
    sleepImpl: async () => {}
  });
  return { client, calls };
}

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

test('synthetic-review-fixture maps official core EquitySummary fields', () => {
  const report = normalizeFlexReport(syntheticOfficialCoreFlexXml);
  assert.equal(report.ok, true);
  assert.deepEqual(validateFlexCore(report), { ok: true, missing: [], warnings: ['income_missing', 'positions_missing', 'reported_performance_missing', 'trades_missing'] });
  assert.equal(report.statements[0].baseCurrency, 'USD');
  assert.equal(report.reportDate, '2026-08-07');
  assert.equal(report.statements[0].snapshots.length, 1);
  assert.equal(report.statements[0].snapshots[0].netLiquidation, 100000);
  assert.equal(report.statements[0].cashFlows.length, 1);
});

test('portfolio scheduler does not retry a failed attempt on the same local day', () => {
  const service = new PortfolioService({ rootDir, config: { timezone: 'Asia/Shanghai' } });
  service.state = { lastAttemptAt: '2026-08-10T02:00:00.000Z' };
  assert.equal(service.syncDue('2026-08-10'), false);
  assert.equal(service.syncDue('2026-08-11'), true);
});

test('Flex capability audit records names, counts and dates without values', () => {
  const audit = buildFlexCapabilityAudit(flexXml, { diagnostic: inspectFlexResponse(flexXml, { contentType: 'application/xml', status: 200 }) });
  const serialized = JSON.stringify(audit);
  assert.equal(audit.responseFormat, 'xml');
  assert.equal(audit.flexStatementCount, 1);
  assert.equal(audit.sections.some(section => section.section === 'AccountInformation'), true);
  assert.equal(audit.sections.some(section => section.section === 'CashTransactions'), true);
  assert.match(serialized, /NetLiquidation/);
  assert.doesNotMatch(serialized, /SIM000001|100000|22000|1000/);
});

test('Flex client uses the v3 request shape and dynamic Node User-Agent', async t => {
  const send = '<FlexStatementResponse><Status>Success</Status><ReferenceCode>1234567890</ReferenceCode></FlexStatementResponse>';
  const { client, calls } = await createMockFlexClient(t, [mockFlexResponse(send), mockFlexResponse(flexXml)]);
  const report = await client.fetchReport();
  assert.equal(report.externalRequestCount, 2);
  assert.equal(calls.length, 2);
  const sendUrl = new URL(calls[0].url);
  const statementUrl = new URL(calls[1].url);
  assert.equal(sendUrl.pathname, '/AccountManagement/FlexWebService/SendRequest');
  assert.equal(statementUrl.pathname, '/AccountManagement/FlexWebService/GetStatement');
  assert.equal(sendUrl.searchParams.get('v'), '3');
  assert.equal(statementUrl.searchParams.get('v'), '3');
  assert.equal(calls[0].requestOptions.headers['User-Agent'], FLEX_USER_AGENT);
  assert.equal(calls[0].requestOptions.redirect, 'manual');
  assert.equal(report.diagnostics.every(item => !JSON.stringify(item).includes('TEST_TOKEN')), true);
});

test('XML response with a comma in an attribute is not misclassified as CSV', () => {
  const diagnostic = inspectFlexResponse('<FlexStatementResponse queryName="NAV, Core"><Status>Success</Status></FlexStatementResponse>', {
    contentType: 'text/xml;charset=UTF-8',
    status: 200
  });
  assert.equal(diagnostic.responseFormat, 'xml');
  assert.equal(diagnostic.rootTag, 'FlexStatementResponse');
});

test('Flex client preserves an IBKR error code and response diagnostics', async t => {
  const failure = '<FlexStatementResponse><Status>Fail</Status><ErrorCode>1014</ErrorCode><ErrorMessage>Query is invalid.</ErrorMessage></FlexStatementResponse>';
  const { client } = await createMockFlexClient(t, [mockFlexResponse(failure)]);
  await assert.rejects(client.fetchReport(), error => {
    assert.equal(error.category, 'invalid_query');
    assert.equal(error.ibkrErrorCode, '1014');
    assert.equal(error.stage, 'parse_response');
    assert.equal(error.externalRequestCount, 1);
    assert.equal(error.diagnostics[0].responseFormat, 'xml');
    assert.equal(error.diagnostics[0].errorCode, '1014');
    assert.equal(error.diagnostics[0].errorMessageCategory, 'invalid_query');
    assert.doesNotMatch(JSON.stringify(error.diagnostics), /Query is invalid|TEST_TOKEN|TEST_QUERY_ID/);
    return true;
  });
});

test('Flex client classifies HTML and blocks non-IBKR redirects', async t => {
  const html = '<!doctype html><html><body>blocked</body></html>';
  const htmlClient = await createMockFlexClient(t, [mockFlexResponse(html, 200, 'text/html')]);
  await assert.rejects(htmlClient.client.fetchReport(), error => {
    assert.equal(error.category, 'unexpected_html_response');
    assert.equal(error.diagnostics[0].responseFormat, 'html');
    assert.equal(error.diagnostics[0].rootTag, 'html');
    return true;
  });
  assert.equal(isAllowedRedirect('https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement'), true);
  assert.equal(isAllowedRedirect('http://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement'), false);
  assert.equal(isAllowedRedirect('https://evil.example/AccountManagement/FlexWebService/GetStatement'), false);
  const redirectClient = await createMockFlexClient(t, [mockFlexResponse('', 302, 'text/html', { location: 'https://evil.example/redirect' })]);
  await assert.rejects(redirectClient.client.fetchReport(), error => {
    assert.equal(error.category, 'redirect_error');
    assert.equal(error.diagnostics[0].httpStatus, 302);
    assert.equal(error.diagnostics[0].redirectAllowed, false);
    return true;
  });
});

test('sync persists safe diagnostics and schema migration fields', async t => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'portfolio-sync-diagnostic-test-'));
  t.after(() => fs.rm(runtimeRoot, { recursive: true, force: true }));
  const config = testConfig(runtimeRoot);
  await fs.mkdir(path.dirname(config.flexSecretPath), { recursive: true });
  await fs.writeFile(config.flexSecretPath, '{"token":"<TEST_TOKEN>","queryId":"<TEST_QUERY_ID>"}\n', 'utf8');
  const failure = '<FlexStatementResponse><Status>Fail</Status><ErrorCode>1014</ErrorCode><ErrorMessage>Query is invalid.</ErrorMessage></FlexStatementResponse>';
  const service = await new PortfolioService({ rootDir, config, fetchImpl: async () => mockFlexResponse(failure) }).init();
  t.after(() => service.close());
  const result = await service.sync({ trigger: 'mock_diagnostic' });
  assert.equal(result.errorCategory, 'invalid_query');
  assert.equal(result.ibkrErrorCode, '1014');
  assert.equal(result.stage, 'parse_response');
  assert.equal(result.externalRequestCount, 1);
  const run = service.lastSyncRun();
  assert.equal(run.ibkrErrorCode, '1014');
  assert.equal(run.stage, 'parse_response');
  assert.equal(run.diagnostics[0].responseFormat, 'xml');
  assert.equal(service.db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.doesNotMatch(JSON.stringify(run), /TEST_TOKEN|TEST_QUERY_ID|Query is invalid/);
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

test('successful cached portfolio data remains usable after a later failed attempt', async t => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'portfolio-status-cache-test-'));
  t.after(() => fs.rm(runtimeRoot, { recursive: true, force: true }));
  const service = await new PortfolioService({ rootDir, config: testConfig(runtimeRoot), now: () => new Date('2026-08-08T00:00:00Z') }).init();
  t.after(() => service.close());
  service.importReport(normalizeFlexReport(flexXml));
  service.state.lastSuccessfulAt = '2026-08-08T00:00:00.000Z';
  const run = service.createRun('scheduled_daily');
  service.finishRun(run, 'failed', { errorCategory: 'network_error', stage: 'send_request', externalRequestCount: 1 });
  assert.equal(service.getStatus().status, 'ready');
  assert.equal(service.lastSyncRun().errorCategory, 'network_error');
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
