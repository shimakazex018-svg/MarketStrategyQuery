'use strict';

const path = require('path');
const { loadProviderRegistry } = require('../server/market-data/provider-compliance');
const { WorldPERatioProvider } = require('../server/data-sources/web-pages/worldperatio');

async function main() {
  const rootDir = path.join(__dirname, '..');
  const provider = new WorldPERatioProvider({
    rootDir,
    providerRegistry: loadProviderRegistry(rootDir)
  });
  await provider.init();
  const result = await provider.refresh();
  const history = provider.getHistory();
  const output = {
    ok: result.ok,
    reason: result.reason || null,
    status: provider.getStatus(),
    latest: provider.getLatest(),
    history: {
      status: history.status,
      seriesAvailability: history.seriesAvailability,
      publishedPointCount: history.publishedSeries.length,
      snapshotCount: history.snapshots.length
    },
    statistics: provider.getStatistics()
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (!result.ok) process.exitCode = 2;
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, reason: error.webPageType || 'collection-failed', status: error.status || null })}\n`);
  process.exitCode = 2;
});
