'use strict';

const fs = require('fs/promises');
const path = require('path');

async function writeAtomicJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(tempPath, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

function validateSnapshot(point) {
  if (!point || typeof point !== 'object' || Array.isArray(point)) throw new TypeError('snapshot must be an object');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(point.sourceDataDate || '')) throw new TypeError('snapshot.sourceDataDate is invalid');
  if (!Number.isFinite(point.currentPE) || point.currentPE <= 0 || point.currentPE >= 500) throw new TypeError('snapshot.currentPE is invalid');
  if (!Number.isFinite(new Date(point.fetchedAt).valueOf())) throw new TypeError('snapshot.fetchedAt is invalid');
  if (typeof point.parseVersion !== 'string' || !point.parseVersion) throw new TypeError('snapshot.parseVersion is invalid');
  return {
    sourceDataDate: point.sourceDataDate,
    currentPE: point.currentPE,
    fetchedAt: point.fetchedAt,
    parseVersion: point.parseVersion
  };
}

function normalizeSnapshotHistory(value) {
  if (!Array.isArray(value)) throw new TypeError('snapshot history must be an array');
  const points = value.map(validateSnapshot).sort((left, right) => left.sourceDataDate.localeCompare(right.sourceDataDate));
  if (new Set(points.map(point => point.sourceDataDate)).size !== points.length) throw new TypeError('snapshot history contains duplicate dates');
  return points;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function isolateCorruptFile(filePath, now = () => new Date()) {
  const suffix = now().toISOString().replace(/[:.]/g, '-');
  const isolatedPath = `${filePath}.corrupt-${suffix}`;
  try {
    await fs.rename(filePath, isolatedPath);
    return isolatedPath;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function loadSnapshotHistory({ historyPath, backupPath, now = () => new Date() }) {
  try {
    const current = await readJson(historyPath);
    if (current === null) return { points: [], recovered: false, isolatedPath: null };
    return { points: normalizeSnapshotHistory(current), recovered: false, isolatedPath: null };
  } catch {
    const isolatedPath = await isolateCorruptFile(historyPath, now);
    try {
      const backup = await readJson(backupPath);
      const points = backup === null ? [] : normalizeSnapshotHistory(backup);
      if (points.length) await writeAtomicJson(historyPath, points);
      return { points, recovered: points.length > 0, isolatedPath };
    } catch {
      return { points: [], recovered: false, isolatedPath };
    }
  }
}

function mergeSnapshot(points, snapshot) {
  const next = normalizeSnapshotHistory(points);
  const validated = validateSnapshot(snapshot);
  const dateIndex = next.findIndex(point => point.sourceDataDate === validated.sourceDataDate);
  if (dateIndex >= 0) {
    const unchanged = next[dateIndex].currentPE === validated.currentPE;
    if (unchanged) return { points: next, changed: false, reason: 'same-source-date' };
    next[dateIndex] = validated;
    return { points: normalizeSnapshotHistory(next), changed: true, reason: 'source-date-updated' };
  }
  if (next.some(point => point.currentPE === validated.currentPE)) {
    return { points: next, changed: false, reason: 'value-unchanged' };
  }
  next.push(validated);
  return { points: normalizeSnapshotHistory(next), changed: true, reason: 'snapshot-added' };
}

async function persistSnapshotHistory({ historyPath, backupPath, points }) {
  const normalized = normalizeSnapshotHistory(points);
  await writeAtomicJson(historyPath, normalized);
  await writeAtomicJson(backupPath, normalized);
  return normalized;
}

module.exports = {
  loadSnapshotHistory,
  mergeSnapshot,
  normalizeSnapshotHistory,
  persistSnapshotHistory,
  validateSnapshot,
  writeAtomicJson
};
