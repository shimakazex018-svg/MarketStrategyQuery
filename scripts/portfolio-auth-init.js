'use strict';

const { stdin, stdout } = require('node:process');
const { createInterface } = require('node:readline/promises');
const path = require('node:path');
const { loadPortfolioConfig } = require('../server/portfolio/config');
const { writePasswordFile } = require('../server/portfolio/auth');

async function main() {
  const config = loadPortfolioConfig(path.resolve(__dirname, '..'));
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const first = await readline.question('设置本地资产分析访问密码（至少12个字符）：', { signal: undefined });
    const second = await readline.question('再次输入访问密码：', { signal: undefined });
    if (first !== second) throw new Error('两次密码不一致');
    await writePasswordFile(config.passwordPath, first);
    stdout.write('资产分析访问密码已保存到本机 ignored runtime-data。\n');
  } finally {
    readline.close();
  }
}

if (require.main === module) main().catch(error => { console.error(`初始化失败：${error.message}`); process.exitCode = 1; });

module.exports = { main };
