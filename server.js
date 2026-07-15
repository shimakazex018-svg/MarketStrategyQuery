'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const packageJson = require('./package.json');
const { CacheStore } = require('./server/market-data/cache-store');
const { loadMarketDataConfig } = require('./server/market-data/config');
const { handleMarketDataApi, sendJson } = require('./server/market-data/http-api');
const { BoundedLogger } = require('./server/market-data/logger');
const { RequestLimiter } = require('./server/market-data/request-limiter');
const { MarketDataScheduler } = require('./server/market-data/scheduler');
const { MarketDataService } = require('./server/market-data/service');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 48101);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function safeResolve(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const normalized = path.normalize(decoded).replace(/^([.][.][/\\])+/, '');
  const relative = normalized === path.sep ? 'index.html' : normalized.replace(/^[/\\]+/, '');
  const filePath = path.join(PUBLIC_DIR, relative);
  const pathFromPublic = path.relative(PUBLIC_DIR, filePath);
  return pathFromPublic && !pathFromPublic.startsWith(`..${path.sep}`) && !path.isAbsolute(pathFromPublic)
    ? filePath
    : pathFromPublic === '' ? path.join(PUBLIC_DIR, 'index.html') : null;
}

function sendFile(res, filePath) {
  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache'
      });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
    };

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

function createHttpServer(marketDataService) {
  return http.createServer(async (req, res) => {
    try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (requestUrl.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, version: packageJson.version, marketData: 'ready' });
      return;
    }

    if (await handleMarketDataApi(req, res, requestUrl, marketDataService)) return;

    const filePath = safeResolve(requestUrl.pathname);
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }
    sendFile(res, filePath);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) sendJson(res, 500, { error: 'server-error' });
      else res.end();
    }
  });
}

async function createMarketDataService(rootDir = __dirname, options = {}) {
  const config = options.config || loadMarketDataConfig(rootDir);
  const cacheStore = options.cacheStore || new CacheStore(config.runtimeDir);
  const limiter = options.limiter || new RequestLimiter(cacheStore, config, options.now);
  const logger = options.logger || new BoundedLogger(cacheStore.logsDir);
  const marketDataService = new MarketDataService({
    rootDir, config, cacheStore, limiter, logger,
    fetchImpl: options.fetchImpl,
    now: options.now
  });
  await marketDataService.init({ startupRefresh: options.startupRefresh !== false });
  return marketDataService;
}

async function start() {
  const marketDataService = await createMarketDataService();
  const scheduler = new MarketDataScheduler(marketDataService, { timezone: marketDataService.config.timezone });
  const server = createHttpServer(marketDataService);
  scheduler.start();

  server.on('close', () => scheduler.stop());
  server.listen(PORT, HOST, () => {
    console.log(`Market Cycle Strategy v${packageJson.version} running on http://${HOST}:${PORT}`);
    console.log(`LAN example: http://192.168.31.153:${PORT}`);
    console.log(`ZeroTier: http://<zerotier-ip>:${PORT}`);
  });
  return { server, marketDataService, scheduler };
}

if (require.main === module) {
  start().catch(error => {
    console.error('Unable to start server:', error);
    process.exitCode = 1;
  });
}

module.exports = { createHttpServer, createMarketDataService, safeResolve, sendFile, start };
