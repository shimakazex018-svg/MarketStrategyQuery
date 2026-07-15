'use strict';

const crypto = require('crypto');

const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxRows: 10_000,
  maxFieldLength: 4_096
});

function parseCsv(input, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input ?? '');
  if (!text.trim()) throw new TypeError('CSV is empty');
  if (Buffer.byteLength(text, 'utf8') > limits.maxBytes) throw new RangeError('CSV exceeds maxBytes');
  if (text.includes('\0')) throw new TypeError('CSV contains a NUL byte');

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;

  const pushField = () => {
    if (field.length > limits.maxFieldLength) throw new RangeError('CSV field exceeds maxFieldLength');
    row.push(field);
    field = '';
    afterQuote = false;
  };
  const pushRow = () => {
    pushField();
    if (row.some(value => value.trim() !== '')) rows.push(row);
    row = [];
    if (rows.length - 1 > limits.maxRows) throw new RangeError('CSV exceeds maxRows');
  };

  const normalized = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (quoted) {
      if (char === '"' && normalized[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        field += char;
      }
      continue;
    }
    if (afterQuote && ![',', '\r', '\n'].includes(char) && !/\s/.test(char)) {
      throw new TypeError('CSV has characters after a closing quote');
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === ',') pushField();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && normalized[index + 1] === '\n') index += 1;
      pushRow();
    } else if (!afterQuote || !/\s/.test(char)) field += char;
  }
  if (quoted) throw new TypeError('CSV has an unclosed quoted field');
  if (field !== '' || row.length) pushRow();
  if (rows.length < 2) throw new TypeError('CSV must contain a header and at least one data row');

  const headers = rows.shift().map(value => value.trim());
  if (headers.some(header => !header)) throw new TypeError('CSV contains an empty header');
  if (new Set(headers).size !== headers.length) throw new TypeError('CSV contains duplicate headers');
  for (const required of options.requiredHeaders || []) {
    if (!headers.includes(required)) throw new TypeError(`CSV is missing required header ${required}`);
  }

  const records = rows.map((values, rowIndex) => {
    if (values.length !== headers.length) throw new TypeError(`CSV row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index].trim()]));
  });
  return { headers, records };
}

function importManifest(input, { importedAt = new Date(), sourceName, rowCount }) {
  if (typeof sourceName !== 'string' || !sourceName.trim()) throw new TypeError('sourceName is required');
  const text = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ''), 'utf8');
  return {
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    importedAt: (importedAt instanceof Date ? importedAt : new Date(importedAt)).toISOString(),
    sourceName: sourceName.trim(),
    rowCount
  };
}

module.exports = { DEFAULT_LIMITS, importManifest, parseCsv };

