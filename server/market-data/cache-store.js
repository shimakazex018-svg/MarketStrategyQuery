'use strict';

const fs = require('fs/promises');
const path = require('path');

class CacheStore {
  constructor(runtimeDir, { maxRawBytes = 2_000_000 } = {}) {
    this.runtimeDir = runtimeDir;
    this.latestDir = path.join(runtimeDir, 'latest');
    this.rawDir = path.join(runtimeDir, 'raw');
    this.stateDir = path.join(runtimeDir, 'state');
    this.logsDir = path.join(runtimeDir, 'logs');
    this.maxRawBytes = maxRawBytes;
  }

  async init() {
    await Promise.all([this.latestDir, this.rawDir, this.stateDir, this.logsDir].map(dir => fs.mkdir(dir, { recursive: true })));
  }

  async readJson(filePath) {
    try {
      return { data: JSON.parse(await fs.readFile(filePath, 'utf8')), error: null };
    } catch (error) {
      if (error.code === 'ENOENT') return { data: null, error: null };
      return { data: null, error: { type: 'cache-corrupt', message: error.message } };
    }
  }

  async writeAtomic(filePath, content) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const handle = await fs.open(tempPath, 'wx');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      throw error;
    }
  }

  async readIndicator(id) {
    return this.readJson(path.join(this.latestDir, `${id}.json`));
  }

  async writeIndicator(id, model) {
    await this.writeAtomic(path.join(this.latestDir, `${id}.json`), `${JSON.stringify(model, null, 2)}\n`);
  }

  async readRequestState() {
    return this.readJson(path.join(this.stateDir, 'request-state.json'));
  }

  async writeRequestState(state) {
    await this.writeAtomic(path.join(this.stateDir, 'request-state.json'), `${JSON.stringify(state, null, 2)}\n`);
  }

  async writeRaw(id, raw) {
    const text = String(raw);
    if (Buffer.byteLength(text, 'utf8') > this.maxRawBytes) throw new RangeError('raw response exceeds size limit');
    await this.writeAtomic(path.join(this.rawDir, `${id}-latest.txt`), text);
  }
}

module.exports = { CacheStore };
