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

function parseSeriesDate(value) {
  const text = String(value).trim();
  if (/^\d{10,13}$/.test(text)) {
    const raw = Number(text);
    const date = new Date(text.length === 10 ? raw * 1000 : raw);
    return Number.isFinite(date.valueOf()) ? date.toISOString().slice(0, 10) : null;
  }
  if (/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(text)) {
    const date = new Date(text);
    return Number.isFinite(date.valueOf()) ? date.toISOString().slice(0, 10) : null;
  }
  return parseDate(text);
}

function normalizePublishedSeries(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 5000) return null;
  const byDate = new Map();
  for (const point of points) {
    const date = parseSeriesDate(point.date);
    const value = Number(point.value);
    if (!date || !Number.isFinite(value) || value <= 0 || value >= 500) return null;
    if (byDate.has(date) && byDate.get(date) !== value) return null;
    byDate.set(date, value);
  }
  const normalized = [...byDate].map(([date, value]) => ({ date, value })).sort((left, right) => left.date.localeCompare(right.date));
  return normalized.length >= 3 ? normalized : null;
}

function parseQuotedList(value) {
  return [...String(value).matchAll(/["']([^"']+)["']/g)].map(match => match[1]);
}

function parseNumberList(value) {
  const tokens = String(value).split(',').map(token => token.trim());
  if (!tokens.length || tokens.some(token => !/^-?\d+(?:\.\d+)?$/.test(token))) return [];
  return tokens.map(Number);
}

function extractPublishedHistorySeries(html) {
  const candidates = [];
  const scripts = [...String(html || '').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  for (const script of scripts) {
    if (!/(?:nasdaq|qqq|p\s*\/?\s*e|price[-\s]?to[-\s]?earnings)/i.test(script)) continue;

    const pairs = [];
    const pairPattern = /\[\s*["']([^"']+)["']\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g;
    for (const match of script.matchAll(pairPattern)) pairs.push({ date: match[1], value: match[2] });
    const normalizedPairs = normalizePublishedSeries(pairs);
    if (normalizedPairs) candidates.push(normalizedPairs);

    const objects = [];
    const objectPattern = /(?:date|time|x)\s*:\s*["']([^"']+)["'][^{}]{0,120}?(?:pe|value|y)\s*:\s*(-?\d+(?:\.\d+)?)/gi;
    for (const match of script.matchAll(objectPattern)) objects.push({ date: match[1], value: match[2] });
    const normalizedObjects = normalizePublishedSeries(objects);
    if (normalizedObjects) candidates.push(normalizedObjects);

    const labelsPattern = /labels\s*:\s*\[([^\]]+)\][\s\S]{0,2500}?data\s*:\s*\[([^\]]+)\]/gi;
    for (const match of script.matchAll(labelsPattern)) {
      const labels = parseQuotedList(match[1]);
      const values = parseNumberList(match[2]);
      if (labels.length !== values.length) continue;
      const normalized = normalizePublishedSeries(labels.map((date, index) => ({ date, value: values[index] })));
      if (normalized) candidates.push(normalized);
    }
  }

  const unique = new Map(candidates.map(points => [JSON.stringify(points), points]));
  if (unique.size > 1) return { status: 'ambiguous', points: [] };
  if (unique.size === 1) return { status: 'full_series_available', points: [...unique.values()][0] };
  return { status: 'unavailable', points: [] };
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
  for (const period of [1, 5, 10, 20]) {
    const match = new RegExp(`Last ${period}Y\\s+([0-9]+(?:\\.[0-9]+)?)\\s+([0-9]+(?:\\.[0-9]+)?)`, 'i').exec(text);
    historical[`${period}Y`] = match ? { mean: Number(match[1]), stdDev: Number(match[2]), fragment: match[0] } : null;
  }
  const valuationMatch = /current P\/E can be considered\s+(Fair|Overvalued|Expensive|Undervalued|Cheap)/i.exec(text);
  const deviationMatch = /deviation from (?:the )?mean(?: P\/E)?\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)%/i.exec(text);
  const publishedHistory = extractPublishedHistorySeries(html);
  if (publishedHistory.status === 'ambiguous') throw extractionError('ambiguous', ['multiple_published_history_series']);
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
    historicalStats: Object.fromEntries(Object.entries(historical).map(([key, value]) => [key.toLowerCase(), value ? { mean: value.mean, stdDev: value.stdDev } : null])),
    valuationLabel: valuationMatch?.[1] || null,
    deviationFromMean: deviationMatch ? Number(deviationMatch[1]) : null,
    publishedHistory: publishedHistory.points,
    seriesAvailability: publishedHistory.status === 'full_series_available'
      ? 'full_series_available'
      : Object.values(historical).some(Boolean) ? 'summary_statistics_only' : 'unavailable',
    fieldMetadata: fields,
    validationWarnings: warnings
  };
}

module.exports = { extractPublishedHistorySeries, extractWorldPERatio, parseDate, parseSeriesDate, sha256, visibleText };
