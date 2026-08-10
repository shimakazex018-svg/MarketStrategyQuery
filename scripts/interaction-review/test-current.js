'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { startReviewServer } = require('../../tests/review-server');

const syntheticPassword = ['synthetic', 'review', 'password', '2026'].join('-');
const wrongPassword = ['synthetic', 'wrong', 'password', '2026'].join('-');

function browserPath() {
  const candidates = [
    process.env.VISUAL_BROWSER_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error('No supported local Chrome or Edge executable was found. Set VISUAL_BROWSER_PATH.');
  return found;
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function pathnameOf(url) {
  try { return new URL(url).pathname; } catch { return ''; }
}

function mapObject(map) { return Object.fromEntries(map); }

async function installInteractionTrace(page) {
  await page.evaluate(() => {
    const trace = {
      loginMounts: 0,
      loginRemovals: 0,
      authPanelMounts: 0,
      authPanelRemovals: 0,
      appInnerHTMLWrites: 0,
      animationStarts: 0,
      pageInStarts: 0,
      animationNames: {},
      mutationRecords: 0,
      wrappedInnerHTML: false
    };
    window.__realInteractionTrace = trace;
    const countMatches = (node, selector) => {
      if (!(node instanceof Element)) return 0;
      return (node.matches(selector) ? 1 : 0) + node.querySelectorAll(selector).length;
    };
    const observer = new MutationObserver(records => {
      trace.mutationRecords += records.length;
      for (const record of records) {
        for (const node of record.addedNodes) {
          trace.loginMounts += countMatches(node, 'form[data-portfolio-login]');
          trace.authPanelMounts += countMatches(node, '.portfolio-auth-panel');
        }
        for (const node of record.removedNodes) {
          trace.loginRemovals += countMatches(node, 'form[data-portfolio-login]');
          trace.authPanelRemovals += countMatches(node, '.portfolio-auth-panel');
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('animationstart', event => {
      if (event.animationName && event.target.closest?.('#app')) {
        trace.animationStarts += 1;
        trace.animationNames[event.animationName] = (trace.animationNames[event.animationName] || 0) + 1;
        if (event.animationName === 'pageIn') trace.pageInStarts += 1;
      }
    }, true);
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (descriptor?.get && descriptor?.set && descriptor.configurable) {
      Object.defineProperty(Element.prototype, 'innerHTML', {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) {
          if (this.id === 'app') trace.appInnerHTMLWrites += 1;
          return descriptor.set.call(this, value);
        }
      });
      trace.wrappedInnerHTML = true;
    }
  });
}

async function traceSnapshot(page) {
  return page.evaluate(() => ({
    ...window.__realInteractionTrace,
    hash: window.location.hash,
    scrollY: Math.round(window.scrollY),
    loginForms: document.querySelectorAll('form[data-portfolio-login]').length,
    authPanels: document.querySelectorAll('.portfolio-auth-panel').length
  }));
}

async function waitForHash(page, expected) {
  await page.waitForFunction(value => window.location.hash === value, expected);
}

async function typeInto(page, selector, value) {
  const input = page.locator(selector);
  await input.click();
  await page.keyboard.type(value);
}

async function testKeyboardAndCriticalPath(page) {
  await page.locator('a.brand[href="#/"]').click();
  await waitForHash(page, '#/');
  await page.waitForSelector('.metric-grid');

  await page.keyboard.press('Tab');
  const tabTarget = await page.evaluate(() => document.activeElement?.tagName || '');
  await page.keyboard.press('Shift+Tab');
  const shiftTabTarget = await page.evaluate(() => document.activeElement?.tagName || '');
  assert.notEqual(tabTarget, '');
  assert.notEqual(shiftTabTarget, '');

  const infoButton = page.locator('[data-indicator-info="vix"]').first();
  await infoButton.focus();
  await page.keyboard.press('Space');
  await page.waitForSelector('#indicator-dialog-portal .indicator-dialog');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#indicator-dialog-portal .indicator-dialog', { state: 'detached' });

  await infoButton.click();
  await page.waitForSelector('#indicator-dialog-portal .indicator-dialog');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#indicator-dialog-portal .indicator-dialog', { state: 'detached' });

  await page.locator('a[href^="#/stage/"]').first().click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/stage/'));
  await page.waitForSelector('.stage-page, .stage-detail, h1');
  await page.locator('a.brand[href="#/"]').click();
  await waitForHash(page, '#/');

  await page.locator('a[href="#/drawdown-analysis"]').first().click();
  await waitForHash(page, '#/drawdown-analysis');
  await page.waitForSelector('.drawdown-page');
  await page.waitForSelector('.drawdown-chart-pointer-capture', { timeout: 15_000 });
  const pointer = page.locator('.drawdown-chart-pointer-capture').first();
  const pointerBox = await pointer.boundingBox();
  assert.ok(pointerBox);
  await page.mouse.move(pointerBox.x + pointerBox.width * 0.35, pointerBox.y + pointerBox.height * 0.5);
  await pointer.focus();
  await page.keyboard.press('ArrowRight');

  await page.locator('a[href="#/settings"]').click();
  await waitForHash(page, '#/settings');
  await page.waitForSelector('.settings-hero');
  await page.locator('a.brand[href="#/"]').click();
  await waitForHash(page, '#/');

  return { tabTarget, shiftTabTarget, indicatorDialog: true, stageRoute: true, drawdownPointer: true, settingsRoute: true };
}

async function testTouchViewport(browser, baseUrl, label, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  try {
    await page.goto(`${baseUrl}/#/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.metric-grid');
    const menu = page.locator('#menuToggle');
    let menuOpened = false;
    if (await menu.isVisible()) {
      await menu.tap();
      await page.waitForFunction(() => !document.getElementById('mobileNav').hidden);
      menuOpened = true;
      await page.locator('#mobileNav a[href="#/portfolio-analysis"]').tap();
    } else {
      await page.locator('a[href="#/portfolio-analysis"]').first().tap();
    }
    await waitForHash(page, '#/portfolio-analysis');
    await page.waitForSelector('form[data-portfolio-login]');
    return { label, viewport: `${viewport.width}x${viewport.height}`, menuOpened, touchPortfolioLogin: true };
  } finally {
    await page.close();
  }
}

async function main() {
  const review = await startReviewServer({ port: 0, authPassword: syntheticPassword });
  const baseUrl = `http://127.0.0.1:${review.port}`;
  const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const requestCounts = new Map();
  const responseCounts = new Map();
  let consoleErrors = 0;
  let expectedAuth401ConsoleErrors = 0;
  let consoleWarnings = 0;
  let pageErrors = 0;
  const recordPortfolioRequest = (url, map, suffix = '') => {
    const pathname = pathnameOf(url);
    if (pathname.startsWith('/api/portfolio/')) increment(map, `${pathname}${suffix}`);
  };
  page.on('request', request => recordPortfolioRequest(request.url(), requestCounts));
  page.on('response', response => recordPortfolioRequest(response.url(), responseCounts, ` [${response.status()}]`));
  page.on('console', message => {
    if (message.type() === 'error') {
      if (/\b401\b|unauthorized/i.test(message.text())) expectedAuth401ConsoleErrors += 1;
      else consoleErrors += 1;
    }
    if (message.type() === 'warning') consoleWarnings += 1;
  });
  page.on('pageerror', () => { pageErrors += 1; });

  let idleMetrics;
  let criticalPath;
  let touchResults;
  try {
    await page.goto(`${baseUrl}/#/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.metric-grid');
    await page.waitForSelector('.naaim-observation');
    await page.waitForFunction(() => !document.querySelector('.metric-card[data-market-status="loading"]'));
    await page.waitForTimeout(600);
    requestCounts.clear();
    responseCounts.clear();
    consoleErrors = 0;
    expectedAuth401ConsoleErrors = 0;
    consoleWarnings = 0;
    pageErrors = 0;
    await installInteractionTrace(page);

    await page.locator('a[href="#/portfolio-analysis"]').first().click();
    await waitForHash(page, '#/portfolio-analysis');
    await page.waitForSelector('form[data-portfolio-login]');
    const idleSamples = [];
    for (let second = 0; second < 30; second += 1) {
      await page.waitForTimeout(1000);
      idleSamples.push(await page.evaluate(() => ({
        hash: window.location.hash,
        scrollY: Math.round(window.scrollY),
        loginForms: document.querySelectorAll('form[data-portfolio-login]').length,
        authPanels: document.querySelectorAll('.portfolio-auth-panel').length
      })));
    }
    idleMetrics = await traceSnapshot(page);
    assert.equal(idleMetrics.hash, '#/portfolio-analysis');
    assert.equal(idleMetrics.loginForms, 1);
    assert.equal(idleMetrics.authPanels, 1);
    assert.equal(idleMetrics.loginMounts, 1);
    assert.equal(idleMetrics.loginRemovals, 0);
    assert.equal(idleMetrics.authPanelMounts, 1);
    assert.equal(idleMetrics.authPanelRemovals, 0);
    assert.ok(idleMetrics.pageInStarts <= 1, JSON.stringify({ pageInStarts: idleMetrics.pageInStarts, animationNames: idleMetrics.animationNames, appInnerHTMLWrites: idleMetrics.appInnerHTMLWrites }));
    assert.equal(requestCounts.get('/api/portfolio/status'), 1);
    assert.equal(responseCounts.get('/api/portfolio/status [401]'), 1);
    assert.equal([...requestCounts.keys()].filter(key => key !== '/api/portfolio/status').length, 0);
    assert.ok(idleSamples.every(sample => sample.hash === '#/portfolio-analysis' && sample.scrollY === 0 && sample.loginForms === 1 && sample.authPanels === 1));
    assert.equal(consoleErrors, 0);
    assert.equal(pageErrors, 0);

    await typeInto(page, '#portfolioPassword', wrongPassword);
    await page.locator('#portfolioPassword').press('Enter');
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-portfolio-login-error]');
      return Boolean(node && !node.hidden && node.textContent);
    });
    assert.match(await page.locator('[data-portfolio-login-error]').innerText(), /密码不正确/);

    await page.locator('#portfolioPassword').fill('');
    await typeInto(page, '#portfolioPassword', syntheticPassword);
    await page.locator('[data-portfolio-login] button[type="submit"]').click();
    await page.waitForSelector('.portfolio-chart', { timeout: 15_000 });
    assert.match(await page.locator('body').innerText(), /synthetic-review-fixture/i);
    assert.equal(await page.locator('[data-portfolio-chart-hit]').count(), 1);
    const portfolioPointer = page.locator('[data-portfolio-chart-hit]');
    const portfolioPointerBox = await portfolioPointer.boundingBox();
    assert.ok(portfolioPointerBox);
    await page.mouse.move(portfolioPointerBox.x + portfolioPointerBox.width * 0.25, portfolioPointerBox.y + portfolioPointerBox.height * 0.45);
    await portfolioPointer.focus();
    await page.keyboard.press('ArrowLeft');

    await page.locator('[data-portfolio-logout]').click();
    await page.waitForSelector('form[data-portfolio-login]');
    const statusCountAfterLogout = requestCounts.get('/api/portfolio/status') || 0;
    await page.waitForTimeout(1000);
    assert.equal(requestCounts.get('/api/portfolio/status') || 0, statusCountAfterLogout);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('form[data-portfolio-login]');
    const refreshedStatusCount = requestCounts.get('/api/portfolio/status') || 0;
    assert.equal(refreshedStatusCount, statusCountAfterLogout + 1);
    assert.equal(responseCounts.get('/api/portfolio/status [401]'), 2);
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('form[data-portfolio-login]').count(), 1);

    criticalPath = await testKeyboardAndCriticalPath(page);
    touchResults = await Promise.all([
      testTouchViewport(browser, baseUrl, 'iPad', { width: 768, height: 1024 }),
      testTouchViewport(browser, baseUrl, 'iPhone', { width: 390, height: 844 })
    ]);
    assert.ok(touchResults.every(result => result.touchPortfolioLogin));

    console.log(JSON.stringify({
      mode: 'synthetic-review-fixture',
      repositoryVisibility: 'public',
      productionPortUsed: false,
      idleUnauthenticated30s: idleMetrics,
      idleSamples: {
        count: idleSamples.length,
        uniqueHashes: [...new Set(idleSamples.map(sample => sample.hash))],
        uniqueScrollY: [...new Set(idleSamples.map(sample => sample.scrollY))],
        maxLoginForms: Math.max(...idleSamples.map(sample => sample.loginForms)),
        maxAuthPanels: Math.max(...idleSamples.map(sample => sample.authPanels))
      },
      portfolioRequests: mapObject(requestCounts),
      portfolioResponses: mapObject(responseCounts),
      consoleErrors,
      expectedAuth401ConsoleErrors,
      consoleWarnings,
      pageErrors,
      criticalPath,
      touchResults,
      result: 'REAL INTERACTION SMOKE PASSED'
    }, null, 2));
  } finally {
    await page.close();
    await browser.close();
    await new Promise(resolve => review.server.close(resolve));
  }
}

main().catch(error => {
  console.error(`REAL INTERACTION SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
});
