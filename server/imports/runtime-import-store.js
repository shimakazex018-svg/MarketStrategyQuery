'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { importHoldingsCsv } = require('./holdings-import');
const { importManualForwardPeCsv } = require('./manual-input-import');
const { importPricesCsv } = require('./prices-import');

async function atomicJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await fs.rename(temporary, filePath);
}

async function newestCsv(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.csv') continue;
    const filePath = path.join(directory, entry.name);
    const stat = await fs.stat(filePath);
    candidates.push({ filePath, name: entry.name, modifiedAt: stat.mtime.toISOString(), mtimeMs: stat.mtimeMs });
  }
  return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name))[0] || null;
}

class RuntimeImportStore {
  constructor(runtimeRoot) {
    this.runtimeRoot = runtimeRoot;
    this.importRoot = path.join(runtimeRoot, 'imports');
    this.normalizedRoot = path.join(runtimeRoot, 'normalized');
    this.directories = {
      holdings: path.join(this.importRoot, 'holdings'),
      prices: path.join(this.importRoot, 'prices'),
      forwardPe: path.join(this.importRoot, 'forward-pe')
    };
  }

  async init() {
    await Promise.all([...Object.values(this.directories), this.normalizedRoot].map(directory => fs.mkdir(directory, { recursive: true })));
  }

  async importOne(kind, parser, options = {}) {
    const selected = await newestCsv(this.directories[kind]);
    if (!selected) return { status: 'unavailable', kind, sourceFile: null, error: null, data: null };
    try {
      const input = await fs.readFile(selected.filePath);
      const data = parser(input, { importedAt: new Date(selected.modifiedAt), ...options });
      const output = {
        kind,
        sourceFileName: selected.name,
        sourceFileModifiedAt: selected.modifiedAt,
        importedAt: data.manifest.importedAt,
        data
      };
      await atomicJson(path.join(this.normalizedRoot, `${kind}.json`), output);
      return { status: 'fresh', kind, sourceFile: selected.name, error: null, data };
    } catch (error) {
      return { status: 'error', kind, sourceFile: selected.name, error: { type: 'import_failed', message: error.message }, data: null };
    }
  }

  async load() {
    await this.init();
    const [holdings, prices, forwardPe] = await Promise.all([
      this.importOne('holdings', importHoldingsCsv, { allowMissingAsOf: true }),
      this.importOne('prices', importPricesCsv),
      this.importOne('forwardPe', importManualForwardPeCsv)
    ]);
    return { holdings, prices, forwardPe, loadedAt: new Date().toISOString() };
  }
}

module.exports = { RuntimeImportStore, atomicJson, newestCsv };
