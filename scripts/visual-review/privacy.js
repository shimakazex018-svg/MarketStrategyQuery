'use strict';

const SENSITIVE_PATTERNS = Object.freeze([
  { label: 'user-path', pattern: /C:\\Users\\/i },
  { label: 'drive-path', pattern: /[A-Z]:\\/i },
  { label: 'private-ip-192', pattern: /\b192\.168\.\d{1,3}\.\d{1,3}\b/ },
  { label: 'private-ip-10', pattern: /(?:^|[^\d])10\.(?:\d{1,3}\.){2}\d{1,3}\b/ },
  { label: 'private-ip-172', pattern: /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/ },
  { label: 'zerotier', pattern: /zerotier/i },
  { label: 'credential-term', pattern: /api[_ -]?key|bearer|password|\btoken\b|\bcookie\b/i },
  { label: 'process-id', pattern: /\bpid\b/i }
]);

function findSensitiveText(text = '') {
  return SENSITIVE_PATTERNS.filter(item => item.pattern.test(String(text))).map(item => item.label);
}

function assertPrivateText(text, label = 'text') {
  const hits = findSensitiveText(text);
  if (hits.length) throw new Error(`Privacy scan failed for ${label}: ${hits.join(', ')}`);
}

module.exports = { SENSITIVE_PATTERNS, assertPrivateText, findSensitiveText };
