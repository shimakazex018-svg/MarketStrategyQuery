'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

async function readExactly(handle, length, position) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new TypeError('ZIP ended before the requested structure was complete');
  return buffer;
}

function safeEntryName(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('../') || path.posix.isAbsolute(normalized)) {
    throw new TypeError('ZIP contains an unsafe entry path');
  }
  return normalized;
}

async function listZipEntries(filePath, options = {}) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size < 22) throw new TypeError('ZIP is too small');
    const tailLength = Math.min(stat.size, 65_557);
    const tail = await readExactly(handle, tailLength, stat.size - tailLength);
    let eocdOffset = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === EOCD_SIGNATURE) { eocdOffset = index; break; }
    }
    if (eocdOffset < 0) throw new TypeError('ZIP end-of-central-directory record is missing');
    const entryCount = tail.readUInt16LE(eocdOffset + 10);
    const centralSize = tail.readUInt32LE(eocdOffset + 12);
    const centralOffset = tail.readUInt32LE(eocdOffset + 16);
    if (entryCount > (options.maxEntries ?? 50_000)) throw new RangeError('ZIP contains too many entries');
    if (centralSize > (options.maxCentralDirectoryBytes ?? 64 * 1024 * 1024)) throw new RangeError('ZIP central directory is too large');
    if (centralOffset + centralSize > stat.size) throw new TypeError('ZIP central directory is outside the file');
    const central = await readExactly(handle, centralSize, centralOffset);
    const entries = [];
    let offset = 0;
    while (offset < central.length) {
      if (central.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new TypeError('ZIP central directory entry is invalid');
      const compressionMethod = central.readUInt16LE(offset + 10);
      const compressedSize = central.readUInt32LE(offset + 20);
      const uncompressedSize = central.readUInt32LE(offset + 24);
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const commentLength = central.readUInt16LE(offset + 32);
      const localHeaderOffset = central.readUInt32LE(offset + 42);
      const end = offset + 46 + nameLength + extraLength + commentLength;
      if (end > central.length) throw new TypeError('ZIP central directory entry is truncated');
      const name = safeEntryName(central.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
      entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
      offset = end;
    }
    if (entries.length !== entryCount) throw new TypeError('ZIP entry count does not match its directory');
    return entries;
  } finally {
    await handle.close();
  }
}

async function readZipEntry(filePath, entry, options = {}) {
  if (!entry || typeof entry !== 'object') throw new TypeError('ZIP entry is required');
  const maxUncompressedBytes = options.maxUncompressedBytes ?? 32 * 1024 * 1024;
  if (entry.uncompressedSize > maxUncompressedBytes) throw new RangeError(`ZIP entry ${entry.name} exceeds the uncompressed size limit`);
  const handle = await fs.open(filePath, 'r');
  try {
    const header = await readExactly(handle, 30, entry.localHeaderOffset);
    if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new TypeError('ZIP local entry header is invalid');
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
    const compressed = await readExactly(handle, entry.compressedSize, dataOffset);
    let output;
    if (entry.compressionMethod === 0) output = compressed;
    else if (entry.compressionMethod === 8) output = zlib.inflateRawSync(compressed, { maxOutputLength: maxUncompressedBytes });
    else throw new TypeError(`ZIP compression method ${entry.compressionMethod} is unsupported`);
    if (output.length !== entry.uncompressedSize) throw new TypeError(`ZIP entry ${entry.name} size check failed`);
    return output;
  } finally {
    await handle.close();
  }
}

async function readSelectedJsonEntries(filePath, expectedNames, options = {}) {
  const wanted = new Set(expectedNames);
  const entries = await listZipEntries(filePath, options);
  const selected = entries.filter(entry => wanted.has(entry.name) || wanted.has(path.posix.basename(entry.name)));
  const result = new Map();
  let totalBytes = 0;
  for (const entry of selected) {
    totalBytes += entry.uncompressedSize;
    if (totalBytes > (options.maxTotalUncompressedBytes ?? 512 * 1024 * 1024)) {
      throw new RangeError('selected ZIP entries exceed the total uncompressed size limit');
    }
    const value = JSON.parse((await readZipEntry(filePath, entry, options)).toString('utf8'));
    result.set(path.posix.basename(entry.name), value);
  }
  return { entries, selectedCount: selected.length, values: result };
}

module.exports = { listZipEntries, readSelectedJsonEntries, readZipEntry, safeEntryName };
