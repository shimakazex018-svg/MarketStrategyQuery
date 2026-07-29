'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { listZipEntries, readZipEntry } = require('./zip-reader');

const NAAIM_METRIC_ID = 'naaim_exposure';
const MAX_WORKBOOK_BYTES = 25 * 1024 * 1024;
const MAX_WORKSHEET_BYTES = 16 * 1024 * 1024;
const CORE_HEADERS = Object.freeze({
  date: ['date', 'survey date', 'report date'],
  value: ['naaim number mean/average', 'naaim number', 'mean/average', 'exposure index']
});
const OPTIONAL_HEADERS = Object.freeze({
  bearish: ['bearish'],
  quartile1: ['quart1', 'quartile 1', 'first quartile'],
  median: ['quart2', 'quartile 2', 'median'],
  quartile3: ['quart3', 'quartile 3', 'third quartile'],
  bullish: ['bullish'],
  deviation: ['deviation']
});

function xmlText(value) {
  return String(value || '').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function normalizedHeader(value) {
  return xmlText(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function columnNumber(reference) {
  const letters = String(reference || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) throw new TypeError('Workbook contains a cell without a valid reference');
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function excelDate(value) {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
  const serial = Number(text);
  if (!Number.isFinite(serial) || serial < 1) throw new TypeError('NAAIM workbook contains an invalid date');
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

function finiteNumber(value, field, date) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`NAAIM workbook contains a missing ${field} value at ${date || 'an unknown date'}`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`NAAIM workbook contains an invalid ${field} value at ${date || 'an unknown date'}`);
  return number;
}

function percentile(values, current) {
  if (!values.length || !Number.isFinite(current)) return null;
  return values.filter(value => value <= current).length / values.length * 100;
}

function deriveNaaimStatistics(values) {
  const valid = values.map(point => point.value).filter(Number.isFinite);
  const latest = values.at(-1) || null;
  const previous = values.at(-2) || null;
  const year = values.slice(-52).map(point => point.value);
  return {
    latestValue: latest?.value ?? null,
    sourceDataDate: latest?.date ?? null,
    weekOverWeekChange: latest && previous ? latest.value - previous.value : null,
    fourWeekAverage: values.length >= 4 ? values.slice(-4).reduce((sum, point) => sum + point.value, 0) / 4 : null,
    oneYearPercentile: year.length ? percentile(year, latest?.value) : null,
    allHistoryPercentile: valid.length ? percentile(valid, latest?.value) : null,
    oneYearLow: year.length ? Math.min(...year) : null,
    oneYearHigh: year.length ? Math.max(...year) : null,
    allHistoryLow: valid.length ? Math.min(...valid) : null,
    allHistoryHigh: valid.length ? Math.max(...valid) : null
  };
}

function normalizeNaaimRows(rows, { now = new Date() } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new TypeError('NAAIM workbook contains no data rows');
  const today = new Date(now).toISOString().slice(0, 10);
  const byDate = new Map();
  let duplicateCount = 0;
  let conflictCount = 0;
  let missingValueCount = 0;
  let abnormalRangeCount = 0;
  for (const row of rows) {
    let date;
    try { date = excelDate(row.date); } catch (error) { throw error; }
    if (date > today) throw new TypeError('NAAIM workbook contains a future date');
    let value;
    try { value = finiteNumber(row.value, 'mean exposure', date); } catch (error) { missingValueCount += 1; throw error; }
    if (value < -200 || value > 200) { abnormalRangeCount += 1; throw new RangeError(`NAAIM mean exposure is outside the allowed -200 to 200 range at ${date}`); }
    const optional = {};
    for (const field of Object.keys(OPTIONAL_HEADERS)) {
      if (row[field] === null || row[field] === undefined || String(row[field]).trim() === '') optional[field] = null;
      else optional[field] = finiteNumber(row[field], field, date);
    }
    const point = { date, value, ...optional };
    const existing = byDate.get(date);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(point)) { conflictCount += 1; throw new TypeError(`NAAIM workbook contains conflicting values for ${date}`); }
      duplicateCount += 1;
    } else byDate.set(date, point);
  }
  const values = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  let weeklyGapCount = 0;
  for (let index = 1; index < values.length; index += 1) {
    if ((Date.parse(`${values[index].date}T00:00:00Z`) - Date.parse(`${values[index - 1].date}T00:00:00Z`)) / 86_400_000 > 10) weeklyGapCount += 1;
  }
  return {
    values,
    diagnostics: {
      firstDate: values[0].date,
      lastDate: values.at(-1).date,
      rowCount: values.length,
      duplicateCount,
      conflictCount,
      missingValueCount,
      abnormalRangeCount,
      weeklyGapCount
    },
    derived: deriveNaaimStatistics(values)
  };
}

function cellValue(cellXml, sharedStrings) {
  const type = cellXml.match(/\bt="([^"]+)"/)?.[1];
  if (type === 'inlineStr') return xmlText(cellXml.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1]);
  const value = xmlText(cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]);
  if (type === 's') return sharedStrings[Number(value)] ?? '';
  return value;
}

function parseSheetRows(xml, sharedStrings) {
  return [...String(xml).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(rowMatch => {
    const cells = new Map();
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = cell[1].match(/\br="([^"]+)"/)?.[1];
      cells.set(columnNumber(reference), cellValue(`<c ${cell[1]}>${cell[2]}</c>`, sharedStrings));
    }
    return cells;
  });
}

function detectColumns(rows) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const headers = new Map([...rows[rowIndex]].map(([column, value]) => [normalizedHeader(value), column]));
    const match = {};
    for (const [field, aliases] of Object.entries(CORE_HEADERS)) {
      const header = aliases.find(alias => headers.has(alias));
      if (header) match[field] = headers.get(header);
    }
    if (match.date !== undefined && match.value !== undefined) {
      for (const [field, aliases] of Object.entries(OPTIONAL_HEADERS)) {
        const header = aliases.find(alias => headers.has(alias));
        if (header) match[field] = headers.get(header);
      }
      return { headerRow: rowIndex, columns: match };
    }
  }
  throw new TypeError('NAAIM workbook is missing explicit Date and NAAIM mean exposure headers');
}

function rowsForColumns(rows, detected) {
  const output = [];
  for (const cells of rows.slice(detected.headerRow + 1)) {
    const row = {};
    const values = [...cells.values()].map(value => String(value || '').trim());
    if (!values.some(Boolean)) continue;
    for (const [field, column] of Object.entries(detected.columns)) row[field] = cells.get(column) ?? null;
    if (row.date === null && row.value === null) continue;
    output.push(row);
  }
  return output;
}

async function workbookParts(filePath) {
  const entries = await listZipEntries(filePath, { maxEntries: 2_000 });
  const names = new Set(entries.map(entry => entry.name));
  if (!names.has('[Content_Types].xml') || !names.has('xl/workbook.xml') || !names.has('xl/_rels/workbook.xml.rels')) throw new TypeError('NAAIM import requires an Excel .xlsx workbook');
  if ([...names].some(name => /(^|\/)vbaProject\.bin$/i.test(name))) throw new TypeError('NAAIM workbook macros are not permitted');
  if ([...names].some(name => /^xl\/externalLinks\//i.test(name))) throw new TypeError('NAAIM workbook external links are not permitted');
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  const read = async name => (await readZipEntry(filePath, byName.get(name), { maxUncompressedBytes: MAX_WORKSHEET_BYTES })).toString('utf8');
  const relationNames = [...names].filter(name => /\.rels$/i.test(name));
  for (const name of relationNames) if (/TargetMode="External"/i.test(await read(name))) throw new TypeError('NAAIM workbook external links are not permitted');
  const sharedStrings = names.has('xl/sharedStrings.xml')
    ? [...(await read('xl/sharedStrings.xml')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => xmlText(match[1])) : [];
  const relationships = new Map([...((await read('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g))]
    .map(match => [match[1], `xl/${match[2].replace(/^\//, '')}`]));
  const sheets = [...(await read('xl/workbook.xml')).matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g)]
    .map(match => ({ name: xmlText(match[1]), path: relationships.get(match[2]) })).filter(sheet => sheet.path && byName.has(sheet.path));
  if (!sheets.length) throw new TypeError('NAAIM workbook contains no readable worksheets');
  return { read, sheets, sharedStrings };
}

async function inspectNaaimWorkbook(filePath) {
  const parts = await workbookParts(filePath);
  const sheetNames = parts.sheets.map(sheet => sheet.name);
  for (const sheet of parts.sheets) {
    const rows = parseSheetRows(await parts.read(sheet.path), parts.sharedStrings);
    try {
      const detected = detectColumns(rows);
      return { sheetNames, selectedSheet: sheet.name, detected, rows: rowsForColumns(rows, detected) };
    } catch (error) {
      if (!/missing explicit Date/.test(error.message)) throw error;
    }
  }
  throw new TypeError('NAAIM workbook is missing explicit Date and NAAIM mean exposure headers');
}

function validateStoredNaaim(model) {
  if (model?.metricId !== NAAIM_METRIC_ID || model.provider !== 'NAAIM' || model.frequency !== 'weekly' || model.networkFetchEnabled !== false) {
    throw new TypeError('Stored NAAIM history identity is invalid');
  }
  const normalized = normalizeNaaimRows(model.values, { now: new Date(`${model.lastDate}T23:59:59Z`) });
  if (model.firstDate !== normalized.diagnostics.firstDate || model.lastDate !== normalized.diagnostics.lastDate || model.rowCount !== normalized.diagnostics.rowCount) {
    throw new TypeError('Stored NAAIM metadata does not match its history');
  }
  return { ...model, values: normalized.values, validation: normalized.diagnostics, derived: normalized.derived };
}

async function assertLocalNaaimInput(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_WORKBOOK_BYTES) throw new RangeError('NAAIM workbook size is invalid');
}

module.exports = {
  CORE_HEADERS, MAX_WORKBOOK_BYTES, NAAIM_METRIC_ID, OPTIONAL_HEADERS,
  assertLocalNaaimInput, deriveNaaimStatistics, detectColumns, excelDate,
  inspectNaaimWorkbook, normalizeNaaimRows, normalizedHeader, validateStoredNaaim
};
