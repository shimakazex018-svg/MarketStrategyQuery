'use strict';

const path = require('node:path');
const { createPortfolioService } = require('../server/portfolio');

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const service = await createPortfolioService(rootDir);
  try {
    const result = await service.sync({ trigger: 'manual_cli' });
    if (result.result === 'waiting_configuration') {
      console.log('IBKR尚未配置：请在本机 ignored secret 或环境变量中配置 Flex，再重新运行 portfolio:sync。');
      return;
    }
    if (!result.ok) {
      const stage = result.stage ? `；stage=${result.stage}` : '';
      const errorCode = result.ibkrErrorCode ? `；IBKR error code=${result.ibkrErrorCode}` : '';
      console.error(`资产同步未完成：${result.errorCategory || result.result || 'unknown'}${stage}${errorCode}`);
      process.exitCode = 1;
      return;
    }
    const counts = result.importedRowCounts || {};
    console.log(`资产同步完成：历史日期 ${result.reportDate || '—'}；快照 ${counts.snapshots || 0}；资金流 ${counts.cashFlows || 0}；交易 ${counts.trades || 0}；收入事件 ${counts.incomeEvents || 0}；仓位 ${counts.positions || 0}。`);
  } finally {
    await service.close();
  }
}

if (require.main === module) main().catch(error => { console.error(`资产同步失败：${error.message}`); process.exitCode = 1; });

module.exports = { main };
