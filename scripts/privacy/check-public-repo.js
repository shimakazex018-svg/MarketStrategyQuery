'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');

function gitNames(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
      .split(/\0|\r?\n/).map(value => value.trim()).filter(Boolean);
  } catch (error) {
    throw new Error(`privacy-scanner-git-failed: ${error.message}`);
  }
}

function trackedAndStagedFiles() {
  return [...new Set([
    ...gitNames(['ls-files', '-z']),
    ...gitNames(['diff', '--cached', '--name-only', '-z'])
  ])].filter(relativePath => !relativePath.startsWith('node_modules/'));
}

function isPlaceholder(value) {
  return /YOUR[_ -]?|PLACEHOLDER|EXAMPLE|REPLACE|CHANGE[_ -]?ME|<[^>]+>|\$\{[^}]+\}/i.test(value);
}

function inspectContent(relativePath, content) {
  const findings = [];
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (/(^|\/)runtime-data(?:\/|$)/i.test(normalizedPath)) findings.push('runtime-data-path');
  if (/(^|\/)(?:raw-flex|secrets)(?:\/|$)/i.test(normalizedPath)) findings.push('private-portfolio-directory');
  if (/\.(?:sqlite|sqlite-wal|sqlite-shm|db)$/i.test(normalizedPath)) findings.push('database-file');
  if (/(?:flex|portfolio).*(?:\.xml|\.json)$/i.test(normalizedPath) && !/\.example\.json$/i.test(normalizedPath)) findings.push('private-portfolio-export');
  if (/\b(?:DU|U)\d{6,}\b/i.test(content)) findings.push('real-ibkr-account-id');

  const tokenAssignments = content.match(/(?:["']?(?:IBKR_FLEX_TOKEN|flexToken|token)["']?)\s*[=:]\s*["'`]([^"'`\r\n]+)["'`]/gi) || [];
  if (tokenAssignments.some(value => !isPlaceholder(value))) findings.push('flex-token');
  const queryAssignments = content.match(/(?:["']?(?:IBKR_FLEX_QUERY_ID|queryId|query_id)["']?)\s*[=:]\s*["'`]([^"'`\r\n]+)["'`]/gi) || [];
  if (queryAssignments.some(value => !isPlaceholder(value))) findings.push('flex-query-id');
  if (/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16})/.test(content)) findings.push('private-key-or-cloud-secret');
  return [...new Set(findings)];
}

function scanFiles(files = trackedAndStagedFiles()) {
  const findings = [];
  for (const relativePath of files) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    let content;
    try { content = fs.readFileSync(absolutePath, 'utf8'); } catch { findings.push({ relativePath, labels: ['unreadable-private-file'] }); continue; }
    const labels = inspectContent(relativePath, content);
    if (labels.length) findings.push({ relativePath, labels });
  }
  return findings;
}

function main() {
  const findings = scanFiles();
  if (findings.length) {
    console.error('Public repository privacy check failed:');
    findings.forEach(item => console.error(`- ${item.relativePath}: ${item.labels.join(', ')}`));
    process.exitCode = 1;
    return;
  }
  console.log(`Public repository privacy check passed (${trackedAndStagedFiles().length} tracked/staged files inspected).`);
}

if (require.main === module) main();

module.exports = { inspectContent, isPlaceholder, scanFiles, trackedAndStagedFiles };
