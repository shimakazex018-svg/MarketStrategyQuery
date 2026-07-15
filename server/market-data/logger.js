'use strict';

const fs = require('fs/promises');
const path = require('path');

function sanitize(entry) {
  const safe = { ...entry };
  for (const key of Object.keys(safe)) {
    if (/key|token|cookie|authorization/i.test(key)) safe[key] = '[redacted]';
  }
  return safe;
}

class BoundedLogger {
  constructor(logsDir, { maxBytes = 512_000, generations = 3 } = {}) {
    this.logsDir = logsDir;
    this.filePath = path.join(logsDir, 'market-data.jsonl');
    this.maxBytes = maxBytes;
    this.generations = generations;
    this.queue = Promise.resolve();
  }

  async rotateIfNeeded(incomingBytes) {
    let size = 0;
    try { size = (await fs.stat(this.filePath)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (size + incomingBytes <= this.maxBytes) return;
    await fs.rm(`${this.filePath}.${this.generations}`, { force: true });
    for (let index = this.generations - 1; index >= 1; index -= 1) {
      try { await fs.rename(`${this.filePath}.${index}`, `${this.filePath}.${index + 1}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    try { await fs.rename(this.filePath, `${this.filePath}.1`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  log(entry) {
    const line = `${JSON.stringify(sanitize(entry))}\n`;
    this.queue = this.queue.then(async () => {
      await fs.mkdir(this.logsDir, { recursive: true });
      await this.rotateIfNeeded(Buffer.byteLength(line));
      await fs.appendFile(this.filePath, line, 'utf8');
    }).catch(error => console.error('Market data log error:', error.message));
    return this.queue;
  }
}

module.exports = { BoundedLogger };
