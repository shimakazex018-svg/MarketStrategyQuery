'use strict';

const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function visibleText(html) {
  return decodeEntities(String(html || '')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(value) {
  const match = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(String(value).trim());
  if (!match) return null;
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const month = months.indexOf(match[2].toLowerCase());
  if (month < 0) return null;
  const day = Number(match[1]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function uniqueCandidates(matches) {
  const seen = new Map();
  for (const match of matches) seen.set(`${match.value}|${match.date}`, match);
  return [...seen.values()];
}

function fieldMetadata({ value, label, sourceDataDate, extractedAt, sourceUrl, extractionMethod, fragment }) {
  return {
    value,
    unit: 'x',
    label,
    sourceDataDate,
    extractedAt,
    sourceUrl,
    extractionMethod,
    confidence: 'high',
    rawTextFragmentHash: sha256(fragment)
  };
}

function extractionError(type, warnings) {
  const error = new Error(type);
  error.webPageType = type;
  error.validationWarnings = warnings;
  return error;
}

function extractWorldPERatio(html, { sourceUrl, extractedAt = new Date().toISOString() } = {}) {
  const text = visibleText(html);
  const warnings = [];
  if (!/P\/E Ratio\s+[0-9]+(?:\.[0-9]+)?/i.test(text)
      && /<script\b/i.test(String(html))
      && /(?:id=["'](?:root|app)["']|enable javascript|__next_data__)/i.test(String(html))) {
    throw extractionError('browser-required', ['server_html_missing_public_values']);
  }
  if (!/Nasdaq\s*-?\s*100\s+Index/i.test(text) || !/QQQ\s+Etf/i.test(text)) {
    throw extractionError('target-not-found', ['target_nasdaq_100_or_qqq_not_confirmed']);
  }

  const candidates = [];
  const patterns = [
    /P\/E Ratio\s+([0-9]+(?:\.[0-9]+)?)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/gi,
    /estimated Price-to-Earnings \(P\/E\) Ratio for Nasdaq\s*-?\s*100 Index is\s+([0-9]+(?:\.[0-9]+)?), calculated on\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) candidates.push({ value: Number(match[1]), date: parseDate(match[2]), fragment: match[0] });
  }
  const unique = uniqueCandidates(candidates);
  if (!unique.length) {
    if (/P\/E Ratio\s+[0-9]+(?:\.[0-9]+)?/i.test(text)) {
      throw extractionError('date-missing', ['source_data_date_missing']);
    }
    throw extractionError('source-changed', ['current_pe_selector_missing']);
  }
  if (unique.length > 1) throw extractionError('ambiguous', ['multiple_current_pe_candidates']);
  const current = unique[0];
  if (!current.date) throw extractionError('date-missing', ['source_data_date_missing']);
  if (!Number.isFinite(current.value) || current.value <= 0 || current.value >= 500) {
    throw extractionError('invalid-value', ['current_pe_out_of_range']);
  }

  const historical = {};
  for (const period of [5, 10, 20]) {
    const match = new RegExp(`Last ${period}Y\\s+([0-9]+(?:\\.[0-9]+)?)\\s+([0-9]+(?:\\.[0-9]+)?)`, 'i').exec(text);
    historical[`${period}Y`] = match ? { mean: Number(match[1]), stdDev: Number(match[2]), fragment: match[0] } : null;
  }
  const valuationMatch = /current P\/E can be considered\s+(Fair|Overvalued|Expensive|Undervalued|Cheap)/i.exec(text);
  const fields = {
    currentPE: fieldMetadata({ value: current.value, label: 'Current P/E Ratio', sourceDataDate: current.date, extractedAt, sourceUrl, extractionMethod: 'server-rendered-html', fragment: current.fragment })
  };
  if (historical['5Y']) {
    fields.historicalMean = fieldMetadata({ value: historical['5Y'].mean, label: 'Last 5Y Average P/E', sourceDataDate: current.date, extractedAt, sourceUrl, extractionMethod: 'server-rendered-html', fragment: historical['5Y'].fragment });
    fields.historicalStdDev = fieldMetadata({ value: historical['5Y'].stdDev, label: 'Last 5Y P/E Standard Deviation', sourceDataDate: current.date, extractedAt, sourceUrl, extractionMethod: 'server-rendered-html', fragment: historical['5Y'].fragment });
  }

  return {
    target: 'Nasdaq-100 reference calculated on QQQ ETF',
    sourceDataDate: current.date,
    currentPE: current.value,
    historicalMean: historical['5Y']?.mean ?? null,
    historicalMedian: null,
    historicalStdDev: historical['5Y']?.stdDev ?? null,
    historicalRanges: Object.fromEntries(Object.entries(historical).map(([key, value]) => [key, value ? { mean: value.mean, stdDev: value.stdDev } : null])),
    valuationLabel: valuationMatch?.[1] || null,
    fieldMetadata: fields,
    validationWarnings: warnings
  };
}

module.exports = { extractWorldPERatio, parseDate, sha256, visibleText };
