'use strict';

const { loadPortfolioConfig } = require('./config');
const { PortfolioService } = require('./service');

async function createPortfolioService(rootDir, options = {}) {
  const service = new PortfolioService({ rootDir, config: options.config || loadPortfolioConfig(rootDir), fetchImpl: options.fetchImpl, now: options.now, marketDataService: options.marketDataService, fixtureMode: options.fixtureMode });
  await service.init();
  return service;
}

module.exports = { createPortfolioService, loadPortfolioConfig, PortfolioService };
