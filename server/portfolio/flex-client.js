'use strict';

const fs = require('node:fs/promises');
const {
  ERROR_CATEGORIES,
  buildFlexCapabilityAudit,
  inspectFlexResponse,
  normalizeFlexReport,
  validateFlexCore
} = require('./flex-parser');

const FLEX_USER_AGENT = `Node.js/${process.versions.node}`;
const FLEX_PATHS = Object.freeze(new Set(['SendRequest', 'GetStatement']));
const MAX_REDIRECTS = 2;

class FlexClientError extends Error {
  constructor(message, category, details = {}) {
    super(message);
    this.name = 'FlexClientError';
    this.category = category;
    Object.assign(this, details);
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function loadFlexCredentials({ rootDir, secretPath }) {
  const token = String(process.env.IBKR_FLEX_TOKEN || '').trim();
  const queryId = String(process.env.IBKR_FLEX_QUERY_ID || '').trim();
  if (token && queryId) return { token, queryId, source: 'environment' };
  const filePath = secretPath || `${rootDir}/runtime-data/portfolio-analysis/secrets/ibkr-flex.json`;
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const localToken = String(parsed?.token || '').trim();
    const localQueryId = String(parsed?.queryId || '').trim();
    if (localToken && localQueryId) return { token: localToken, queryId: localQueryId, source: 'ignored-local-file' };
  } catch (error) {
    if (error.code !== 'ENOENT') throw new FlexClientError('Flex local configuration is invalid', 'authentication_error', { stage: 'credential_check' });
  }
  return null;
}

function classifyHttp(status) {
  if (status === 401 || status === 403) return 'authentication_error';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'upstream_error';
  return 'http_error';
}

function errorCategoryForDiagnostic(status, diagnostic) {
  if (diagnostic?.errorCode && ERROR_CATEGORIES[Number(diagnostic.errorCode)]) return ERROR_CATEGORIES[Number(diagnostic.errorCode)];
  if (diagnostic?.status === 'fail') return 'ibkr_error';
  return classifyHttp(status);
}

function responseHeader(response, name) {
  try { return response?.headers?.get?.(name) || ''; } catch { return ''; }
}

function isAllowedRedirect(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || !/(^|\.)interactivebrokers\.com$/i.test(url.hostname)) return false;
  return /^\/AccountManagement\/FlexWebService\/(?:SendRequest|GetStatement)\/?$/i.test(url.pathname);
}

function requestUrl(endpoint, pathname, parameters) {
  if (!FLEX_PATHS.has(pathname)) throw new FlexClientError('Unsupported Flex endpoint path', 'invalid_request', { stage: pathname === 'SendRequest' ? 'send_request' : 'get_statement' });
  const url = new URL(`${String(endpoint || '').replace(/\/$/, '')}/${pathname}`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
  return url;
}

function baseDiagnostic(stage, externalRequestCount, durationMs = 0) {
  return {
    stage,
    httpStatus: null,
    contentType: '',
    responseBytes: 0,
    responseFormat: 'unknown',
    rootTag: null,
    topLevelElementNames: [],
    flexStatementCount: 0,
    flexStatementsCount: 0,
    status: null,
    statusPresent: false,
    errorCode: null,
    errorCodePresent: false,
    errorMessageCategory: null,
    referenceCodePresent: false,
    durationMs,
    externalRequestCount
  };
}

function phaseDiagnostic(stage, source, externalRequestCount, outcome, extra = {}) {
  return {
    stage,
    httpStatus: source?.httpStatus ?? null,
    contentType: source?.contentType || '',
    responseBytes: source?.responseBytes || 0,
    responseFormat: source?.responseFormat || 'unknown',
    rootTag: source?.rootTag || null,
    topLevelElementNames: source?.topLevelElementNames || [],
    flexStatementCount: source?.flexStatementCount || 0,
    flexStatementsCount: source?.flexStatementsCount || 0,
    status: source?.status || null,
    statusPresent: Boolean(source?.statusPresent),
    errorCode: source?.errorCode || null,
    errorCodePresent: Boolean(source?.errorCodePresent),
    errorMessageCategory: source?.errorMessageCategory || null,
    referenceCodePresent: Boolean(source?.referenceCodePresent),
    durationMs: 0,
    externalRequestCount,
    outcome,
    ...extra
  };
}

class FlexClient {
  constructor({ rootDir, config, fetchImpl = global.fetch, sleepImpl = sleep, now = () => new Date() } = {}) {
    this.rootDir = rootDir;
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
    this.now = now;
    this.externalRequestCount = 0;
    this.diagnostics = [];
  }

  async request(pathname, parameters, { stage } = {}) {
    const requestStage = stage || (pathname === 'SendRequest' ? 'send_request' : 'get_statement');
    let url = requestUrl(this.config.flexEndpoint, pathname, parameters);
    const started = this.now();
    let redirectCount = 0;
    while (true) {
      this.externalRequestCount += 1;
      const externalRequestCount = this.externalRequestCount;
      let response;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/xml, text/xml, text/plain', 'User-Agent': FLEX_USER_AGENT },
          redirect: 'manual',
          signal: AbortSignal.timeout(this.config.flexTimeoutMs)
        });
      } catch (error) {
        const diagnostic = baseDiagnostic(requestStage, externalRequestCount, this.now() - started);
        diagnostic.networkErrorCategory = error.name === 'TimeoutError' || error.name === 'AbortError' ? 'timeout' : 'network_error';
        this.diagnostics.push(diagnostic);
        throw new FlexClientError('Flex request failed', diagnostic.networkErrorCategory, {
          stage: requestStage,
          diagnostics: [...this.diagnostics],
          externalRequestCount,
          ibkrErrorCode: null
        });
      }

      const status = Number(response?.status || 0);
      const contentType = responseHeader(response, 'content-type');
      if (status >= 300 && status < 400) {
        const location = responseHeader(response, 'location');
        const diagnostic = baseDiagnostic(requestStage, externalRequestCount, this.now() - started);
        diagnostic.httpStatus = status;
        diagnostic.contentType = String(contentType || '').trim().slice(0, 120);
        diagnostic.redirected = true;
        diagnostic.redirectAllowed = Boolean(location && isAllowedRedirect(location));
        if (!location || !diagnostic.redirectAllowed || redirectCount >= MAX_REDIRECTS) {
          this.diagnostics.push(diagnostic);
          throw new FlexClientError('Flex redirect is not allowed', 'redirect_error', {
            stage: requestStage,
            diagnostics: [...this.diagnostics],
            externalRequestCount,
            ibkrErrorCode: null
          });
        }
        const nextUrl = new URL(location, url);
        if (!isAllowedRedirect(nextUrl.href)) {
          diagnostic.redirectAllowed = false;
          this.diagnostics.push(diagnostic);
          throw new FlexClientError('Flex redirect is not allowed', 'redirect_error', {
            stage: requestStage,
            diagnostics: [...this.diagnostics],
            externalRequestCount,
            ibkrErrorCode: null
          });
        }
        nextUrl.search = url.search;
        this.diagnostics.push(diagnostic);
        url = nextUrl;
        redirectCount += 1;
        continue;
      }

      let bytes;
      try {
        bytes = Buffer.from(await response.arrayBuffer());
      } catch (error) {
        const diagnostic = baseDiagnostic(requestStage, externalRequestCount, this.now() - started);
        diagnostic.httpStatus = status || null;
        diagnostic.contentType = String(contentType || '').trim().slice(0, 120);
        this.diagnostics.push(diagnostic);
        throw new FlexClientError('Flex response could not be read', 'http_error', {
          stage: requestStage,
          diagnostics: [...this.diagnostics],
          externalRequestCount,
          ibkrErrorCode: null
        });
      }
      const body = bytes.toString('utf8');
      const diagnostic = inspectFlexResponse(body, { contentType, status });
      diagnostic.stage = requestStage;
      diagnostic.durationMs = this.now() - started;
      diagnostic.externalRequestCount = externalRequestCount;
      diagnostic.redirected = redirectCount > 0;
      diagnostic.redirectCount = redirectCount;
      this.diagnostics.push(diagnostic);
      if (!(status >= 200 && status < 300)) {
        throw new FlexClientError('Flex endpoint returned an HTTP error', errorCategoryForDiagnostic(status, diagnostic), {
          stage: requestStage,
          diagnostics: [...this.diagnostics],
          externalRequestCount,
          errorCode: diagnostic.errorCode,
          ibkrErrorCode: diagnostic.errorCode,
          rawXml: diagnostic.responseFormat === 'xml' ? body : null,
          capabilityAudit: diagnostic.responseFormat === 'xml' ? buildFlexCapabilityAudit(body, { diagnostic }) : null
        });
      }
      return { body, status, durationMs: diagnostic.durationMs, diagnostic };
    }
  }

  parseResponse(response, { stage, allowEmptyStatements = false } = {}) {
    const diagnostic = response.diagnostic;
    if (diagnostic.responseFormat === 'html') {
      this.diagnostics.push(phaseDiagnostic('parse_response', diagnostic, this.externalRequestCount, 'failure', { localErrorCategory: 'unexpected_html_response' }));
      throw new FlexClientError('Flex returned HTML instead of XML', 'unexpected_html_response', {
        stage: 'parse_response', diagnostics: [...this.diagnostics], externalRequestCount: this.externalRequestCount, ibkrErrorCode: diagnostic.errorCode
      });
    }
    if (diagnostic.responseFormat === 'csv' || diagnostic.responseFormat === 'text') {
      this.diagnostics.push(phaseDiagnostic('parse_response', diagnostic, this.externalRequestCount, 'failure', { localErrorCategory: 'query_output_format_mismatch' }));
      throw new FlexClientError('Flex returned a non-XML report format', 'query_output_format_mismatch', {
        stage: 'parse_response', diagnostics: [...this.diagnostics], externalRequestCount: this.externalRequestCount, ibkrErrorCode: diagnostic.errorCode
      });
    }
    if (diagnostic.responseFormat !== 'xml') {
      this.diagnostics.push(phaseDiagnostic('parse_response', diagnostic, this.externalRequestCount, 'failure', { localErrorCategory: 'schema_error' }));
      throw new FlexClientError('Flex response format is unknown', 'schema_error', {
        stage: 'parse_response', diagnostics: [...this.diagnostics], externalRequestCount: this.externalRequestCount, ibkrErrorCode: diagnostic.errorCode
      });
    }
    let report;
    try {
      report = normalizeFlexReport(response.body);
    } catch {
      this.diagnostics.push(phaseDiagnostic('parse_response', diagnostic, this.externalRequestCount, 'failure', { localErrorCategory: 'schema_error' }));
      const capabilityAudit = buildFlexCapabilityAudit(response.body, { diagnostic });
      throw new FlexClientError('Flex XML could not be parsed', 'schema_error', {
        stage: 'parse_response', diagnostics: [...this.diagnostics], externalRequestCount: this.externalRequestCount,
        ibkrErrorCode: diagnostic.errorCode, rawXml: response.body, capabilityAudit
      });
    }
    const capabilityAudit = buildFlexCapabilityAudit(response.body, { diagnostic });
    if (!report.ok) {
      this.diagnostics.push(phaseDiagnostic('parse_response', diagnostic, this.externalRequestCount, 'failure', { localErrorCategory: report.errorCategory || 'schema_error' }));
      throw new FlexClientError('Flex response is not usable', report.errorCategory || 'schema_error', {
        stage: 'parse_response', diagnostics: [...this.diagnostics], externalRequestCount: this.externalRequestCount,
        errorCode: report.errorCode || diagnostic.errorCode, ibkrErrorCode: report.errorCode || diagnostic.errorCode,
        rawXml: response.body, capabilityAudit
      });
    }
    if (!allowEmptyStatements && !report.statements?.length) {
      this.diagnostics.push(phaseDiagnostic('validate_statement', diagnostic, this.externalRequestCount, 'failure', { localErrorCategory: 'schema_error', missingCoreFields: ['statement'] }));
      throw new FlexClientError('Flex statement contains no supported statements', 'schema_error', {
        stage: 'validate_statement', diagnostics: [...this.diagnostics], externalRequestCount: this.externalRequestCount,
        ibkrErrorCode: diagnostic.errorCode, rawXml: response.body, capabilityAudit
      });
    }
    this.diagnostics.push(phaseDiagnostic('parse_response', diagnostic, this.externalRequestCount, 'success'));
    return { ...report, capabilityAudit };
  }

  async fetchReport() {
    this.externalRequestCount = 0;
    this.diagnostics = [];
    const credentials = await loadFlexCredentials({ rootDir: this.rootDir, secretPath: this.config.flexSecretPath });
    if (!credentials) throw new FlexClientError('IBKR Flex credentials are not configured locally', 'authentication_error', { stage: 'credential_check', externalRequestCount: 0, diagnostics: [] });

    const sendResponse = await this.request('SendRequest', { t: credentials.token, q: credentials.queryId, v: '3' }, { stage: 'send_request' });
    const generated = this.parseResponse(sendResponse, { stage: 'parse_response', allowEmptyStatements: true });
    if (generated.statements?.length) {
      const validation = validateFlexCore(generated);
      if (!validation.ok) {
        this.diagnostics.push({ stage: 'validate_statement', outcome: 'failure', externalRequestCount: this.externalRequestCount, missingCoreFields: validation.missing, warnings: validation.warnings });
        throw new FlexClientError('Flex report is missing core fields', 'schema_error', {
          stage: 'validate_statement', diagnostics: [...this.diagnostics], externalRequestCount: this.externalRequestCount,
          rawXml: generated.rawXml, capabilityAudit: generated.capabilityAudit, missingCoreFields: validation.missing, warnings: validation.warnings
        });
      }
      this.diagnostics.push({ stage: 'validate_statement', outcome: 'success', externalRequestCount: this.externalRequestCount, missingCoreFields: [], warnings: validation.warnings });
      return { ...generated, externalRequestCount: this.externalRequestCount, diagnostics: [...this.diagnostics], warnings: validation.warnings };
    }
    if (!generated.referenceCode) throw new FlexClientError('Flex response has no reference code', 'schema_error', {
      stage: 'validate_statement', diagnostics: [...this.diagnostics], externalRequestCount: this.externalRequestCount,
      rawXml: sendResponse.body, capabilityAudit: generated.capabilityAudit
    });

    await this.sleepImpl(this.config.flexPollDelayMs);
    let lastError = null;
    for (let attempt = 0; attempt <= this.config.flexPollAttempts; attempt += 1) {
      try {
        const reportResponse = await this.request('GetStatement', { t: credentials.token, q: generated.referenceCode, v: '3' }, { stage: 'get_statement' });
        const report = this.parseResponse(reportResponse, { stage: 'parse_response', allowEmptyStatements: false });
        const validation = validateFlexCore(report);
        if (!validation.ok) {
          this.diagnostics.push({ stage: 'validate_statement', outcome: 'failure', externalRequestCount: this.externalRequestCount, missingCoreFields: validation.missing, warnings: validation.warnings });
          throw new FlexClientError('Flex report is missing core fields', 'schema_error', {
            stage: 'validate_statement', diagnostics: [...this.diagnostics], externalRequestCount: this.externalRequestCount,
            rawXml: reportResponse.body, capabilityAudit: report.capabilityAudit, missingCoreFields: validation.missing, warnings: validation.warnings
          });
        }
        this.diagnostics.push({ stage: 'validate_statement', outcome: 'success', externalRequestCount: this.externalRequestCount, missingCoreFields: [], warnings: validation.warnings });
        return { ...report, referenceCode: generated.referenceCode, externalRequestCount: this.externalRequestCount, diagnostics: [...this.diagnostics], warnings: validation.warnings };
      } catch (error) {
        lastError = error;
        if (!(error instanceof FlexClientError)) throw error;
        if (error.category !== 'report_generation_pending' || attempt === this.config.flexPollAttempts) break;
      }
      await this.sleepImpl(this.config.flexPollDelayMs);
    }
    if (lastError instanceof FlexClientError) {
      lastError.externalRequestCount = this.externalRequestCount;
      lastError.diagnostics = [...this.diagnostics];
      throw lastError;
    }
    throw new FlexClientError('Flex report is not ready', 'report_generation_pending', {
      stage: 'get_statement', diagnostics: [...this.diagnostics], externalRequestCount: this.externalRequestCount, ibkrErrorCode: null
    });
  }
}

module.exports = { FLEX_USER_AGENT, FlexClient, FlexClientError, classifyHttp, isAllowedRedirect, loadFlexCredentials, requestUrl, sleep };
