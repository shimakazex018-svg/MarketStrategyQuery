'use strict';

(function exposeDrawdownChartInteractions(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DrawdownChartInteractions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDrawdownChartInteractions() {
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  function timestamp(date) {
    if (!ISO_DATE.test(date || '')) return Number.NaN;
    return new Date(`${date}T00:00:00Z`).valueOf();
  }

  function validPoints(points) {
    return (Array.isArray(points) ? points : [])
      .filter(point => point && Number.isFinite(timestamp(point.date)) && point.value !== null && point.value !== undefined && Number.isFinite(Number(point.value)))
      .sort((left, right) => left.date.localeCompare(right.date));
  }

  function findNearestDataPointByDate(points, selectedDate) {
    const values = validPoints(points);
    const target = timestamp(selectedDate);
    if (!values.length || !Number.isFinite(target)) return null;
    let low = 0;
    let high = values.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const time = timestamp(values[middle].date);
      if (time === target) return values[middle];
      if (time < target) low = middle + 1;
      else high = middle - 1;
    }
    if (high < 0) return values[0];
    if (low >= values.length) return values.at(-1);
    const before = values[high];
    const after = values[low];
    return target - timestamp(before.date) < timestamp(after.date) - target ? before : after;
  }

  function mapClientXToDate(clientX, rect, startDate, endDate) {
    const start = timestamp(startDate);
    const end = timestamp(endDate);
    if (!rect || !Number.isFinite(clientX) || !Number.isFinite(start) || !Number.isFinite(end)) return null;
    const width = Math.max(Number(rect.width) || 0, 1);
    const ratio = Math.max(0, Math.min(1, (clientX - Number(rect.left || 0)) / width));
    return new Date(start + (end - start) * ratio).toISOString().slice(0, 10);
  }

  function findNearestDataPointByX(points, clientX, rect, startDate, endDate) {
    const targetDate = mapClientXToDate(clientX, rect, startDate, endDate);
    return targetDate ? findNearestDataPointByDate(points, targetDate) : null;
  }

  function mapDateToX(date, startDate, endDate, { width = 1000, padX = 18 } = {}) {
    const point = timestamp(date);
    const start = timestamp(startDate);
    const end = timestamp(endDate);
    if (![point, start, end].every(Number.isFinite)) return null;
    const ratio = Math.max(0, Math.min(1, (point - start) / Math.max(end - start, 1)));
    return padX + ratio * (width - padX * 2);
  }

  function pointerPositionInViewBox(clientX, rect, { width = 1000 } = {}) {
    const ratio = Math.max(0, Math.min(1, (clientX - Number(rect?.left || 0)) / Math.max(Number(rect?.width) || 0, 1)));
    return ratio * width;
  }

  return {
    findNearestDataPointByDate,
    findNearestDataPointByX,
    mapClientXToDate,
    mapDateToX,
    pointerPositionInViewBox,
    validPoints
  };
});
