(function attachPortfolioCalendar(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PortfolioCalendar = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createPortfolioCalendarFormatter() {
  'use strict';

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatCurrencyValue(value, currency, minimumFractionDigits, maximumFractionDigits) {
    const code = String(currency || 'USD').toUpperCase();
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        currencyDisplay: 'symbol',
        minimumFractionDigits,
        maximumFractionDigits
      }).format(value);
    } catch {
      return code + ' ' + Number(value).toFixed(maximumFractionDigits);
    }
  }

  function formatFullAmount(value, currency = 'USD') {
    const number = finite(value);
    if (number === null) return '暂不可用';
    const amount = formatCurrencyValue(Math.abs(number), currency, 2, 2);
    if (number === 0) return amount;
    return (number > 0 ? '+' : '-') + amount;
  }

  function formatCompactAmount(value, currency = 'USD') {
    const number = finite(value);
    if (number === null) return '暂不可用';
    const absolute = Math.abs(number);
    if (absolute < 1000) return formatFullAmount(number, currency);
    let divisor = 1_000;
    let unit = 'K';
    let digits = 1;
    if (absolute >= 1_000_000 || Number((absolute / 1_000).toFixed(1)) >= 1000) {
      divisor = 1_000_000;
      unit = 'M';
      digits = 2;
    }
    const amount = formatCurrencyValue(absolute / divisor, currency, digits, digits);
    return (number > 0 ? '+' : '-') + amount + unit;
  }

  function formatReturn(value) {
    const number = finite(value);
    if (number === null) return '暂不可用';
    const percent = number * 100;
    if (percent === 0) return '0.0000%';
    return (percent > 0 ? '+' : '') + percent.toFixed(4) + '%';
  }

  function formatDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return String(value || '—');
    return Number(match[1]) + '年' + Number(match[2]) + '月' + Number(match[3]) + '日';
  }

  function qualityLabel(value) {
    const labels = {
      computed: 'Computed',
      reconciled: 'Reconciled',
      warning: 'Warning',
      incomplete: 'Incomplete',
      not_available: 'Not available',
      within_tolerance: 'Within tolerance',
      outlier: 'Outlier'
    };
    const key = String(value || '').toLowerCase();
    return labels[key] || (value ? String(value) : '—');
  }

  return {
    formatFullAmount,
    formatCompactAmount,
    formatReturn,
    formatDate,
    qualityLabel
  };
}));
