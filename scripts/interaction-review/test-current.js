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

async function loginSynthetic(page) {
  await page.locator('#portfolioPassword').fill(syntheticPassword);
  await page.locator('[data-portfolio-login] button[type="submit"]').click();
  await page.waitForSelector('.portfolio-calendar-shell');
  await page.waitForSelector('[data-portfolio-calendar-cell]');
}

async function calendarPopoverVisible(page) {
  return page.evaluate(() => {
    const popover = document.querySelector('[data-portfolio-calendar-popover]');
    return Boolean(popover && !popover.hidden);
  });
}

async function testDesktopCalendar(page, requestCounts) {
  const cell = page.locator('[data-portfolio-calendar-cell]').first();
  const secondCell = page.locator('[data-portfolio-calendar-cell]').nth(1);
  const noDataCell = page.locator('.portfolio-calendar-cell.unknown').first();
  await cell.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => ({ hash: window.location.hash, scrollY: Math.round(window.scrollY) }));
  const requestSnapshot = mapObject(requestCounts);
  await page.evaluate(() => {
    window.__calendarPointerProbe = null;
    document.addEventListener('pointermove', event => {
      if (event.target.closest?.('[data-portfolio-calendar-cell]')) {
        window.__calendarPointerProbe = { clientX: event.clientX, clientY: event.clientY };
      }
    }, true);
  });
  const readTooltipState = () => page.evaluate(() => {
    const popover = document.querySelector('[data-portfolio-calendar-popover]');
    const rect = popover?.getBoundingClientRect();
    const pointer = window.__calendarPointerProbe;
    const visible = Boolean(popover && !popover.hidden);
    const horizontalGap = !rect || !pointer ? null : pointer.clientX < rect.left ? rect.left - pointer.clientX : pointer.clientX > rect.right ? pointer.clientX - rect.right : 0;
    const verticalGap = !rect || !pointer ? null : pointer.clientY < rect.top ? rect.top - pointer.clientY : pointer.clientY > rect.bottom ? pointer.clientY - rect.bottom : 0;
    return {
      visible,
      pointer,
      rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalGap,
      verticalGap,
      date: document.querySelector('[data-calendar-popover-date]')?.textContent || '',
      amount: document.querySelector('[data-calendar-popover-amount]')?.textContent || '',
      returnText: document.querySelector('[data-calendar-popover-return]')?.textContent || '',
      mode: popover?.dataset.mode || '',
      activeCell: document.activeElement?.matches?.('[data-portfolio-calendar-cell]') ? document.activeElement.dataset.calendarDate || '' : null,
      expandedCell: document.querySelector('[data-portfolio-calendar-cell][aria-expanded="true"]')?.dataset.calendarDate || null,
      popoverCount: document.querySelectorAll('[data-portfolio-calendar-popover]').length
    };
  });
  const waitForPopover = async (visible, label) => {
    try {
      await page.waitForFunction(expected => {
        const popover = document.querySelector('[data-portfolio-calendar-popover]');
        return Boolean(popover && !popover.hidden) === expected;
      }, visible, { timeout: 5_000 });
    } catch (error) {
      throw new Error(`${label}: ${error.message}; ${JSON.stringify(await readTooltipState())}`);
    }
  };
  const moveToCell = async (target, xRatio = 0.35, yRatio = 0.45, label = 'cell') => {
    const box = await target.boundingBox();
    assert.ok(box);
    const point = { clientX: box.x + box.width * xRatio, clientY: box.y + box.height * yRatio };
    await page.mouse.move(point.clientX, point.clientY);
    await waitForPopover(true, `show tooltip ${label}`);
    await page.waitForTimeout(40);
    return readTooltipState();
  };
  const assertTooltipBounds = (state, label = 'tooltip') => {
    assert.equal(state.visible, true, label);
    assert.ok(state.pointer, label);
    assert.ok(state.rect, label);
    assert.ok(state.rect.left >= 12 - 0.5, `${label}: ${JSON.stringify(state)}`);
    assert.ok(state.rect.top >= 12 - 0.5, `${label}: ${JSON.stringify(state)}`);
    assert.ok(state.rect.right <= state.viewport.width - 12 + 0.5, `${label}: ${JSON.stringify(state)}`);
    assert.ok(state.rect.bottom <= state.viewport.height - 12 + 0.5, `${label}: ${JSON.stringify(state)}`);
    assert.ok(state.horizontalGap < 60, `${label}: horizontalGap=${state.horizontalGap}`);
    assert.ok(state.verticalGap < 60, `${label}: verticalGap=${state.verticalGap}`);
  };
  const firstState = await moveToCell(cell, 0.3, 0.45);
  assertTooltipBounds(firstState, 'first');
  assert.ok(firstState.rect.top >= 10);
  assert.equal(firstState.amount, await cell.getAttribute('data-calendar-full'));
  assert.match(firstState.returnText, /%/);
  assert.equal(firstState.popoverCount, 1);
  assert.equal(await cell.getAttribute('aria-expanded'), 'true');
  await page.mouse.move(5, 5);
  await waitForPopover(false, 'hide first tooltip');
  assert.equal(await calendarPopoverVisible(page), false);
  assert.equal(await cell.getAttribute('aria-expanded'), 'false');
  await page.waitForTimeout(120);
  assert.equal(await calendarPopoverVisible(page), false);
  assert.equal(await noDataCell.count(), 1);
  await noDataCell.scrollIntoViewIfNeeded();
  const noDataBox = await noDataCell.boundingBox();
  assert.ok(noDataBox);
  await page.mouse.move(noDataBox.x + noDataBox.width * 0.5, noDataBox.y + noDataBox.height * 0.5);
  await waitForPopover(false, 'hide on no-data cell');
  await page.waitForTimeout(120);
  assert.equal(await calendarPopoverVisible(page), false);
  await cell.focus();
  assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-portfolio-calendar-cell]')), true);
  await page.waitForTimeout(120);
  assert.equal(await calendarPopoverVisible(page), false);
  const secondState = await moveToCell(secondCell, 0.75, 0.55);
  assertTooltipBounds(secondState, 'second');
  assert.notEqual(secondState.date, firstState.date);
  assert.ok(Math.abs(secondState.rect.left - firstState.rect.left) + Math.abs(secondState.rect.top - firstState.rect.top) > 0);
  assert.equal(secondState.popoverCount, 1);
  await page.mouse.move(5, 5);
  await waitForPopover(false, 'hide second tooltip');
  assert.equal(await secondCell.getAttribute('aria-expanded'), 'false');
  await page.waitForTimeout(120);
  assert.equal(await calendarPopoverVisible(page), false);
  await moveToCell(cell, 0.5, 0.5, 'window blur');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await waitForPopover(false, 'hide on window blur');
  await page.waitForTimeout(120);
  assert.equal(await calendarPopoverVisible(page), false);
  await cell.focus();
  assert.equal(await calendarPopoverVisible(page), false);
  await page.keyboard.press('Tab');
  await waitForPopover(true, 'show keyboard tooltip');
  const keyboardState = await readTooltipState();
  assert.equal(keyboardState.popoverCount, 1);
  assert.equal(keyboardState.mode, 'keyboard');
  assert.ok(keyboardState.activeCell);
  assert.equal(keyboardState.activeCell, keyboardState.expandedCell);
  await page.keyboard.press('Escape');
  await waitForPopover(false, 'hide keyboard tooltip');
  const runEdgeProbe = async (clientX, clientY, label) => {
    await page.evaluate(({ x, y }) => {
      const cell = document.querySelector('[data-portfolio-calendar-cell]');
      const eventInit = { bubbles: true, clientX: x, clientY: y, pointerType: 'mouse' };
      cell.dispatchEvent(new PointerEvent('pointerenter', eventInit));
      cell.dispatchEvent(new PointerEvent('pointermove', eventInit));
    }, { x: clientX, y: clientY });
    await waitForPopover(true, `show ${label}`);
    const state = await readTooltipState();
    assertTooltipBounds(state, label);
    await page.evaluate(({ x, y }) => {
      const cell = document.querySelector('[data-portfolio-calendar-cell]');
      cell.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, clientX: x, clientY: y, pointerType: 'mouse' }));
    }, { x: clientX, y: clientY });
    await waitForPopover(false, `hide ${label}`);
    return state;
  };
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  await runEdgeProbe(12, Math.round(viewport.height / 2), 'left edge');
  await runEdgeProbe(viewport.width - 12, Math.round(viewport.height / 2), 'right edge');
  await runEdgeProbe(Math.round(viewport.width / 2), viewport.height - 12, 'bottom edge');
  await page.evaluate(scrollY => window.scrollTo(0, scrollY), before.scrollY);
  await page.waitForFunction(scrollY => Math.round(window.scrollY) === Math.round(scrollY), before.scrollY);
  const after = await page.evaluate(() => ({
    hash: window.location.hash,
    scrollY: Math.round(window.scrollY),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  assert.deepEqual(after, { ...before, overflow: false });
  assert.deepEqual(mapObject(requestCounts), requestSnapshot);
  return { hover: true, pointerFollow: true, crossCell: true, viewportCollision: true, mouseLeave: true, noDataCellClose: true, keyboardFocus: true, keyboardEscape: true, requestDelta: 0, overflow: false };
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
  const localRequests = new Map();
  const externalRequests = new Set();
  page.on('request', request => {
    const url = request.url();
    const pathname = pathnameOf(url);
    if (pathname.startsWith('/api/portfolio/')) increment(localRequests, pathname);
    if (!url.startsWith(baseUrl + '/')) externalRequests.add(url);
  });
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
    await loginSynthetic(page);
    const cell = page.locator('[data-portfolio-calendar-cell]').first();
    const secondCell = page.locator('[data-portfolio-calendar-cell]').nth(1);
    await cell.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => ({ hash: window.location.hash, scrollY: Math.round(window.scrollY) }));
    const requestSnapshot = mapObject(localRequests);
    await cell.tap();
    await page.waitForFunction(() => {
      const popover = document.querySelector('[data-portfolio-calendar-popover]');
      return Boolean(popover && !popover.hidden);
    });
    const firstDate = await page.locator('[data-calendar-popover-date]').innerText();
    const firstText = await page.locator('[data-portfolio-calendar-popover]').innerText();
    assert.match(firstText, /\$/);
    assert.match(firstText, /当日收益率/);
    await cell.tap();
    await page.waitForFunction(() => Boolean(document.querySelector('[data-portfolio-calendar-popover]')?.hidden));
    await secondCell.tap();
    await page.waitForFunction(() => {
      const popover = document.querySelector('[data-portfolio-calendar-popover]');
      return Boolean(popover && !popover.hidden);
    });
    const secondDate = await page.locator('[data-calendar-popover-date]').innerText();
    assert.notEqual(secondDate, firstDate);
    await page.mouse.click(5, 5);
    await page.waitForFunction(() => Boolean(document.querySelector('[data-portfolio-calendar-popover]')?.hidden));
    await cell.tap();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => Boolean(document.querySelector('[data-portfolio-calendar-popover]')?.hidden));
    const after = await page.evaluate(() => ({
      hash: window.location.hash,
      scrollY: Math.round(window.scrollY),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }));
    assert.deepEqual(after, { ...before, overflow: false });
    assert.deepEqual(mapObject(localRequests), requestSnapshot);
    assert.equal(externalRequests.size, 0);
    return { label, viewport: viewport.width + 'x' + viewport.height, menuOpened, touchPortfolioLogin: true, calendarTap: true, switchDate: true, outsideClose: true, escapeClose: true, requestDelta: 0, externalRequests: 0, overflow: false };
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
  let calendarDesktop;
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
    calendarDesktop = await testDesktopCalendar(page, requestCounts);

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
      calendarDesktop,
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
