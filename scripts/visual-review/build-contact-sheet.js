'use strict';

const fs = require('node:fs/promises');

async function buildContactSheet(browser, files, outputPath) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1040 }, deviceScaleFactor: 1 });
  const cards = await Promise.all(files.map(async item => ({ ...item, data: (await fs.readFile(item.path)).toString('base64') })));
  await page.setContent(`<!doctype html><html><head><style>body{margin:0;background:#07101c;color:#edf4ff;font:700 20px Inter,Arial,sans-serif}.title{padding:24px 32px;font-size:28px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:0 32px 32px}.card{padding:12px;background:#0d1828;border:1px solid #263a55;border-radius:16px}.card span{display:block;margin:0 0 9px}.card img{display:block;width:100%;height:760px;object-fit:contain;object-position:top;background:#07101c;border-radius:10px}</style></head><body><div class="title">Current Visual Review</div><div class="grid">${cards.map(item => `<div class="card"><span>${item.label}</span><img src="data:image/webp;base64,${item.data}" alt="${item.label}"></div>`).join('')}</div></body></html>`);
  await page.screenshot({ path: outputPath, type: 'webp', quality: 84 });
  await page.close();
}

module.exports = { buildContactSheet };
