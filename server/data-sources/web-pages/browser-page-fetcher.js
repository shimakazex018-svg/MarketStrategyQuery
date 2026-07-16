'use strict';

function browserPageFetcherStatus() {
  return {
    available: false,
    required: false,
    reason: 'server-rendered-html-is-sufficient; browser automation is not enabled'
  };
}

async function fetchBrowserPage() {
  const error = new Error('browser page fetching is disabled for WorldPEratio');
  error.webPageType = 'browser-fetch-disabled';
  throw error;
}

module.exports = { browserPageFetcherStatus, fetchBrowserPage };
