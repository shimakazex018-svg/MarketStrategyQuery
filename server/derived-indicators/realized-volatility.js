'use strict';

const { isIsoDate } = require('../market-data/schema');

const ALGORITHM_VERSION = 'REALIZED-VOLATILITY-v1-ADJUSTED-CLOSE';

function normalizePrices(prices) {
  if (!Array.isArray(prices) || prices.length < 2) throw new TypeError('price series requires at least two observations');
  let previousDate = null;
  return prices.map(point => {
    if (!point || !isIsoDate(point.date)) throw new TypeError('price series contains an invalid date');
    if (previousDate && point.date <= previousDate) throw new TypeError('price series must be strictly ascending with no duplicate dates');
    previousDate = point.date;
    const adjustedClose = Number(point.adjustedClose ?? point.value);
    if (!Number.isFinite(adjustedClose) || adjustedClose <= 0) throw new TypeError('price series contains an invalid adjusted close');
    return { date: point.date, adjustedClose };
  });
}

function sampleStandardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function calculateWindow(prices, window, annualization = 252) {
  if (!Number.isInteger(window) || window < 2) throw new TypeError('volatility window must be an integer of at least 2');
  if (prices.length < window + 1) return null;
  const sample = prices.slice(-(window + 1));
  const returns = [];
  for (let index = 1; index < sample.length; index += 1) {
    returns.push(Math.log(sample[index].adjustedClose / sample[index - 1].adjustedClose));
  }
  return sampleStandardDeviation(returns) * Math.sqrt(annualization) * 100;
}

function calculateRealizedVolatility(input, options = {}) {
  const prices = normalizePrices(input);
  const windows = options.windows || [10, 20, 60];
  const annualization = options.annualization || 252;
  const values = Object.fromEntries(windows.map(window => [`rv${window}`, calculateWindow(prices, window, annualization)]));
  const gapCount = prices.slice(1).filter((point, index) => {
    const days = (new Date(`${point.date}T00:00:00Z`) - new Date(`${prices[index].date}T00:00:00Z`)) / 86_400_000;
    return days > 4;
  }).length;
  return {
    status: values.rv20 === null ? 'insufficient_coverage' : (options.validStatus || 'demo'),
    value: values.rv20,
    values,
    algorithmVersion: ALGORITHM_VERSION,
    priceBasis: 'adjusted_close',
    annualization,
    observationCount: prices.length,
    inputStart: prices[0].date,
    inputEnd: prices.at(-1).date,
    gapCount,
    missingDatePolicy: 'use_observed_trading_days_without_imputation',
    calculatedAt: (options.calculatedAt instanceof Date ? options.calculatedAt : new Date(options.calculatedAt || Date.now())).toISOString()
  };
}

function rollingRealizedVolatility(input, window = 20, annualization = 252) {
  const prices = normalizePrices(input);
  const history = [];
  for (let index = window; index < prices.length; index += 1) {
    const value = calculateWindow(prices.slice(0, index + 1), window, annualization);
    history.push({ date: prices[index].date, value });
  }
  return history;
}

module.exports = {
  ALGORITHM_VERSION,
  calculateRealizedVolatility,
  normalizePrices,
  rollingRealizedVolatility,
  sampleStandardDeviation
};

