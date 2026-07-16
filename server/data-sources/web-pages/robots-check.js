'use strict';

function normalizePath(value) {
  const path = String(value || '').trim();
  return path.startsWith('/') ? path : `/${path}`;
}

function parseRobotsTxt(text) {
  const groups = [];
  let current = null;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) continue;
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'user-agent') {
      if (!current || current.hasRules) {
        current = { agents: [], rules: [], hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      current.hasRules = true;
      current.rules.push({ type: key, path: value });
    }
  }
  return groups;
}

function isPathAllowed(text, targetUrl, userAgent = 'marketcyclestrategy') {
  const pathname = new URL(targetUrl).pathname || '/';
  const groups = parseRobotsTxt(text);
  const agent = String(userAgent).toLowerCase();
  const specific = groups.filter(group => group.agents.some(value => value !== '*' && agent.includes(value)));
  const applicable = specific.length ? specific : groups.filter(group => group.agents.includes('*'));
  const matches = [];

  for (const group of applicable) {
    for (const rule of group.rules) {
      if (!rule.path) continue;
      const rulePath = normalizePath(rule.path);
      if (pathname.startsWith(rulePath)) matches.push({ ...rule, path: rulePath });
    }
  }

  matches.sort((left, right) => right.path.length - left.path.length || (left.type === 'allow' ? -1 : 1));
  const decisiveRule = matches[0] || null;
  return {
    status: decisiveRule?.type === 'disallow' ? 'blocked' : 'allowed',
    allowed: decisiveRule?.type !== 'disallow',
    decisiveRule
  };
}

function evaluateRobotsResponse({ status, text = '', targetUrl, userAgent }) {
  if (status === 404 || status === 410) return { status: 'missing', allowed: true, decisiveRule: null };
  if (status !== 200) return { status: 'unavailable', allowed: false, decisiveRule: null };
  return isPathAllowed(text, targetUrl, userAgent);
}

module.exports = { evaluateRobotsResponse, isPathAllowed, parseRobotsTxt };
