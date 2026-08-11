'use strict';

const { isIsoDate } = require('../market-data/schema');

const ALGORITHM_VERSIONS = Object.freeze({
  input: 'OHLCV-LOCAL-CSV-v1',
  ema: 'EMA-v1-SMOOTHED-INITIAL-SMA',
  rsi: 'RSI-v1-WILDER',
  macd: 'MACD-v1-EMA-12-26-9',
  volume: 'VOLUME-RELATIVE-v1-20D-MEAN-MEDIAN-PERCENTILE',
  returns: 'RETURN-DRAWDOWN-v1-TRADING-DAY',
  ftd: 'FTD-v1-CONFIGURABLE-RALLY-ATTEMPT',
  signals: 'SIGNALS-v1-PROVISIONAL-THRESHOLDS'
});

const DEFAULT_RULES = Object.freeze({
  rsi: { period: 14, overbought: 90, oversold: 22 },
  macd: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, minimumShrinkingStreak: 3 },
  volume: { lookback: 20, anomalyMultiplier: 2, percentileThreshold: 90, minimumPercentileHistory: 20 },
  returns: { lookback: 25 },
  drawdown: { lookbackTradingDays: 252 },
  followThroughDay: { rallyLowLookback: 10, candidateStartTradingDay: 4, candidateEndTradingDay: 7, minimumGainPercent: 1.25, volumeMultiplier: 1.1 }
});

function finite(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mergeRules(rules = {}) {
  return Object.fromEntries(Object.keys(DEFAULT_RULES).map(key => [key, { ...DEFAULT_RULES[key], ...(rules[key] || {}) }]));
}

function normalizeOhlcvSeries(input) {
  if (!Array.isArray(input)) throw new TypeError('OHLCV series must be an array');
  let previousDate = null;
  return input.map((point, index) => {
    if (!point || !isIsoDate(point.date)) throw new TypeError(`OHLCV row ${index + 1} has an invalid date`);
    if (previousDate && point.date <= previousDate) throw new TypeError('OHLCV series must be strictly ascending with no duplicate dates');
    previousDate = point.date;
    const adjustedClose = finite(point.adjustedClose ?? point.close ?? point.value);
    if (adjustedClose === null || adjustedClose <= 0) throw new TypeError('OHLCV series contains an invalid adjusted close');
    const hasOhlcv = point.hasOhlcv === false ? false : point.hasOhlcv === true ? true : ['open', 'high', 'low', 'close', 'volume'].some(field => point[field] !== undefined && point[field] !== null && String(point[field]).trim() !== '');
    const close = finite(point.close ?? adjustedClose);
    const open = finite(point.open ?? (hasOhlcv ? null : adjustedClose));
    const high = finite(point.high ?? (hasOhlcv ? null : adjustedClose));
    const low = finite(point.low ?? (hasOhlcv ? null : adjustedClose));
    const volume = finite(point.volume);
    if (hasOhlcv) {
      if ([open, high, low, close, volume].some(value => value === null)) throw new TypeError('OHLCV row is missing a finite open/high/low/close/volume value');
      if ([open, high, low, close].some(value => value <= 0) || volume < 0) throw new TypeError('OHLCV row contains an invalid price or volume');
      if (high < Math.max(open, close) || low > Math.min(open, close)) throw new TypeError('OHLCV row violates high/low price bounds');
    }
    const asOf = point.asOf ?? point.date;
    if (!isIsoDate(asOf)) throw new TypeError('OHLCV row has an invalid asOf date');
    return {
      ticker: point.ticker ? String(point.ticker).trim().toUpperCase() : null,
      date: point.date,
      open,
      high,
      low,
      close,
      adjustedClose,
      volume: hasOhlcv ? volume : null,
      source: point.source ?? point.sourceName ?? null,
      asOf,
      hasOhlcv
    };
  });
}

function seriesDiagnostics(series) {
  const gaps = [];
  for (let index = 1; index < series.length; index += 1) {
    const days = (new Date(`${series[index].date}T00:00:00Z`) - new Date(`${series[index - 1].date}T00:00:00Z`)) / 86_400_000;
    if (days > 4) gaps.push({ from: series[index - 1].date, to: series[index].date, days });
  }
  const missingVolumeCount = series.filter(point => point.volume === null).length;
  return {
    observationCount: series.length,
    inputStart: series[0]?.date || null,
    inputEnd: series.at(-1)?.date || null,
    gapCount: gaps.length,
    largestGapDays: gaps.length ? Math.max(...gaps.map(item => item.days)) : 0,
    missingVolumeCount,
    missingOhlcvCount: series.filter(point => !point.hasOhlcv).length,
    gapDetails: gaps,
    qualityFlags: [
      ...(missingVolumeCount ? ['volume_missing_for_some_observations'] : []),
      ...(gaps.length ? ['calendar_gaps_detected_without_imputation'] : [])
    ],
    priceBasis: 'adjusted_close'
  };
}

function numericSeries(input, valueKey = 'adjustedClose') {
  return input.map(point => ({ date: point.date, value: finite(point[valueKey]) })).filter(point => point.value !== null);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function emaSeries(input, period) {
  if (!Number.isInteger(period) || period < 1) throw new TypeError('EMA period must be a positive integer');
  const series = Array.isArray(input) && input[0]?.value !== undefined ? input : numericSeries(input);
  if (series.length < period) return [];
  const result = [];
  let previous = mean(series.slice(0, period).map(point => point.value));
  result.push({ date: series[period - 1].date, value: previous });
  const alpha = 2 / (period + 1);
  for (let index = period; index < series.length; index += 1) {
    previous = (series[index].value - previous) * alpha + previous;
    result.push({ date: series[index].date, value: previous });
  }
  return result;
}

function rsiSeries(input, period = 14) {
  if (!Number.isInteger(period) || period < 1) throw new TypeError('RSI period must be a positive integer');
  const series = numericSeries(input);
  if (series.length <= period) return [];
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = series[index].value - series[index - 1].value;
    averageGain += Math.max(0, change);
    averageLoss += Math.max(0, -change);
  }
  averageGain /= period;
  averageLoss /= period;
  const valueFor = () => averageLoss === 0 ? (averageGain === 0 ? 50 : 100) : 100 - (100 / (1 + averageGain / averageLoss));
  const result = [{ date: series[period].date, value: valueFor() }];
  for (let index = period + 1; index < series.length; index += 1) {
    const change = series[index].value - series[index - 1].value;
    averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period;
    result.push({ date: series[index].date, value: valueFor() });
  }
  return result;
}

function macdSeries(input, options = {}) {
  const fastPeriod = options.fastPeriod || 12;
  const slowPeriod = options.slowPeriod || 26;
  const signalPeriod = options.signalPeriod || 9;
  const series = numericSeries(input);
  const fast = new Map(emaSeries(series, fastPeriod).map(point => [point.date, point.value]));
  const slow = emaSeries(series, slowPeriod);
  const macdLines = slow.map(point => ({ date: point.date, value: fast.get(point.date) === undefined ? null : fast.get(point.date) - point.value })).filter(point => point.value !== null);
  const signal = new Map(emaSeries(macdLines, signalPeriod).map(point => [point.date, point.value]));
  return macdLines.map(point => ({
    date: point.date,
    macd: point.value,
    signal: signal.get(point.date) ?? null,
    histogram: signal.has(point.date) ? point.value - signal.get(point.date) : null
  }));
}

function volumeRelativeSeries(input, options = {}) {
  const lookback = options.lookback || 20;
  const minimumPercentileHistory = options.minimumPercentileHistory || lookback;
  const result = [];
  for (let index = lookback; index < input.length; index += 1) {
    const volume = input[index].volume;
    const prior = input.slice(Math.max(0, index - lookback), index).map(point => point.volume).filter(Number.isFinite);
    if (!Number.isFinite(volume) || prior.length < lookback) continue;
    const average20 = mean(prior);
    const median20 = median(prior);
    const percentileHistory = input.slice(0, index).map(point => point.volume).filter(Number.isFinite).slice(-252);
    const percentile = percentileHistory.length >= minimumPercentileHistory
      ? percentileHistory.filter(value => value <= volume).length / percentileHistory.length * 100
      : null;
    result.push({ date: input[index].date, value: average20 ? volume / average20 : null, volume, average20, median20, relativeMean: average20 ? volume / average20 : null, relativeMedian: median20 ? volume / median20 : null, percentile });
  }
  return result.filter(point => point.value !== null);
}

function returnSeries(input, lookback) {
  const series = numericSeries(input);
  if (!Number.isInteger(lookback) || lookback < 1) throw new TypeError('return lookback must be a positive integer');
  return series.slice(lookback).map((point, index) => ({ date: point.date, value: (point.value / series[index].value - 1) * 100 }));
}

function drawdownSeries(input, lookback = 252) {
  const series = numericSeries(input);
  let peak = -Infinity;
  const history = series.map(point => {
    peak = Math.max(peak, point.value);
    return { date: point.date, value: (point.value / peak - 1) * 100 };
  });
  const recent = series.slice(-lookback);
  let recentPeak = -Infinity;
  let minimum = 0;
  for (const point of recent) {
    recentPeak = Math.max(recentPeak, point.value);
    minimum = Math.min(minimum, (point.value / recentPeak - 1) * 100);
  }
  return { history, current: history.at(-1)?.value ?? null, maximum: recent.length >= 2 ? Math.abs(minimum) : null };
}

function relativeStrengthSeries(soxxInput, qqqInput, lookback = 60) {
  const soxx = new Map(numericSeries(soxxInput).map(point => [point.date, point.value]));
  const qqq = new Map(numericSeries(qqqInput).map(point => [point.date, point.value]));
  const commonDates = [...soxx.keys()].filter(date => qqq.has(date)).sort();
  return commonDates.slice(lookback).map((date, index) => {
    const priorDate = commonDates[index];
    const soxxReturn = (soxx.get(date) / soxx.get(priorDate) - 1) * 100;
    const qqqReturn = (qqq.get(date) / qqq.get(priorDate) - 1) * 100;
    return { date, value: soxxReturn - qqqReturn };
  });
}

function positiveDuration(history, index) {
  let duration = 0;
  for (let cursor = index; cursor >= 0 && Number(history[cursor]?.histogram) > 0; cursor -= 1) duration += 1;
  return duration;
}

function histogramStats(history, minimumShrinkingStreak = 3) {
  const usable = history.filter(point => Number.isFinite(point.histogram));
  const current = usable.at(-1) || null;
  if (!current) return { current: null, shrinkingStreak: null, positiveDuration: null, previousPositiveDuration: null, histogramChange: null, durationChange: null, triggered: null };
  let shrinkingStreak = 0;
  for (let index = usable.length - 1; index > 0; index -= 1) {
    if (usable[index].histogram > 0 && usable[index].histogram < usable[index - 1].histogram) shrinkingStreak += 1;
    else break;
  }
  const currentIndex = usable.length - 1;
  const duration = positiveDuration(usable, currentIndex);
  const priorIndex = currentIndex - duration;
  const previousDuration = priorIndex >= 0 && usable[priorIndex].histogram > 0 ? positiveDuration(usable, priorIndex) : 0;
  const histogramChange = usable.length > 1 ? current.histogram - usable.at(-2).histogram : null;
  const durationChange = duration - previousDuration;
  return { current: current.histogram, macd: current.macd, signal: current.signal, shrinkingStreak, positiveDuration: duration, previousPositiveDuration: previousDuration, histogramChange, durationChange, triggered: shrinkingStreak >= minimumShrinkingStreak || (current.histogram > 0 && durationChange < 0) };
}

function localLowIndex(series, lookback) {
  for (let index = series.length - 1; index >= lookback; index -= 1) {
    const prior = series.slice(index - lookback, index).map(point => point.adjustedClose);
    if (prior.length === lookback && series[index].adjustedClose <= Math.min(...prior)) return index;
  }
  return -1;
}

function followThroughDay(input, options = {}) {
  const series = normalizeOhlcvSeries(input);
  const candidateStart = options.candidateStartTradingDay || 4;
  const candidateEnd = options.candidateEndTradingDay || 7;
  const lookback = options.rallyLowLookback || 10;
  if (series.length < lookback + candidateStart) return { algorithmVersion: ALGORITHM_VERSIONS.ftd, status: 'insufficient_coverage', value: null, asOf: series.at(-1)?.date || null, history: [], candidates: [], invalidationReason: 'not_enough_observations' };
  const attemptIndex = localLowIndex(series, lookback);
  if (attemptIndex < 0) return { algorithmVersion: ALGORITHM_VERSIONS.ftd, status: 'no_rally_attempt', value: null, asOf: series.at(-1)?.date || null, history: [], candidates: [], invalidationReason: 'no_local_rally_attempt_low' };
  const day1 = series[attemptIndex];
  const candidates = [];
  let invalidationReason = null;
  for (let index = attemptIndex + 1; index < series.length; index += 1) {
    if (series[index].adjustedClose < day1.adjustedClose) {
      invalidationReason = `close_below_day1_low:${series[index].date}`;
      break;
    }
    const tradingDay = index - attemptIndex;
    if (tradingDay < candidateStart || tradingDay > candidateEnd) continue;
    const previous = series[index - 1];
    const gainPercent = (series[index].adjustedClose / day1.adjustedClose - 1) * 100;
    const volumeConfirmed = Number.isFinite(series[index].volume) && Number.isFinite(previous.volume)
      ? series[index].volume >= previous.volume * (options.volumeMultiplier || 1)
      : null;
    candidates.push({ date: series[index].date, tradingDay, gainPercent, volumeConfirmed, meetsGain: gainPercent >= (options.minimumGainPercent || 0), close: series[index].adjustedClose, volume: series[index].volume });
    if (gainPercent >= (options.minimumGainPercent || 0) && volumeConfirmed === true) {
      const history = [{ date: series[index].date, value: 1 }];
      return { algorithmVersion: ALGORITHM_VERSIONS.ftd, status: 'confirmed', value: 1, asOf: series.at(-1).date, rallyAttemptDate: day1.date, day1Low: day1.adjustedClose, candidateWindow: { start: series[attemptIndex + candidateStart]?.date || null, end: series[attemptIndex + candidateEnd]?.date || null }, candidates, confirmedDate: series[index].date, gainPercent, volumeConfirmed: true, invalidationReason: null, history };
    }
  }
  const latestTradingDay = series.length - 1 - attemptIndex;
  const status = invalidationReason ? 'invalidated' : latestTradingDay < candidateStart ? 'candidate_window_pending' : latestTradingDay <= candidateEnd ? 'candidate_window' : 'not_confirmed';
  return { algorithmVersion: ALGORITHM_VERSIONS.ftd, status, value: status === 'candidate_window' || status === 'candidate_window_pending' ? 0 : null, asOf: series.at(-1).date, rallyAttemptDate: day1.date, day1Low: day1.adjustedClose, candidateWindow: { start: series[attemptIndex + candidateStart]?.date || null, end: series[attemptIndex + candidateEnd]?.date || null }, candidates, confirmedDate: null, gainPercent: candidates.at(-1)?.gainPercent ?? null, volumeConfirmed: candidates.at(-1)?.volumeConfirmed ?? null, invalidationReason: invalidationReason || (status === 'not_confirmed' ? 'candidate_window_ended_without_confirmation' : null), history: [] };
}

function signalResult(value, evidence, trigger) {
  return { value: value === null ? null : value ? 1 : 0, triggered: value === null ? null : Boolean(value), signalState: value === null ? 'unavailable' : value ? 'triggered' : 'clear', evidence, trigger };
}

function calculateTechnicalIndicators(qqqInput, soxxInput = [], options = {}) {
  const rules = mergeRules(options.rules);
  const qqq = normalizeOhlcvSeries(qqqInput);
  const soxx = Array.isArray(soxxInput) ? normalizeOhlcvSeries(soxxInput) : [];
  const quality = seriesDiagnostics(qqq);
  const asOf = qqq.at(-1)?.date || null;
  const ema = Object.fromEntries([5, 20, 60, 200].map(period => [period, emaSeries(qqq, period)]));
  const rsi = rsiSeries(qqq, rules.rsi.period);
  const macd = macdSeries(qqq, rules.macd);
  const volume = volumeRelativeSeries(qqq, rules.volume);
  const returns25 = returnSeries(qqq, rules.returns.lookback);
  const drawdown = drawdownSeries(qqq, rules.drawdown.lookbackTradingDays);
  const relativeStrength = relativeStrengthSeries(soxx, qqq, 60);
  const rsiValue = rsi.at(-1)?.value ?? null;
  const volumeCurrent = volume.at(-1) || null;
  const macdStats = histogramStats(macd, rules.macd.minimumShrinkingStreak);
  const ftd = followThroughDay(qqq, rules.followThroughDay);
  const topRsi = signalResult(rsiValue === null ? null : rsiValue >= rules.rsi.overbought, `RSI ${rsiValue === null ? 'unavailable' : rsiValue.toFixed(2)} vs provisional threshold ${rules.rsi.overbought}`, `RSI >= ${rules.rsi.overbought}`);
  const volumeTriggered = volumeCurrent === null ? null : volumeCurrent.relativeMean >= rules.volume.anomalyMultiplier || (volumeCurrent.percentile !== null && volumeCurrent.percentile >= rules.volume.percentileThreshold);
  const topVolume = signalResult(volumeTriggered, volumeCurrent === null ? '20-day volume statistics unavailable' : `relative mean ${volumeCurrent.relativeMean.toFixed(2)}x; median ${volumeCurrent.relativeMedian?.toFixed(2) || '—'}x; percentile ${volumeCurrent.percentile === null ? '—' : volumeCurrent.percentile.toFixed(1)}`, `relative mean >= ${rules.volume.anomalyMultiplier}x or percentile >= ${rules.volume.percentileThreshold}`);
  const topMacd = signalResult(macdStats.triggered === null ? null : macdStats.triggered, macdStats.current === null ? 'MACD histogram unavailable' : `histogram ${macdStats.current.toFixed(4)}; shrinking streak ${macdStats.shrinkingStreak}; positive duration ${macdStats.positiveDuration}; prior duration ${macdStats.previousPositiveDuration}`, `shrinking streak >= ${rules.macd.minimumShrinkingStreak} or positive duration shortened`);
  const bottomRsi = signalResult(rsiValue === null ? null : rsiValue <= rules.rsi.oversold, `RSI ${rsiValue === null ? 'unavailable' : rsiValue.toFixed(2)} vs provisional threshold ${rules.rsi.oversold}`, `RSI <= ${rules.rsi.oversold}`);
  const bottomVolume = signalResult(volumeTriggered, topVolume.evidence, topVolume.trigger);
  const histories = {
    'qqq-ema-5': ema[5],
    'qqq-ema-20': ema[20],
    'qqq-ema-60': ema[60],
    'qqq-ema-200': ema[200],
    'qqq-rsi': rsi,
    'qqq-macd': macd.filter(point => point.macd !== null).map(point => ({ date: point.date, value: point.macd })),
    'qqq-macd-histogram': macd.filter(point => point.histogram !== null).map(point => ({ date: point.date, value: point.histogram })),
    'qqq-volume-relative': volume.map(point => ({ date: point.date, value: point.relativeMean })),
    'qqq-return-25': returns25,
    'qqq-current-drawdown': drawdown.history,
    'soxx-relative-qqq': relativeStrength
  };
  const qqqValues = numericSeries(qqq);
  const buildRolling = (lookback, calculator) => qqqValues.slice(lookback).map((point, index) => ({ date: point.date, value: calculator(qqqValues.slice(0, index + lookback + 1)) })).filter(point => point.value !== null);
  histories['qqq-vs-ma200'] = buildRolling(199, values => {
    const sample = values.slice(-200).map(item => item.value);
    return sample.length === 200 ? (sample.at(-1) / mean(sample) - 1) * 100 : null;
  });
  histories['qqq-momentum-20'] = returnSeries(qqq, 20);
  histories['qqq-momentum-120'] = returnSeries(qqq, 120);
  histories['qqq-52w-high-distance'] = buildRolling(199, values => {
    const sample = values.slice(-252).map(item => item.value);
    return sample.length >= 200 ? (sample.at(-1) / Math.max(...sample) - 1) * 100 : null;
  });
  histories['qqq-52w-max-drawdown'] = buildRolling(1, values => drawdownSeries(values.map(item => ({ date: item.date, adjustedClose: item.value })), 252).maximum);
  histories['qqq-current-drawdown'] = drawdown.history;
  return {
    algorithmVersion: ALGORITHM_VERSIONS.signals,
    inputAlgorithmVersion: ALGORITHM_VERSIONS.input,
    asOf,
    qqq,
    soxx,
    quality,
    ema,
    rsi: { period: rules.rsi.period, value: rsiValue, history: rsi, thresholdStatus: 'provisional' },
    macd: { fastPeriod: rules.macd.fastPeriod, slowPeriod: rules.macd.slowPeriod, signalPeriod: rules.macd.signalPeriod, value: macd.at(-1)?.macd ?? null, signal: macd.at(-1)?.signal ?? null, histogram: macdStats, history: macd },
    volume: { lookback: rules.volume.lookback, current: volumeCurrent, history: volume, thresholdStatus: 'provisional' },
    returns: { lookback: rules.returns.lookback, value: returns25.at(-1)?.value ?? null, history: returns25 },
    drawdown: { current: drawdown.current, maximum52Week: drawdown.maximum, history: drawdown.history },
    relativeStrength: { lookback: 60, value: relativeStrength.at(-1)?.value ?? null, history: relativeStrength },
    followThroughDay: ftd,
    signals: {
      'top-risk-rsi': topRsi,
      'top-risk-volume': topVolume,
      'top-risk-macd': topMacd,
      'bottom-candidate-rsi': bottomRsi,
      'bottom-candidate-volume': bottomVolume
    },
    histories,
    rules
  };
}

module.exports = {
  ALGORITHM_VERSIONS,
  DEFAULT_RULES,
  calculateTechnicalIndicators,
  drawdownSeries,
  emaSeries,
  followThroughDay,
  histogramStats,
  macdSeries,
  median,
  mergeRules,
  normalizeOhlcvSeries,
  numericSeries,
  relativeStrengthSeries,
  returnSeries,
  rsiSeries,
  seriesDiagnostics,
  volumeRelativeSeries
};
