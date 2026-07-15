'use strict';

const { normalizePrices } = require('./realized-volatility');

const ALGORITHM_VERSION = 'RISK-SIGNAL-MAPPINGS-v1-LINEAR';

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function linearScore(value, low, high) {
  if (!Number.isFinite(value) || !(high > low)) return null;
  return clamp((value - low) / (high - low) * 100);
}

function returnPercent(prices, lookback) {
  if (prices.length < lookback + 1) return null;
  return (prices.at(-1).adjustedClose / prices.at(-(lookback + 1)).adjustedClose - 1) * 100;
}

function calculateMarketSignals(qqqInput, soxxInput = []) {
  const qqq = normalizePrices(qqqInput);
  const soxx = Array.isArray(soxxInput) && soxxInput.length >= 2 ? normalizePrices(soxxInput) : [];
  const current = qqq.at(-1);
  const recent200 = qqq.slice(-200);
  const ma200 = recent200.length === 200 ? recent200.reduce((sum, point) => sum + point.adjustedClose, 0) / 200 : null;
  const priceVsMa200Percent = ma200 ? (current.adjustedClose / ma200 - 1) * 100 : null;
  const momentum20 = returnPercent(qqq, 20);
  const momentum120 = returnPercent(qqq, 120);
  const momentumBlend = momentum20 === null || momentum120 === null ? null : (momentum20 + momentum120) / 2;
  const recent252 = qqq.slice(-252);
  const high52w = recent252.length >= 200 ? Math.max(...recent252.map(point => point.adjustedClose)) : null;
  const distance52wHighPercent = high52w ? (current.adjustedClose / high52w - 1) * 100 : null;
  let peak = -Infinity;
  let maxDrawdownPercent = null;
  if (recent252.length >= 2) {
    let minimum = 0;
    for (const point of recent252) {
      peak = Math.max(peak, point.adjustedClose);
      minimum = Math.min(minimum, (point.adjustedClose / peak - 1) * 100);
    }
    maxDrawdownPercent = Math.abs(minimum);
  }
  const qqq60 = returnPercent(qqq, 60);
  const soxx60 = soxx.length ? returnPercent(soxx, 60) : null;
  const relativeStrengthPercent = qqq60 === null || soxx60 === null ? null : soxx60 - qqq60;
  const asOf = current.date;
  return {
    algorithmVersion: ALGORITHM_VERSION,
    asOf,
    metrics: { ma200, priceVsMa200Percent, momentum20, momentum120, momentumBlend, high52w, distance52wHighPercent, maxDrawdownPercent, relativeStrengthPercent },
    scores: {
      'qqq-vs-ma200': priceVsMa200Percent === null ? null : linearScore(priceVsMa200Percent, -20, 20),
      'qqq-momentum': momentumBlend === null ? null : linearScore(momentumBlend, -20, 20),
      'qqq-distance-52w-high': distance52wHighPercent === null ? null : linearScore(distance52wHighPercent, -30, 0),
      'qqq-max-drawdown': maxDrawdownPercent === null ? null : linearScore(maxDrawdownPercent, 0, 40),
      'soxx-relative-qqq': relativeStrengthPercent === null ? null : linearScore(relativeStrengthPercent, -20, 20)
    }
  };
}

module.exports = { ALGORITHM_VERSION, calculateMarketSignals, clamp, linearScore, returnPercent };
