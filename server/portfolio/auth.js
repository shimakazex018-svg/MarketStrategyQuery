'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(part => part.trim().split('=').map(decodeURIComponent)).filter(pair => pair.length === 2 && pair[0]));
}

async function writePasswordFile(filePath, password, now = new Date()) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('portfolio-password-must-be-at-least-12-characters');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  const payload = { algorithm: 'scrypt', salt: salt.toString('base64'), hash: hash.toString('base64'), keyLength: 64, createdAt: new Date(now).toISOString() };
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { await fs.chmod(temp, 0o600); } catch { /* Windows ACLs remain the primary control */ }
  await fs.rename(temp, filePath);
  return payload;
}

class PortfolioAuth {
  constructor({ passwordPath, sessionTtlMs = 8 * 60 * 60 * 1000, secureCookie = false, fixtureMode = false, now = () => new Date() } = {}) {
    this.passwordPath = passwordPath;
    this.sessionTtlMs = sessionTtlMs;
    this.secureCookie = secureCookie;
    this.fixtureMode = fixtureMode;
    this.now = now;
    this.passwordRecord = null;
    this.sessions = new Map();
  }

  async init() {
    try { this.passwordRecord = JSON.parse(await fs.readFile(this.passwordPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') this.passwordRecord = null; }
    return this;
  }

  isConfigured() { return this.fixtureMode || Boolean(this.passwordRecord?.salt && this.passwordRecord?.hash); }

  verifyPassword(password) {
    if (this.fixtureMode) return true;
    if (!this.passwordRecord || typeof password !== 'string') return false;
    try {
      const salt = Buffer.from(this.passwordRecord.salt, 'base64');
      const expected = Buffer.from(this.passwordRecord.hash, 'base64');
      const actual = crypto.scryptSync(password, salt, Number(this.passwordRecord.keyLength) || expected.length, { N: 16_384, r: 8, p: 1 });
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch { return false; }
  }

  createSession() {
    const id = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().valueOf() + this.sessionTtlMs).toISOString();
    this.sessions.set(id, expiresAt);
    return { id, expiresAt };
  }

  getSession(req) {
    if (this.fixtureMode) return { id: 'synthetic-fixture-session', expiresAt: null };
    const id = parseCookies(req.headers.cookie || '').portfolio_session;
    if (!id) return null;
    const expiresAt = this.sessions.get(id);
    if (!expiresAt || new Date(expiresAt).valueOf() <= this.now().valueOf()) { this.sessions.delete(id); return null; }
    return { id, expiresAt };
  }

  login(password) { return this.verifyPassword(password) ? this.createSession() : null; }

  logout(req) {
    if (this.fixtureMode) return;
    const id = parseCookies(req.headers.cookie || '').portfolio_session;
    if (id) this.sessions.delete(id);
  }

  cookieHeader(session) {
    const parts = [`portfolio_session=${encodeURIComponent(session.id)}`, 'HttpOnly', 'Path=/', 'SameSite=Strict', `Max-Age=${Math.floor(this.sessionTtlMs / 1000)}`];
    if (this.secureCookie) parts.push('Secure');
    return parts.join('; ');
  }

  clearCookieHeader() { return 'portfolio_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0'; }
}

module.exports = { PortfolioAuth, parseCookies, writePasswordFile };
