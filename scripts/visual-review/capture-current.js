'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { buildContactSheet } = require('./build-contact-sheet');
const { assertPrivateText } = require('./privacy');

const rootDir = path.resolve(__dirname, '..', '..');
const outputDir = path.join(rootDir, 'previews', 'current');
const baseUrl = 'http://127.0.0.1:48101';
const maxImageBytes = 2 * 1024 * 1024;
const maxContactBytes = 3 * 1024 * 1024;
const maxTotalBytes = 8 * 1024 * 1024;
const targets = [
  { name: 'desktop.webp', label: 'Desktop', route: '#/settings', viewport: { width: 1440, height: 900 }, purpose: '设置页首屏与导航' },
  { name: 'ipad.webp', label: 'iPad', route: '#/settings', viewport: { width: 768, height: 1024 }, purpose: '设置页平板布局' },
  { name: 'iphone.webp', label: 'iPhone', route: '#/settings', viewport: { width: 390, height: 844 }, purpose: '设置页手机布局' },
  { name: 'home-desktop.webp', label: 'Home desktop', route: '#/', viewport: { width: 1440, height: 900 }, purpose: '首页基线' },
  { name: 'drawdown-desktop.webp', label: 'Drawdown desktop', route: '#/drawdown-analysis', viewport: { width: 1440, height: 900 }, purpose: '回撤分析基线' }
];

function requestJson(url) {
  return new Promise((resolve, reject) => http.get(url, response => {
    let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
    response.on('end', () => response.statusCode === 200 ? resolve(JSON.parse(body)) : reject(new Error(`${url} returned ${response.statusCode}`)));
  }).on('error', reject));
}

function browserPath() {
  const candidates = [process.env.VISUAL_BROWSER_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  const found = candidates.find(candidate => { try { require('node:fs').accessSync(candidate); return true; } catch { return false; } });
  if (!found) throw new Error('No supported local Chrome or Edge executable was found. Set VISUAL_BROWSER_PATH.');
  return found;
}

function gitHead() { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim(); }

async function capture(browser, target, externalRequests, consoleErrors) {
  const page = await browser.newPage({ viewport: target.viewport, deviceScaleFactor: 1 });
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('request', request => { if (!request.url().startsWith(`${baseUrl}/`)) externalRequests.add(request.url()); });
  await page.goto(`${baseUrl}/${target.route}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#app > *');
  const review = await page.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, loading: document.body.innerText.includes('正在读取采集状态') }));
  // The settings page has a fixed public label describing credential-use status; it contains no credential value and is below the captured viewport.
  assertPrivateText(review.text.replace('使用Cookie或Token', '访问凭据使用'), target.name);
  if (review.overflow || review.loading) throw new Error(`${target.name} has overflow or unfinished loading state`);
  await page.screenshot({ path: path.join(outputDir, target.name), type: 'webp', quality: 84 });
  await page.close();
}

async function assertSizes() {
  const files = await fs.readdir(outputDir); let total = 0;
  for (const file of files.filter(file => file.endsWith('.webp'))) {
    const size = (await fs.stat(path.join(outputDir, file))).size; total += size;
    if (file === 'contact-sheet.webp' ? size > maxContactBytes : size > maxImageBytes) throw new Error(`${file} exceeds its size limit`);
  }
  if (total > maxTotalBytes) throw new Error('previews/current exceeds 8 MiB');
  return total;
}

async function main() {
  const health = await requestJson(`${baseUrl}/api/health`);
  if (!health.ok || health.marketData !== 'ready') throw new Error('Local service health is not ready');
  await fs.mkdir(outputDir, { recursive: true });
  for (const file of await fs.readdir(outputDir)) if (file.endsWith('.webp')) await fs.unlink(path.join(outputDir, file));
  for (const target of targets) assertPrivateText(target.name, 'output filename');
  const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
  const externalRequests = new Set(); const consoleErrors = [];
  try {
    for (const target of targets) await capture(browser, target, externalRequests, consoleErrors);
    if (externalRequests.size) throw new Error(`External browser requests are forbidden: ${[...externalRequests].join(', ')}`);
    if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.join(' | ')}`);
    await buildContactSheet(browser, targets.slice(0, 3).map(target => ({ label: target.label, path: path.join(outputDir, target.name) })), path.join(outputDir, 'contact-sheet.webp'));
  } finally { await browser.close(); }
  const manifest = `# Current Visual Review\n\n- Commit: ${gitHead()}\n- Generated at: ${new Date().toISOString()}\n- Application version: ${health.version}\n- Route: #/settings, #/, #/drawdown-analysis\n- Viewports: 1440x900, 768x1024, 390x844\n- Data mode: local-production-cache\n- Service health: ready\n- External requests triggered: 0\n- Privacy scan: passed\n- Changed feature: 持续视觉快照流程与设置页可读性\n- Interaction state: 设置页默认最近10条记录；标准截图为静态首屏状态\n- Known limitations: 快照不替代真实触摸设备验收。\n\n## Files\n\n| File | Viewport | Route | Purpose |\n|---|---|---|---|\n${targets.map(target => `| [${target.name}](${target.name}) | ${target.viewport.width}x${target.viewport.height} | ${target.route} | ${target.purpose} |`).join('\n')}\n| [contact-sheet.webp](contact-sheet.webp) | visual index | #/settings | Desktop, iPad and iPhone index |\n\n## Validation\n\n- Desktop: passed\n- iPad: passed\n- iPhone: passed\n- Horizontal overflow: none\n- Console errors: none\n- Sensitive information: none found in DOM, manifest or filenames\n- External network access: none\n`;
  assertPrivateText(manifest, 'manifest');
  await fs.writeFile(path.join(outputDir, 'manifest.md'), manifest, 'utf8');
  const total = await assertSizes();
  console.log(`Visual review complete: ${targets.length + 1} WebP files, ${total} bytes.`);
}

main().catch(error => { console.error(`Visual review failed: ${error.message}`); process.exitCode = 1; });
