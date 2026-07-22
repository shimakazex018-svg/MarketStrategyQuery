'use strict';

(function exposeDrawdownAnalysis(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DrawdownAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDrawdownAnalysis() {
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  function isIsoDate(value) {
    if (!ISO_DATE.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }

  function normalizeSeries(input) {
    if (!Array.isArray(input)) throw new TypeError('series must be an array');
    const byDate = new Map();
    input.forEach((point, index) => {
      if (!point || !isIsoDate(point.date)) throw new TypeError(`series contains an invalid date at index ${index}`);
      if (point.value === null || point.value === undefined || point.value === '') return;
      const value = Number(point.value);
      if (!Number.isFinite(value) || value <= 0) throw new TypeError(`series contains an invalid value at ${point.date}`);
      const previous = byDate.get(point.date);
      if (previous && previous.value !== value) throw new TypeError(`series contains conflicting values for ${point.date}`);
      if (!previous) byDate.set(point.date, { date: point.date, value });
    });
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  function filterSeriesByDateRange(series, startDate, endDate) {
    const normalized = normalizeSeries(series);
    if (startDate && !isIsoDate(startDate)) throw new TypeError('startDate is invalid');
    if (endDate && !isIsoDate(endDate)) throw new TypeError('endDate is invalid');
    if (startDate && endDate && startDate > endDate) throw new RangeError('startDate must not be after endDate');
    return normalized.filter(point => (!startDate || point.date >= startDate) && (!endDate || point.date <= endDate));
  }

  function calculateRunningPeak(series) {
    const normalized = normalizeSeries(series);
    let peakValue = -Infinity;
    let peakDate = null;
    return normalized.map(point => {
      if (point.value >= peakValue) {
        peakValue = point.value;
        peakDate = point.date;
      }
      return { ...point, peakValue, peakDate };
    });
  }

  function calculateDrawdownSeries(series) {
    return calculateRunningPeak(series).map(point => ({
      ...point,
      drawdown: point.value / point.peakValue - 1
    }));
  }

  function episodeFrom(active, endIndex, recoveryPoint, status) {
    const recoveryTradingDays = recoveryPoint ? endIndex - active.troughIndex : null;
    return {
      peakDate: active.peakDate,
      troughDate: active.troughDate,
      recoveryDate: recoveryPoint?.date || null,
      peakValue: active.peakValue,
      troughValue: active.troughValue,
      maximumDrawdown: active.troughValue / active.peakValue - 1,
      declineTradingDays: active.troughIndex - active.peakIndex,
      recoveryTradingDays,
      totalTradingDays: endIndex - active.peakIndex,
      status
    };
  }

  function detectDrawdownEpisodes(series) {
    const normalized = normalizeSeries(series);
    if (normalized.length < 2) return [];
    const episodes = [];
    let peakIndex = 0;
    let peakValue = normalized[0].value;
    let active = null;

    for (let index = 1; index < normalized.length; index += 1) {
      const point = normalized[index];
      if (!active) {
        if (point.value < peakValue) {
          active = {
            peakIndex,
            peakDate: normalized[peakIndex].date,
            peakValue,
            troughIndex: index,
            troughDate: point.date,
            troughValue: point.value
          };
        } else {
          peakIndex = index;
          peakValue = point.value;
        }
        continue;
      }

      if (point.value < active.troughValue) {
        active.troughIndex = index;
        active.troughDate = point.date;
        active.troughValue = point.value;
      }
      if (point.value >= active.peakValue) {
        episodes.push(episodeFrom(active, index, point, 'recovered'));
        active = null;
        peakIndex = index;
        peakValue = point.value;
      }
    }

    if (active) episodes.push(episodeFrom(active, normalized.length - 1, null, 'ongoing'));
    return episodes;
  }

  function calculateDrawdownSummary(series) {
    const normalized = normalizeSeries(series);
    if (normalized.length < 2) return null;
    const drawdowns = calculateDrawdownSeries(normalized);
    const episodes = detectDrawdownEpisodes(normalized);
    const maximumPoint = drawdowns.reduce((minimum, point) => point.drawdown < minimum.drawdown ? point : minimum, drawdowns[0]);
    const maximumEpisode = episodes.find(episode => episode.troughDate === maximumPoint.date) || null;
    const recovered = episodes.filter(episode => episode.status === 'recovered');
    return {
      intervalReturn: normalized.at(-1).value / normalized[0].value - 1,
      currentDrawdown: drawdowns.at(-1).drawdown,
      maximumDrawdown: maximumPoint.drawdown,
      maximumDrawdownDate: maximumPoint.date,
      maximumEpisode,
      averageRecoveryTradingDays: recovered.length
        ? recovered.reduce((total, episode) => total + episode.recoveryTradingDays, 0) / recovered.length
        : null,
      firstDate: normalized[0].date,
      lastDate: normalized.at(-1).date,
      pointCount: normalized.length,
      drawdowns,
      episodes
    };
  }

  function calculateDrawdownDistribution(episodes) {
    const buckets = [
      { id: '5-10', label: '5%～10%', min: 0.05, max: 0.10, count: 0 },
      { id: '10-15', label: '10%～15%', min: 0.10, max: 0.15, count: 0 },
      { id: '15-20', label: '15%～20%', min: 0.15, max: 0.20, count: 0 },
      { id: '20-30', label: '20%～30%', min: 0.20, max: 0.30, count: 0 },
      { id: '30-plus', label: '30%+', min: 0.30, max: Infinity, count: 0 }
    ];
    (Array.isArray(episodes) ? episodes : []).forEach(episode => {
      const depth = Math.abs(Number(episode.maximumDrawdown));
      if (!Number.isFinite(depth)) return;
      const bucket = buckets.find(item => depth >= item.min && depth < item.max);
      if (bucket) bucket.count += 1;
    });
    return buckets.map(({ min, max, ...bucket }) => bucket);
  }

  function calculateAnnualReturns(series, currentYear = new Date().getUTCFullYear()) {
    const normalized = normalizeSeries(series);
    const years = new Map();
    normalized.forEach(point => {
      const year = Number(point.date.slice(0, 4));
      const entry = years.get(year) || [];
      entry.push(point);
      years.set(year, entry);
    });
    return [...years.entries()].sort(([left], [right]) => left - right).map(([year, points]) => ({
      year,
      label: year === currentYear ? `${year} YTD` : String(year),
      isYtd: year === currentYear,
      firstDate: points[0].date,
      lastDate: points.at(-1).date,
      return: points.length < 2 ? null : points.at(-1).value / points[0].value - 1,
      pointCount: points.length
    }));
  }

  function normalizeFromPoint(series, startDate, baseValue) {
    return series.filter(point => point.date >= startDate).map(point => ({
      ...point,
      normalizedValue: point.value / baseValue * 100
    }));
  }

  function alignComparisonSeries(primarySeries, comparisonSeries) {
    const primary = normalizeSeries(primarySeries);
    const comparison = comparisonSeries == null ? [] : normalizeSeries(comparisonSeries);
    if (!primary.length) return { startDate: null, primary: [], comparison: [] };
    if (!comparison.length) {
      return {
        startDate: primary[0].date,
        primary: normalizeFromPoint(primary, primary[0].date, primary[0].value),
        comparison: []
      };
    }
    const comparisonByDate = new Map(comparison.map(point => [point.date, point]));
    const firstPrimary = primary.find(point => comparisonByDate.has(point.date));
    if (!firstPrimary) return { startDate: null, primary: [], comparison: [] };
    const firstComparison = comparisonByDate.get(firstPrimary.date);
    return {
      startDate: firstPrimary.date,
      primary: normalizeFromPoint(primary, firstPrimary.date, firstPrimary.value),
      comparison: normalizeFromPoint(comparison, firstPrimary.date, firstComparison.value)
    };
  }

  function createDatasetCache(fetchSeries) {
    if (typeof fetchSeries !== 'function') throw new TypeError('fetchSeries must be a function');
    const values = new Map();
    const pending = new Map();
    return {
      async load(key, options = {}) {
        if (options.force) {
          values.delete(key);
          pending.delete(key);
        }
        if (values.has(key)) return values.get(key);
        if (pending.has(key)) return pending.get(key);
        const request = Promise.resolve(fetchSeries(key, options)).then(series => {
          const normalized = normalizeSeries(series);
          values.set(key, normalized);
          pending.delete(key);
          return normalized;
        }, error => {
          pending.delete(key);
          throw error;
        });
        pending.set(key, request);
        return request;
      },
      has(key) { return values.has(key); },
      get(key) { return values.get(key); },
      clear(key) {
        if (key === undefined) { values.clear(); pending.clear(); }
        else { values.delete(key); pending.delete(key); }
      }
    };
  }

  return {
    alignComparisonSeries,
    calculateAnnualReturns,
    calculateDrawdownDistribution,
    calculateDrawdownSeries,
    calculateDrawdownSummary,
    calculateRunningPeak,
    createDatasetCache,
    detectDrawdownEpisodes,
    filterSeriesByDateRange,
    isIsoDate,
    normalizeSeries
  };
});
