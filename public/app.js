'use strict';

const state = {
  stages: [],
  options: [],
  indicators: [],
  cycleShape: null,
  settingsRunsExpanded: false,
  activeStageId: null,
  optionCategory: '全部',
  ranges: {},
  marketData: {},
  externalPE: { loaded: false, loading: false, status: null, latest: null, history: null, statistics: null, error: null },
  naaim: { status: 'loading', history: [] },
  drawdown: {
    primaryId: 'nasdaq100_index',
    comparisonId: 'sp500_index',
    preset: '10Y',
    customStart: '',
    customEnd: '',
    threshold: 0.15,
    sort: 'date-desc',
    loading: new Set(),
    errors: {},
    metadata: {},
    calculationCache: new Map(),
    validationMessage: '',
    selectedChartDate: null,
    chartCursorVisible: false
  },
  route: ''
};

const RANGE_LABELS = ['1个月', '3个月', '6个月', '1年', '3年', '5年', '10年'];
const RANGE_KEYS = ['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y'];
const DATA_STATUS = Object.freeze({
  loading: { label: '加载中', tone: 'loading' },
  fresh: { label: '最新数据', tone: 'fresh' },
  stale: { label: '数据已过期', tone: 'stale' },
  error: { label: '数据错误', tone: 'error' },
  demo: { label: '演示数据', tone: 'demo' },
  unavailable: { label: '暂不可用', tone: 'unavailable' },
  provisional: { label: '初步估算', tone: 'provisional' },
  insufficient_coverage: { label: '覆盖不足', tone: 'insufficient' },
  manual: { label: '人工录入', tone: 'manual' },
  quality_warning: { label: '质量提示', tone: 'warning' }
});

const app = document.getElementById('app');
const themeToggle = document.getElementById('themeToggle');
const menuToggle = document.getElementById('menuToggle');
const mobileNav = document.getElementById('mobileNav');
const settingsLink = document.getElementById('settingsLink');
let settingsController = null;
let settingsPollTimer = null;
let settingsStatus = null;
let settingsError = false;
const indicatorDialogState = {
  phase: 'closed',
  trigger: null,
  queued: null,
  portal: null,
  keydownHandler: null,
  scrollY: 0,
  animations: [],
  inertNodes: []
};
const marketDataControllers = new Map();
let externalPEController = null;
const drawdownControllers = new Map();
let activeDrawdownChartView = null;
let drawdownChartInteraction = null;
const DRAWDOWN_METRICS = Object.freeze({
  nasdaq100_index: { label: 'Nasdaq-100指数', shortLabel: 'Nasdaq-100', source: 'FRED NASDAQ100' },
  sp500_index: { label: 'S&P 500指数', shortLabel: 'S&P 500', source: 'FRED SP500' },
  soxx_price: { label: 'SOXX半导体ETF', shortLabel: 'SOXX', source: 'iShares / BlackRock', optional: true }
});
const DRAWDOWN_PRESETS = Object.freeze([
  ['1Y', '近1年', 1], ['3Y', '近3年', 3], ['5Y', '近5年', 5], ['10Y', '近10年', 10],
  ['15Y', '近15年', 15], ['20Y', '近20年', 20], ['ALL', '全历史', null]
]);
const drawdownDatasetCache = DrawdownAnalysis.createDatasetCache(async (id, options = {}) => {
  const response = await fetch(`/api/market-data/metrics/${encodeURIComponent(id)}/history?range=ALL`, {
    headers: { Accept: 'application/json' },
    signal: options.signal
  });
  if (!response.ok) throw new Error(`Drawdown history API ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.history)) throw new TypeError('Drawdown history response is invalid');
  state.drawdown.metadata[id] = {
    status: payload.status || null,
    provider: payload.provider || null,
    sourceLabel: payload.sourceLabel || null,
    seriesType: payload.seriesType || null,
    adjustmentStatus: payload.adjustmentStatus || null,
    limitations: Array.isArray(payload.limitations) ? payload.limitations : []
  };
  return payload.history;
});

function availableDrawdownMetrics() {
  return Object.fromEntries(Object.entries(DRAWDOWN_METRICS).filter(([id, metric]) => !metric.optional || (drawdownDatasetCache.has(id) && drawdownDatasetCache.get(id).length >= 2)));
}

function drawdownSeriesTypeLabel(id) {
  if (id !== 'soxx_price') return '指数点位';
  return {
    adjusted_market_price: 'SOXX adjusted market price',
    market_price: 'SOXX market price',
    nav: 'SOXX NAV'
  }[state.drawdown.metadata[id]?.seriesType] || 'SOXX数据口径未确认';
}

function drawdownSeriesNotice(id) {
  if (id !== 'soxx_price') return '回撤根据所选指数的日度收盘序列计算。';
  const seriesType = state.drawdown.metadata[id]?.seriesType;
  if (seriesType === 'adjusted_market_price') return 'SOXX回撤根据复权市场价格日线计算。';
  if (seriesType === 'market_price') return 'SOXX回撤根据市场收盘价格日线计算，长期收益可能受到拆股和分红口径影响。';
  if (seriesType === 'nav') return 'SOXX回撤根据基金NAV日线计算，不代表交易所市场成交价格。';
  return 'SOXX数据口径尚未确认。';
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date);
}

function initialMarketModel(indicator) {
  return {
    id: indicator.id,
    displayName: indicator.name,
    value: null,
    unit: indicator.unit || '',
    asOf: null,
    source: '本地市场数据服务',
    status: 'loading',
    statusMessage: '正在读取本地缓存',
    updatedAt: null,
    lastSuccessAt: null,
    isDemo: false,
    isStale: false,
    availableRanges: indicator.dataMode === 'demo' ? RANGE_KEYS : [],
    history: []
  };
}

function failedMarketModel(indicator, previous) {
  if (indicator.dataMode === 'demo') {
    return {
      ...initialMarketModel(indicator),
      value: indicator.value,
      source: indicator.demoSource,
      status: 'demo',
      statusMessage: indicator.demoMessage,
      isDemo: true,
      availableRanges: RANGE_KEYS
    };
  }
  if (previous?.value !== null && previous?.value !== undefined) {
    return { ...previous, status: 'stale', isStale: true, statusMessage: '内部数据服务不可用，显示上次成功数据' };
  }
  return {
    ...initialMarketModel(indicator), status: 'error', statusMessage: '内部市场数据服务暂时不可用'
  };
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function valueOr(value, fallback = '待补充') {
  return value === undefined || value === null || value === '' ? fallback : value;
}

function hasFiniteValue(value) {
  return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
}

function listOr(value, fallback = '待补充') {
  return Array.isArray(value) && value.length ? value : [fallback];
}

function renderList(items, className = 'condition-list') {
  return `<ul class="${className}">${listOr(items).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function optionGuidanceFor(stage) {
  if (stage.optionGuidance) return stage.optionGuidance;
  const guidance = { recommended: [], optional: [], cautious: [], avoid: [], note: '请结合期权工具页核对完整风险。' };
  listOr(stage.options, null).filter(Boolean).forEach(item => {
    const level = ['recommended', 'optional', 'cautious', 'avoid'].includes(item.level) ? item.level : 'cautious';
    guidance[level].push(item.name || item.label);
  });
  return guidance;
}

function optionGuidanceMarkup(stage) {
  const guidance = optionGuidanceFor(stage);
  const groups = [
    ['recommended', '推荐'], ['optional', '可选'], ['cautious', '谨慎'], ['avoid', '不建议']
  ];
  return `${groups.map(([level, label]) => `
    <div class="guidance-group ${level}">
      <span>${label}</span>
      <div>${listOr(guidance[level], '暂无').map(name => {
        const option = state.options.find(item => item.english === name || item.name === name);
        return option
          ? `<a class="strategy-link" href="#/options/${option.id}">${escapeHtml(name)}</a>`
          : `<strong>${escapeHtml(name)}</strong>`;
      }).join('')}</div>
    </div>`).join('')}
    <p class="guidance-note">${escapeHtml(valueOr(guidance.note))}</p>`;
}

function stageActionTabs(actionPlan) {
  const tabs = [
    { id: 'initial', label: '初始动作', listClass: 'action-list' },
    { id: 'worsening', label: '继续恶化', listClass: 'risk-list' },
    { id: 'unchanged', label: '维持不变', listClass: 'condition-list' },
    { id: 'improving', label: '市场改善', listClass: 'action-list' }
  ];
  return `
    <div class="decision-tabs" data-tabs="stage-actions">
      <div class="tab-list" role="tablist" aria-label="市场状态对应的执行动作">
        ${tabs.map((tab, index) => `<button id="stage-action-tab-${tab.id}" class="tab-button${index === 0 ? ' active' : ''}" type="button" role="tab" aria-selected="${index === 0}" aria-controls="stage-action-panel-${tab.id}" tabindex="${index === 0 ? '0' : '-1'}" data-tab-target="stage-action-panel-${tab.id}">${tab.label}</button>`).join('')}
      </div>
      ${tabs.map((tab, index) => `<div id="stage-action-panel-${tab.id}" class="tab-panel" role="tabpanel" aria-labelledby="stage-action-tab-${tab.id}" tabindex="0"${index === 0 ? '' : ' hidden'}>${renderList(actionPlan[tab.id], tab.listClass)}</div>`).join('')}
    </div>`;
}

function stageAssetTabs(stage, allocations) {
  return `
    <div class="decision-tabs" data-tabs="stage-assets">
      <div class="tab-list" role="tablist" aria-label="选择资产查看配置逻辑">
        ${allocations.map((item, index) => `<button id="stage-asset-tab-${index}" class="tab-button${index === 0 ? ' active' : ''}" type="button" role="tab" aria-selected="${index === 0}" aria-controls="stage-asset-panel-${index}" tabindex="${index === 0 ? '0' : '-1'}" data-tab-target="stage-asset-panel-${index}">${escapeHtml(valueOr(item.ticker))}</button>`).join('')}
      </div>
      ${allocations.map((item, index) => {
        const rule = stage.assetRules?.[item.ticker] || {};
        return `<section id="stage-asset-panel-${index}" class="tab-panel asset-detail-panel" role="tabpanel" aria-labelledby="stage-asset-tab-${index}" tabindex="0"${index === 0 ? '' : ' hidden'}>
          <header><div><span>资产角色</span><h3>${escapeHtml(valueOr(item.ticker))}</h3></div><strong>${escapeHtml(valueOr(item.range))}</strong></header>
          <p>${escapeHtml(valueOr(item.role))}</p>
          <dl>
            <div><dt>增配条件</dt><dd>${escapeHtml(valueOr(rule.increaseWhen))}</dd></div>
            <div><dt>减配条件</dt><dd>${escapeHtml(valueOr(rule.reduceWhen))}</dd></div>
            <div class="asset-prohibition"><dt>禁止条件</dt><dd>${escapeHtml(valueOr(rule.avoidWhen))}</dd></div>
            <div><dt>主要风险</dt><dd>${escapeHtml(valueOr(rule.risk))}</dd></div>
          </dl>
        </section>`;
      }).join('')}
    </div>`;
}

function recognitionVisualMarkup(stage) {
  const visual = stage.recognitionVisual;
  if (!visual || !visual.src) return '';
  const meta = [visual.source, visual.period].filter(Boolean).map(escapeHtml).join(' · ');
  return `<figure class="recognition-visual">
    ${visual.title ? `<h3>${escapeHtml(visual.title)}</h3>` : ''}
    <img src="${escapeHtml(visual.src)}" alt="${escapeHtml(valueOr(visual.alt, `${stage.name}典型识别示意图`))}" loading="lazy">
    ${(visual.caption || meta) ? `<figcaption>${visual.caption ? `<span>${escapeHtml(visual.caption)}</span>` : ''}${meta ? `<small>${meta}</small>` : ''}</figcaption>` : ''}
  </figure>`;
}

function seedFrom(text) {
  return [...text].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateSeries(indicator, rangeKey) {
  const lengthMap = { '1M': 34, '3M': 42, '6M': 50, '1Y': 58, '3Y': 66, '5Y': 74, '10Y': 82 };
  const length = lengthMap[rangeKey] || 50;
  const random = seededRandom(seedFrom(`${indicator.id}-${rangeKey}`));
  const isVol = indicator.id === 'vix' || indicator.id === 'vxn';
  const isSentiment = indicator.id === 'fear-greed' || indicator.id === 'manager-exposure';
  const amplitude = isVol ? 8 : isSentiment ? 18 : 4.2;
  const driftByRange = { '1M': .08, '3M': .12, '6M': .05, '1Y': .09, '3Y': .14, '5Y': .11, '10Y': .16 };
  const base = Number(indicator.value);
  const values = [];
  let current = base - amplitude * .18;
  for (let i = 0; i < length; i += 1) {
    const wave = Math.sin(i / 3.4) * amplitude * .18 + Math.sin(i / 8.7) * amplitude * .12;
    const shock = (random() - .5) * amplitude * .45;
    current += shock * .26 + driftByRange[rangeKey] * (random() > .35 ? 1 : -1);
    let next = current + wave;
    if (isSentiment) next = Math.max(4, Math.min(96, next));
    if (isVol) next = Math.max(10, Math.min(70, next));
    values.push(next);
  }
  const delta = base - values[values.length - 1];
  return values.map((v, i) => v + delta * (i / (values.length - 1)));
}

function seriesToPath(values, width = 360, height = 126, pad = 6, scale = null) {
  const min = scale?.min ?? Math.min(...values);
  const max = scale?.max ?? Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = pad + (index / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (value - min) / range) * (height - pad * 2);
    return [x, y];
  });
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${points.at(-1)[0].toFixed(2)},${height} L${points[0][0].toFixed(2)},${height} Z`;
  return { line, area, min, max, points };
}

function smoothSvgPath(points) {
  if (points.length < 2) return '';
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const midX = (previous[0] + point[0]) / 2;
    return `${path} C ${midX.toFixed(1)} ${previous[1].toFixed(1)}, ${midX.toFixed(1)} ${point[1].toFixed(1)}, ${point[0].toFixed(1)} ${point[1].toFixed(1)}`;
  }, `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`);
}

function marketCycleSvg(stages, shape) {
  const width = 1760;
  const height = 560;
  const left = 60;
  const right = 60;
  const top = 70;
  const bottom = 70;
  const stageWidth = (width - left - right) / stages.length;
  const shapeStages = Array.isArray(shape?.stages) ? shape.stages : [];
  const allPoints = [];
  const stageGeometry = stages.map((stage, stageIndex) => {
    const segment = shapeStages.find(item => item.id === stage.id);
    const values = Array.isArray(segment?.points) && segment.points.length > 1 ? segment.points : [50, 50];
    const points = values.map((value, pointIndex) => {
      const x = left + stageIndex * stageWidth + (pointIndex / (values.length - 1)) * stageWidth;
      const normalized = Math.max(0, Math.min(100, Number(value) || 0));
      const y = height - bottom - (normalized / 100) * (height - top - bottom);
      return [x, y];
    });
    if (stageIndex) points.shift();
    allPoints.push(...points);
    return { stage, segment, points };
  });
  const path = smoothSvgPath(allPoints);
  const groups = stageGeometry.map(({ stage, segment, points }, index) => {
    const marker = points[Math.floor(points.length / 2)] || [left + (index + .5) * stageWidth, height / 2];
    const labelWidth = 142;
    const labelHeight = 44;
    const labelX = Math.max(8, Math.min(width - labelWidth - 8, marker[0] - labelWidth / 2));
    const preferredY = index % 2 ? marker[1] + 38 : marker[1] - 82;
    const labelY = Math.max(12, Math.min(height - labelHeight - 12, preferredY));
    return `<g class="stage-zone${state.activeStageId === stage.id ? ' is-active' : ''}" tabindex="0" role="link" aria-label="查看${escapeHtml(stage.name)}策略：${escapeHtml(valueOr(segment?.summary, stage.summary))}" data-stage-id="${stage.id}" data-cycle-preview-id="${stage.id}">
      <rect class="stage-hit-area" x="${(left + index * stageWidth).toFixed(1)}" y="${top}" width="${stageWidth.toFixed(1)}" height="${height - top - bottom}"></rect>
      <circle class="stage-marker" cx="${marker[0].toFixed(1)}" cy="${marker[1].toFixed(1)}" r="8"></circle>
      <rect class="stage-label-bg" x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" width="${labelWidth}" height="${labelHeight}"></rect>
      <text class="stage-index" x="${(labelX + 11).toFixed(1)}" y="${(labelY + 17).toFixed(1)}">S${String(stage.order).padStart(2, '0')}</text>
      <text class="stage-label" x="${(labelX + 11).toFixed(1)}" y="${(labelY + 34).toFixed(1)}">${escapeHtml(stage.name)}</text>
    </g>`;
  }).join('');
  return `<svg class="market-cycle" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(valueOr(shape?.label, '九阶段市场周期示意图'))}">
    <defs><linearGradient id="cycleAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".24"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    <path class="cycle-area" d="${path} L ${allPoints.at(-1)?.[0] || 0} ${height - bottom} L ${allPoints[0]?.[0] || 0} ${height - bottom} Z"></path>
    <path class="cycle-path" d="${path}"></path>
    ${groups}
  </svg>`;
}

function metricCard(indicator, index) {
  const rangeKey = state.ranges[indicator.id] || '1Y';
  const market = state.marketData[indicator.id] || initialMarketModel(indicator);
  const statusMeta = DATA_STATUS[market.status] || DATA_STATUS.error;
  const isDemo = false;
  const isPe = indicator.id.endsWith('_pe');
  const historyValues = Array.isArray(market.history) ? market.history.map(point => Number(point.value)).filter(Number.isFinite) : [];
  const values = historyValues.length > 1 ? historyValues : [];
  const chart = values.length > 1 ? seriesToPath(values, 360, 126, 6) : null;
  const available = new Set(market.availableRanges || []);
  const rangeButtons = RANGE_KEYS.map((key, i) => {
    const disabled = !isDemo && !available.has(key);
    return `<button class="range-tab${key === rangeKey ? ' active' : ''}" data-indicator-id="${indicator.id}" data-range="${key}" type="button" aria-pressed="${key === rangeKey}"${disabled ? ' disabled aria-disabled="true"' : ''}>${RANGE_LABELS[i]}</button>`;
  }).join('');
  const displayNumber = number => hasFiniteValue(number) ? Number(number).toFixed(2).replace(/\.00$/, '') : '—';
  const value = market.status === 'loading'
    ? '<span class="metric-value-skeleton" aria-label="加载中"></span>'
    : market.value === null || market.value === undefined
      ? '—'
      : `${escapeHtml(displayNumber(market.value))}${escapeHtml(market.unit === 'index_points' ? '' : market.unit || indicator.unit || '')}`;
  const secondaryValue = hasFiniteValue(market.change) ? `较前值 ${Number(market.change) >= 0 ? '+' : ''}${displayNumber(market.change)}` : market.asOf ? `数据日期 ${escapeHtml(market.asOf)}` : '暂无可用数据日期';
  const chartMarkup = chart ? `
      <svg class="metric-chart" viewBox="0 0 360 126" preserveAspectRatio="none" aria-label="${escapeHtml(indicator.name)} ${rangeKey}${isDemo ? '演示' : '历史'}曲线">
        <defs><linearGradient id="metricGradient-${index}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".65"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
        <line class="baseline" x1="0" x2="360" y1="63" y2="63"></line>
        <path d="${chart.area}" fill="url(#metricGradient-${index})" opacity=".25"></path>
        <path class="line" d="${chart.line}"></path>
      </svg>` : `<div class="metric-chart-empty" role="status"><span>${market.status === 'loading' ? '正在读取本地缓存…' : '没有可展示的历史曲线'}</span></div>`;
  const rangeSummary = chart
    ? `${isDemo ? '演示' : '可见'}区间：${chart.min.toFixed(1)}–${chart.max.toFixed(1)}`
    : market.historyStart ? `历史起始：${escapeHtml(market.historyStart)}` : '历史范围：暂无';
  return `
    <article class="metric-card metric-card--${statusMeta.tone} reveal" data-market-status="${escapeHtml(market.status)}" style="transition-delay:${index * 45}ms">
      <div class="metric-top">
        <div>
          <div class="metric-title-row"><h3 class="metric-name">${escapeHtml(indicator.name)}</h3><button class="metric-info-button" type="button" data-indicator-info="${escapeHtml(indicator.id)}" aria-label="查看${escapeHtml(indicator.name)}指标说明" aria-haspopup="dialog" aria-expanded="false" aria-controls="indicatorDialog">i</button></div>
          <p class="metric-subtitle">${escapeHtml(indicator.subtitle)}</p>
        </div>
        <div class="metric-value">
          <strong>${value}</strong>
          <span>${secondaryValue}</span>
        </div>
      </div>
      <div class="metric-status-row"><span class="metric-status" data-status="${statusMeta.tone}">${statusMeta.label}</span><span>${escapeHtml(market.statusMessage || '')}</span></div>
      ${market.qualityStatus === 'quality_warning' ? '<div class="metric-quality-warning"><span class="metric-status" data-status="warning">质量提示</span><span>结果可显示，但存在需要核对的数据质量标记。</span></div>' : ''}
      ${chartMarkup}
      <div class="range-tabs" role="group" aria-label="时间范围">${rangeButtons}</div>
      <dl class="metric-data-meta">
        <div><dt>数据来源</dt><dd>${escapeHtml(market.source || '—')}</dd></div>
        <div><dt>数据日期</dt><dd>${escapeHtml(market.asOf || '—')}</dd></div>
        <div><dt>更新时间</dt><dd>${escapeHtml(formatDateTime(market.updatedAt))}</dd></div>
        ${hasFiniteValue(market.financialCoverageWeight) ? `<div><dt>财务覆盖</dt><dd>${(Number(market.financialCoverageWeight) * 100).toFixed(1)}%</dd></div>` : ''}
        ${hasFiniteValue(market.priceCoverageWeight) ? `<div><dt>价格覆盖</dt><dd>${(Number(market.priceCoverageWeight) * 100).toFixed(1)}%</dd></div>` : ''}
        ${market.status === 'stale' ? `<div class="metric-stale-note"><dt>上次成功</dt><dd>${escapeHtml(formatDateTime(market.lastSuccessAt))}</dd></div>` : ''}
      </dl>
      <p class="metric-explain">${escapeHtml(indicator.explain)}</p>
      <p class="metric-subtitle">${rangeSummary}</p>
    </article>`;
}

function homeTemplate() {
  const active = state.stages.find(stage => stage.id === state.activeStageId);
  const previewStage = active || state.stages[0];
  const previewShape = state.cycleShape?.stages?.find(item => item.id === previewStage?.id);
  return `
    <div class="page">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Personal Strategy System</p>
          <h1>从市场形态进入<br><span>仓位与期权决策</span></h1>
          <p>先观察完整市场周期，再结合六类辅助指标。点击对应阶段，进入独立的仓位、标的、期权、执行动作与风险收益详情。</p>
        </div>
        <aside class="hero-panel">
          <p class="hero-panel-label">当前查看阶段</p>
          <h2 class="hero-panel-value">${active ? escapeHtml(active.name) : '尚未选择'}</h2>
          <p>${active ? escapeHtml(active.mode) : '第一版不进行网页自动判断。请直接点击市场周期中的阶段进行策略推演。'}</p>
          <div class="hero-actions">
            ${active ? `<a class="button primary" href="#/stage/${active.id}">打开策略详情</a>` : '<button class="button primary" type="button" data-scroll-target="cycle">选择市场阶段</button>'}
            <a class="button ghost" href="#/compare">查看阶段对比</a>
          </div>
        </aside>
      </section>

      <section id="cycle" class="section reveal">
        <div class="section-heading">
          <div><h2>市场周期地图</h2><p>九种形态覆盖从高位震荡、趋势破坏、恐慌去杠杆，到底部修复、右侧确认与过热上涨的主要循环。</p></div>
        </div>
        <div class="cycle-shell">
          <div class="cycle-toolbar"><strong>${escapeHtml(valueOr(state.cycleShape?.label, '市场周期示意图'))}</strong><span>聚焦或触摸阶段查看摘要，点击进入详情</span></div>
          <div class="cycle-scroll">${marketCycleSvg(state.stages, state.cycleShape)}</div>
          <aside class="cycle-inspector" aria-live="polite">
            <div><span id="cycleInspectorIndex">S${String(previewStage?.order || 1).padStart(2, '0')}</span><strong id="cycleInspectorName">${escapeHtml(valueOr(previewStage?.name))}</strong><p id="cycleInspectorSummary">${escapeHtml(valueOr(previewShape?.summary, previewStage?.summary))}</p></div>
            <a id="cycleInspectorLink" class="button ghost" href="#/stage/${escapeHtml(valueOr(previewStage?.id, state.stages[0]?.id))}">查看阶段详情</a>
          </aside>
          <div class="stage-strip">
            ${state.stages.map(stage => `<button type="button" class="stage-pill${state.activeStageId === stage.id ? ' active' : ''}" data-stage-id="${stage.id}" data-cycle-preview-id="${stage.id}"><span>S${String(stage.order).padStart(2, '0')}</span><strong>${escapeHtml(stage.name)}</strong></button>`).join('')}
          </div>
          <p class="cycle-disclaimer">${escapeHtml(valueOr(state.cycleShape?.disclaimer, '静态示意图，不代表真实市场数据。'))}</p>
        </div>
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <div><h2>辅助指标仪表盘</h2><p>页面只读取本站内部API。正式来源未通过许可门槛时明确显示不可用或演示数据，不用伪造值补齐。</p></div>
        </div>
        <div class="metric-grid">${state.indicators.map(metricCard).join('')}</div>
        ${naaimObservationTemplate()}
        <p class="cycle-disclaimer">数据仅用于本人投资研究。初步估算表示部分成分数据缺失或日期并非完全一致；覆盖不足时不输出正式数值。所有指标均不能单独用于判断市场阶段或形成自动仓位建议。</p>
      </section>

      <section class="section reveal">
        <div class="notice"><strong>当前版本边界</strong><span>在线数据必须先通过来源与许可审计；当前不进行市场阶段自动判断、不提供自动仓位建议、不读取IBKR持仓。</span></div>
      </section>
    </div>`;
}

function stageTemplate(stage) {
  if (!stage) return notFoundTemplate();
  state.activeStageId = stage.id;
  const allocations = listOr(stage.allocations, {}).filter(item => item && typeof item === 'object');
  const actionPlan = stage.actionPlan || { initial: stage.actions };
  const corePrinciple = listOr(actionPlan.initial, stage.mode)[0];
  return `
    <div class="page">
      <div class="breadcrumb"><a href="#/">市场周期</a><span>/</span><span>${escapeHtml(stage.name)}</span></div>
      <header id="stage-overview" class="page-title stage-decision-header">
        <div><p class="eyebrow">Stage ${String(stage.order).padStart(2, '0')} · ${escapeHtml(stage.category)}</p><h1>${escapeHtml(stage.name)}</h1><p>${escapeHtml(stage.summary)}</p></div>
        <a class="button" href="#/">返回周期图</a>
      </header>

      <nav class="stage-section-nav" aria-label="阶段详情页内导航">
        ${[['stage-overview','概览'],['stage-allocation','仓位'],['stage-actions','执行动作'],['stage-assets','资产逻辑'],['stage-recognition','识别条件'],['stage-options','期权'],['stage-risk','风险']].map(([target, label]) => `<button type="button" data-scroll-target="${target}">${label}</button>`).join('')}
      </nav>

      <div class="stage-detail-layout">
        <section class="content-card stage-overview-card reveal" aria-labelledby="stage-overview-heading">
          <div><h2 id="stage-overview-heading">市场状态定义</h2><p>${escapeHtml(valueOr(stage.marketDefinition, stage.mode))}</p></div>
          <div class="stage-meta">
            <div class="meta-cell"><span>市场方向</span><strong>${escapeHtml(valueOr(stage.direction))}</strong></div>
            <div class="meta-cell"><span>风险等级</span><strong>${escapeHtml(valueOr(stage.risk))}</strong></div>
            <div class="meta-cell"><span>策略属性</span><strong>${escapeHtml(valueOr(stage.strategyProfile, stage.mode))}</strong></div>
          </div>
          <div class="core-principle"><span>核心原则</span><strong>${escapeHtml(valueOr(corePrinciple, stage.mode))}</strong></div>
        </section>

        <section id="stage-allocation" class="content-card reveal stage-anchor-section">
          <h2>允许仓位区间</h2>
          <p>各资产区间相互独立，不要求上下限合计为100%，也不代表应同时取上限或下限。</p>
          <div class="allocation-grid">
            ${allocations.map(item => `<div class="allocation-card"><span class="ticker">${escapeHtml(valueOr(item.ticker))}</span><div class="range">${escapeHtml(valueOr(item.range))}</div><p>${escapeHtml(valueOr(item.role))}</p></div>`).join('')}
          </div>
        </section>

        <section id="stage-actions" class="content-card reveal stage-anchor-section">
          <div class="card-heading-row"><div><h2>当前执行动作</h2><p>默认显示初始动作；切换市场状态查看对应处理。</p></div></div>
          ${stageActionTabs(actionPlan)}
        </section>

        <section id="stage-assets" class="content-card reveal stage-anchor-section">
          <div class="card-heading-row"><div><h2>各资产配置逻辑</h2><p>仓位区间保持可见；此处按资产查看角色、调整条件和风险。</p></div></div>
          ${stageAssetTabs(stage, allocations)}
        </section>

        <section id="stage-recognition" class="content-card reveal stage-anchor-section recognition-section">
          <div><h2>典型识别条件</h2><p>优先核对最有区分度的价格结构、波动率和相对强弱条件。</p>${renderList(listOr(stage.conditions).slice(0, 6))}</div>
          ${recognitionVisualMarkup(stage)}
          <details class="compact-details"><summary role="button" tabindex="0" aria-expanded="false">查看阶段切换条件</summary>${renderList(stage.transitionConditions, 'condition-list')}</details>
        </section>

        <section id="stage-options" class="content-card reveal stage-anchor-section">
          <div class="card-heading-row"><div><h2>期权策略分级</h2><p>阶段分级只说明用途优先级；建仓前仍需核对完整损益与管理规则。</p></div><a class="button ghost" href="#/options">打开期权工具库</a></div>
          <div class="guidance-grid">${optionGuidanceMarkup(stage)}</div>
        </section>

        <section id="stage-risk" class="content-card reveal risk-boundary stage-anchor-section">
          <h2>风险、收益与机会成本</h2>
          <div class="source-grid"><section><h3>潜在收益来源</h3>${renderList(stage.returnSources, 'action-list')}</section><section><h3>潜在亏损来源</h3>${renderList(stage.lossSources, 'risk-list')}</section></div>
          <div class="risk-boundary-grid"><div><span>最大不利情景</span><p>${escapeHtml(valueOr(stage.worstCase))}</p></div><div><span>策略失效条件</span><p>${escapeHtml(valueOr(stage.invalidation))}</p></div><div><span>机会成本</span><p>${escapeHtml(valueOr(stage.opportunityCost))}</p></div></div>
          <div class="critical-notice"><strong>风险提示</strong><p>${escapeHtml(valueOr(stage.riskNotice, listOr(stage.risks).join('；')))}</p></div>
        </section>
      </div>
    </div>`;
}

function compareTemplate() {
  return `
    <div class="page">
      <div class="breadcrumb"><a href="#/">首页</a><span>/</span><span>阶段对比</span></div>
      <header class="page-title"><div><p class="eyebrow">Comparison Matrix</p><h1>九阶段策略对比</h1><p>快速比较市场方向、风险、仓位边界与主要执行目的。表格中的区间保持独立。</p></div></header>
      <div class="table-wrap reveal">
        <table class="data-table">
          <thead><tr><th>阶段</th><th>方向 / 风险</th><th>QQQ</th><th>SOXX</th><th>SOXL</th><th>现金/SGOV</th><th>策略目的</th><th>详情</th></tr></thead>
          <tbody>${state.stages.map(stage => {
            const allocation = Object.fromEntries(stage.allocations.map(item => [item.ticker, item.range]));
            return `<tr><td><strong>S${String(stage.order).padStart(2,'0')} ${escapeHtml(stage.name)}</strong>${escapeHtml(stage.category)}</td><td>${escapeHtml(stage.direction)}<br><span style="color:var(--text-soft)">风险：${escapeHtml(stage.risk)}</span></td><td>${allocation.QQQ || ''}</td><td>${allocation.SOXX || ''}</td><td>${allocation.SOXL || ''}</td><td>${allocation['现金/SGOV'] || ''}</td><td>${escapeHtml(stage.mode)}</td><td><a class="button ghost" href="#/stage/${stage.id}">查看</a></td></tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

function optionTemplate(option) {
  if (!option) return '<div class="notice"><strong>策略不可用</strong><span>未找到对应策略，请从目录重新选择。</span></div>';
  const performance = option.performance || {};
  const example = option.formulaExample || {};
  const variables = listOr(option.variables, {}).filter(item => item && typeof item === 'object');
  return `
    <article class="option-detail-card reveal" aria-labelledby="option-detail-title">
      <header class="option-detail-header">
        <div><span class="option-purpose">${escapeHtml(valueOr(option.category))}</span><h2 id="option-detail-title">${escapeHtml(valueOr(option.name))}<small>${escapeHtml(valueOr(option.english))}</small></h2><p>${escapeHtml(valueOr(option.purpose))}</p></div>
      </header>
      <div class="option-structure"><span>交易结构</span>${escapeHtml(valueOr(option.structure))}</div>
      <div class="option-leg-grid option-summary-legs"><div><span>买入腿</span>${renderList(option.buyLegs, 'compact-list')}</div><div><span>卖出腿</span>${renderList(option.sellLegs, 'compact-list')}</div><div><span>适用标的</span>${renderList(option.underlyings, 'compact-list')}</div></div>
      <div class="option-boundary-grid" aria-label="策略核心损益边界">
        <section><span>最大收益</span><strong>${escapeHtml(valueOr(option.maxGain))}</strong></section>
        <section class="loss"><span>最大亏损</span><strong>${escapeHtml(valueOr(option.maxLoss))}</strong></section>
        <section><span>盈亏平衡点</span><strong>${escapeHtml(valueOr(option.breakeven))}</strong></section>
      </div>
      <section class="option-visible-risk"><h3>主要风险</h3><p>${escapeHtml(valueOr(option.risk))}</p></section>

      <div class="option-detail-groups">
        <details class="option-detail-group" open><summary role="button" tabindex="0" aria-expanded="true">交易设计</summary><div class="option-planning-grid"><section><h3>市场方向</h3><p>${escapeHtml(valueOr(option.bias))}</p></section><section><h3>适用阶段</h3><p>${listOr(option.idealStages).map(escapeHtml).join(' / ')}</p></section><section><h3>不适用阶段</h3><p>${listOr(option.unsuitableStages).map(escapeHtml).join(' / ')}</p></section><section><h3>DTE逻辑</h3><p>${escapeHtml(valueOr(option.dteLogic))}</p></section><section><h3>行权价逻辑</h3><p>${escapeHtml(valueOr(option.strikeLogic))}</p></section><section><h3>建仓现金流</h3><p>${escapeHtml(valueOr(option.cashflow))}</p></section></div></details>
        <details class="option-detail-group"><summary role="button" tabindex="0" aria-expanded="false">市场表现</summary><div class="performance-grid"><section><span>上涨</span><p>${escapeHtml(valueOr(performance.up))}</p></section><section><span>横盘</span><p>${escapeHtml(valueOr(performance.sideways))}</p></section><section><span>下跌</span><p>${escapeHtml(valueOr(performance.down))}</p></section></div></details>
        <details class="option-detail-group"><summary role="button" tabindex="0" aria-expanded="false">时间和波动率</summary><div class="management-grid"><section><h3>Theta影响</h3><p>${escapeHtml(valueOr(option.thetaImpact))}</p></section><section><h3>IV影响</h3><p>${escapeHtml(valueOr(option.ivImpact))}</p></section></div></details>
        <details class="option-detail-group"><summary role="button" tabindex="0" aria-expanded="false">管理规则</summary><div class="management-grid"><section><h3>提前退出</h3><p>${escapeHtml(valueOr(option.earlyExit))}</p></section><section><h3>到期处理</h3><p>${escapeHtml(valueOr(option.expiration))}</p></section><section><h3>指派或行权风险</h3><p>${escapeHtml(valueOr(option.assignmentRisk, option.expiration))}</p></section><section><h3>机会成本</h3><p>${escapeHtml(valueOr(option.opportunityCost))}</p></section></div></details>
        <details class="option-detail-group formula-details"><summary role="button" tabindex="0" aria-expanded="false">公式与变量</summary><div class="variable-grid">${variables.map(item => `<div><strong>${escapeHtml(valueOr(item.symbol))}</strong><span>${escapeHtml(valueOr(item.meaning))}</span></div>`).join('')}</div><p><strong>示例假设：</strong>${escapeHtml(valueOr(example.scenario))}</p><p><strong>计算：</strong>${escapeHtml(valueOr(example.calculation))}</p><p><strong>解释：</strong>${escapeHtml(valueOr(example.conclusion))}</p><p>静态公式默认1张美股期权对应100股，未计佣金、税费、提前行权、指派和实际滑点；不使用伪造实时价格。</p></details>
      </div>
    </article>`;
}

function optionsTemplate(selectedId) {
  const categories = ['全部', '保护', '进攻', '收益增强'];
  const filtered = state.optionCategory === '全部' ? state.options : state.options.filter(option => option.category === state.optionCategory);
  const selected = state.options.find(option => option.id === selectedId) || filtered[0] || state.options[0];
  return `
    <div class="page">
      <div class="breadcrumb"><a href="#/">首页</a><span>/</span><span>期权工具</span></div>
      <header class="page-title"><div><p class="eyebrow">Option Toolkit</p><h1>八类期权工具</h1><p>从目录选择一种策略，集中核对结构、损益边界、管理规则和公式。</p></div></header>
      <div class="notice option-calculation-notice"><strong>计算口径</strong><span>示例公式按每股权利金表达，乘数按100计算；当前没有真实期权链或实时价格。</span></div>
      <div class="option-category-filter" role="group" aria-label="按策略分类筛选">${categories.map(category => `<button type="button" class="category-button${category === state.optionCategory ? ' active' : ''}" data-option-category="${escapeHtml(category)}" aria-pressed="${category === state.optionCategory}">${escapeHtml(category)}</button>`).join('')}</div>
      <label class="option-mobile-select">选择策略<select id="optionSelect">${state.options.map(option => `<option value="${escapeHtml(option.id)}"${option.id === selected.id ? ' selected' : ''}>${escapeHtml(option.english)} · ${escapeHtml(option.name)}</option>`).join('')}</select></label>
      <div class="option-workspace">
        <nav class="option-catalog" aria-label="期权策略目录">${filtered.map(option => `<a class="option-catalog-item${option.id === selected.id ? ' active' : ''}" href="#/options/${option.id}"${option.id === selected.id ? ' aria-current="page"' : ''}><span>${escapeHtml(option.english)}</span><small>${escapeHtml(option.name)} · ${escapeHtml(option.category)}</small></a>`).join('')}</nav>
        ${optionTemplate(selected)}
      </div>
    </div>`;
}

function indicatorsTemplate() {
  return `
    <div class="page">
      <div class="breadcrumb"><a href="#/">首页</a><span>/</span><span>指标说明</span></div>
      <header class="page-title"><div><p class="eyebrow">Indicator Reference</p><h1>六类辅助指标</h1><p>指标用于描述估值、实现波动率、风险偏好和期货市场机构仓位。数据状态逐项独立，且不构成网页自动判断。</p></div></header>
      <section class="indicator-list">
        ${state.indicators.map(indicator => {
          const market = state.marketData[indicator.id] || initialMarketModel(indicator);
          const status = DATA_STATUS[market.status] || DATA_STATUS.error;
          const value = market.value === null || market.value === undefined ? '—' : `${market.value}${market.unit || indicator.unit || ''}`;
          return `<article class="indicator-row reveal"><div><h2>${escapeHtml(indicator.name)}</h2><span class="metric-status" data-status="${status.tone}">${status.label} · ${escapeHtml(value)}</span><p>${escapeHtml(market.source || '—')} · ${escapeHtml(market.asOf || '无数据日期')}</p></div><div><strong>指标意义</strong><p>${escapeHtml(indicator.meaning)}</p></div><div><strong>使用限制</strong><p>${escapeHtml(indicator.limits)}</p></div></article>`;
        }).join('')}
      </section>
    </div>`;
}

function externalPeRangeCard(label, stats, currentPE) {
  const mean = Number(stats?.mean);
  const stdDev = Number(stats?.stdDev);
  if (!Number.isFinite(mean) || !Number.isFinite(stdDev) || stdDev <= 0) {
    return `<article class="external-pe-range is-unavailable"><h3>${escapeHtml(label)}</h3><p>源站未提供可唯一验证的均值和标准差。</p></article>`;
  }
  const low2 = mean - (2 * stdDev);
  const high2 = mean + (2 * stdDev);
  const position = hasFiniteValue(currentPE) && high2 > low2
    ? Math.max(0, Math.min(100, ((Number(currentPE) - low2) / (high2 - low2)) * 100))
    : null;
  const fixed = value => value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `<article class="external-pe-range">
    <div class="external-pe-range-heading"><h3>${escapeHtml(label)}</h3><strong>均值 ${fixed(mean)}x</strong></div>
    <div class="external-pe-band" aria-label="${escapeHtml(label)}估值统计区间：均值${fixed(mean)}，标准差${fixed(stdDev)}">
      <span class="external-pe-band-one"></span>
      <i class="external-pe-mean" aria-hidden="true"></i>
      ${position === null ? '' : `<b class="external-pe-current" style="left:${position.toFixed(2)}%" aria-hidden="true"></b>`}
    </div>
    <dl><div><dt>±1σ</dt><dd>${fixed(mean - stdDev)}–${fixed(mean + stdDev)}x</dd></div><div><dt>±2σ</dt><dd>${fixed(low2)}–${fixed(high2)}x</dd></div></dl>
  </article>`;
}

function externalPeSeriesMarkup(external) {
  const history = external.history || {};
  const published = Array.isArray(history.publishedSeries) ? history.publishedSeries : [];
  const snapshots = Array.isArray(history.snapshots) ? history.snapshots : [];
  const points = published.length > 1 ? published : snapshots.length > 1
    ? snapshots.map(point => ({ date: point.sourceDataDate, value: point.currentPE }))
    : [];
  const label = published.length > 1 ? 'WorldPEratio公开历史PE曲线' : '本站每日快照曲线';
  if (points.length < 2) {
    return `<div class="external-pe-series-empty" role="status"><strong>快照历史正在积累</strong><span>当前只有 ${snapshots.length} 个去重快照；不足2点时不绘制折线。</span></div>`;
  }
  const chart = seriesToPath(points.map(point => Number(point.value)), 720, 180, 12);
  return `<figure class="external-pe-series"><figcaption>${escapeHtml(label)}</figcaption><svg viewBox="0 0 720 180" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)}，${points.length}个真实数据点"><line class="baseline" x1="0" x2="720" y1="90" y2="90"></line><path class="line" d="${chart.line}"></path></svg><p>${escapeHtml(points[0].date)} 至 ${escapeHtml(points.at(-1).date)} · ${points.length}点</p></figure>`;
}

function externalPeTemplate() {
  const external = state.externalPE;
  if (external.loading && !external.loaded) return '<section class="content-card external-pe-section"><h2>外部参考PE</h2><p>正在读取本地 WorldPEratio 缓存…</p></section>';
  if (external.error || !external.statistics) return '<section class="content-card external-pe-section"><h2>外部参考PE</h2><p>本地外部参考数据暂不可用；本站自计算PE不受影响。</p></section>';
  const stats = external.statistics;
  const latest = external.latest || {};
  const status = DATA_STATUS[stats.status] || DATA_STATUS.unavailable;
  const current = hasFiniteValue(stats.currentPE) ? `${Number(stats.currentPE).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x` : '—';
  const ranges = [['1年', '1y'], ['5年', '5y'], ['10年', '10y'], ['20年', '20y']];
  const seriesNote = stats.seriesAvailability === 'full_series_available'
    ? '源站响应包含明确日期和值的公开历史序列。'
    : '源站仅提供汇总统计；本站历史曲线从首次采集日期开始积累。';
  return `<section class="external-pe-section" aria-labelledby="externalPeTitle">
    <div class="external-pe-header"><div><p class="eyebrow">External Reference Data</p><h2 id="externalPeTitle">外部参考PE</h2><p>WorldPEratio 的 Nasdaq-100/QQQ 参考值，不是本站算法结果，也不会覆盖本站自计算PE。</p></div><span class="metric-status" data-status="${status.tone}">${status.label}</span></div>
    <div class="external-pe-summary"><article><span>当前参考PE</span><strong>${escapeHtml(current)}</strong></article><dl><div><dt>数据日期</dt><dd>${escapeHtml(stats.sourceDataDate || '—')}</dd></div><div><dt>抓取时间</dt><dd>${escapeHtml(formatDateTime(stats.fetchedAt))}</dd></div><div><dt>估值标签</dt><dd>${escapeHtml(stats.valuationLabel || '—')}</dd></div><div><dt>数据来源</dt><dd><a href="${escapeHtml(latest.sourceUrl || stats.sourceUrl || '#')}" target="_blank" rel="noreferrer">WorldPEratio · 外部参考数据</a></dd></div></dl></div>
    <div class="notice"><strong>图表口径</strong><span>${escapeHtml(seriesNote)}</span></div>
    <div class="external-pe-ranges">${ranges.map(([label, key]) => externalPeRangeCard(label, stats.historicalStats?.[key], stats.currentPE)).join('')}</div>
    ${externalPeSeriesMarkup(external)}
  </section>`;
}

function metricDetailTemplate(id) {
  const indicator = state.indicators.find(item => item.id === id);
  if (!indicator) return `<div class="page"><div class="notice"><strong>该指标当前版本未启用</strong><span>当前正式范围仅包含首页展示的六项指标。</span></div></div>`;
  const market = state.marketData[id] || initialMarketModel(indicator); const status = DATA_STATUS[market.status] || DATA_STATUS.error;
  const history = Array.isArray(market.history) ? market.history : []; const values = history.map(point => Number(point.value)).filter(Number.isFinite); const chart = values.length > 1 ? seriesToPath(values, 720, 220, 14) : null;
  const high = values.length ? Math.max(...values) : null; const low = values.length ? Math.min(...values) : null; const isPe = id.endsWith('_pe');
  const statistics = market.historicalStatistics || {}; const ranges = [['1年', '1y'], ['5年', '5y'], ['10年', '10y'], ['20年', '20y']];
  const statsMarkup = isPe ? `<section class="external-pe-ranges">${ranges.map(([label, key]) => externalPeRangeCard(label, { mean: statistics[key]?.average, stdDev: statistics[key]?.standardDeviation }, market.value)).join('')}</section>` : '';
  const rangeKey = state.ranges[id] || '1Y';
  const rangeTabs = `<div class="range-tabs detail-range-tabs" role="group" aria-label="历史时间范围">${RANGE_KEYS.map((key, index) => `<button class="range-tab${key === rangeKey ? ' active' : ''}" data-indicator-id="${id}" data-range="${key}" type="button" aria-pressed="${key === rangeKey}">${RANGE_LABELS[index]}</button>`).join('')}</div>`;
  const chartPoints = history.map(point => ({ date: point.date, value: Number(point.value) })).filter(point => point.date && Number.isFinite(point.value));
  const lastPoint = chart?.points?.at(-1);
  const chartMarkup = chart ? `<figure class="external-pe-series interactive-history-chart" data-chart-points="${escapeHtml(JSON.stringify(chartPoints))}"><figcaption>${isPe ? '真实快照曲线' : '真实日频历史曲线'}</figcaption><div class="history-chart-frame"><svg viewBox="0 0 720 220" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(indicator.name)}真实历史曲线"><line class="baseline" x1="14" x2="706" y1="206" y2="206"></line><path class="line" d="${chart.line}"></path><circle class="current-marker" cx="${lastPoint?.[0]}" cy="${lastPoint?.[1]}" r="5"></circle></svg><output class="history-chart-tooltip" hidden></output></div><div class="history-chart-axis history-chart-axis-y"><span>${high}</span><span>${low}</span></div><div class="history-chart-axis history-chart-axis-x"><span>${escapeHtml(history[0]?.date)}</span><span>${escapeHtml(history.at(-1)?.date)}</span></div><p>${history.length}点 · 低点 ${low} · 高点 ${high}</p></figure>` : `<div class="external-pe-series-empty"><strong>${history.length ? '当前PE与历史统计区间' : '暂无数据'}</strong><span>${isPe ? `当前有${history.length}个真实快照；不足2点不绘制折线。` : '历史不足2点时不绘制折线。'}</span></div>`;
  return `<div class="page"><div class="breadcrumb"><a href="#/">首页</a><span>/</span><a href="#/indicators">指标说明</a><span>/</span><span>${escapeHtml(indicator.name)}</span></div><header class="page-title"><div><p class="eyebrow">Market Data</p><h1>${escapeHtml(indicator.name)}</h1><p>${escapeHtml(indicator.definition)}</p></div><span class="metric-status" data-status="${status.tone}">${status.label}</span></header><section class="external-pe-section"><div class="external-pe-summary"><article><span>当前值</span><strong>${hasFiniteValue(market.value) ? escapeHtml(market.value) : '—'}${isPe ? 'x' : ''}</strong></article><dl><div><dt>数据日期</dt><dd>${escapeHtml(market.asOf || '—')}</dd></div><div><dt>数据来源</dt><dd>${escapeHtml(market.source || '—')}</dd></div><div><dt>更新时间</dt><dd>${escapeHtml(formatDateTime(market.updatedAt))}</dd></div><div><dt>${isPe ? '估值标签' : '相对前值'}</dt><dd>${escapeHtml(isPe ? market.valuationLabel || '—' : hasFiniteValue(market.change) ? market.change : '—')}</dd></div></dl></div><h2>${isPe ? '当前PE与历史统计区间' : '历史曲线'}</h2>${statsMarkup}${rangeTabs}${chartMarkup}<div class="notice"><strong>数据说明</strong><span>本站数据仅用于个人市场观察和研究，不构成投资建议。数据可能存在延迟、修订或来源口径差异。</span></div>${isPe ? '<div class="notice"><strong>PE口径</strong><span>Nasdaq-100和S&P 500 PE来自第三方公开参考数据，不代表指数编制机构官方估值。PE历史曲线从本站首次成功采集日期开始积累。</span></div>' : '<div class="notice"><strong>FRED口径</strong><span>数据通过FRED获取，原始来源以指标详情页标注为准。</span></div>'}</section></div>`;
}

function naaimObservationTemplate() {
  const model = state.naaim || {}; const status = DATA_STATUS[model.status] || DATA_STATUS.unavailable;
  const history = model.history || []; const values = history.map(point => Number(point.value)).filter(Number.isFinite); const chart = values.length > 1 ? seriesToPath(values, 680, 132, 10) : null;
  const value = hasFiniteValue(model.value) ? Number(model.value).toFixed(2) : '—';
  return `<section class="naaim-observation section reveal"><div class="section-heading"><div><p class="eyebrow">INSTITUTIONAL EXPOSURE</p><h2>机构敞口观察</h2><p>NAAIM Exposure Index反映参与调查的主动投资经理所报告的美国股票市场平均敞口，不代表全部基金经理或机构的实际持仓。</p></div><a class="button ghost" href="#/indicator/naaim-exposure">查看详细分析</a></div><article class="naaim-card"><div><span class="metric-status" data-status="${status.tone}">${status.label}</span><h3>NAAIM主动投资经理美股敞口</h3><strong class="naaim-value">${value}</strong><small>数据日期：${escapeHtml(model.asOf || '—')}</small></div><dl><div><dt>较上周变化</dt><dd>${hasFiniteValue(model.change) ? Number(model.change).toFixed(2) : '—'}</dd></div><div><dt>四周移动平均</dt><dd>${hasFiniteValue(model.fourWeekAverage) ? Number(model.fourWeekAverage).toFixed(2) : '—'}</dd></div><div><dt>一年历史分位</dt><dd>${hasFiniteValue(model.oneYearPercentile) ? `${Number(model.oneYearPercentile).toFixed(1)}%` : '—'}</dd></div><div><dt>数据来源</dt><dd>NAAIM官方Excel本地导入</dd></div></dl>${chart ? `<figure class="naaim-mini-chart"><svg viewBox="0 0 680 132" preserveAspectRatio="none" aria-label="NAAIM最近52周趋势"><path class="line" d="${chart.line}"></path></svg><figcaption>最近52周趋势 · 非交易信号</figcaption></figure>` : '<p>尚未导入NAAIM官方数据。</p>'}</article></section>`;
}

function naaimDetailTemplate() {
  const model = state.naaim || {}; const status = DATA_STATUS[model.status] || DATA_STATUS.unavailable; const history = model.history || [];
  const values = history.map(point => Number(point.value)).filter(Number.isFinite); const chart = values.length > 1 ? seriesToPath(values, 720, 220, 14) : null;
  const range = state.naaimRange || 'ALL'; const rangeButtons = [['6M','6个月'],['1Y','1年'],['3Y','3年'],['5Y','5年'],['10Y','10年'],['ALL','全历史']].map(([key,label]) => `<button class="range-tab${range === key ? ' active' : ''}" data-naaim-range="${key}" type="button">${label}</button>`).join('');
  return `<section class="page"><div class="breadcrumb"><a href="#/">首页</a><span>/</span><span>NAAIM主动投资经理美股敞口</span></div><header class="page-title"><div><p class="eyebrow">WEEKLY · LOCAL IMPORT</p><h1>NAAIM主动投资经理美股敞口</h1><p>NAAIM Exposure Index为参与调查的主动投资经理报告的美国股票平均敞口；不是预测、买卖信号或全部机构持仓。</p></div><span class="metric-status" data-status="${status.tone}">${status.label}</span></header><section class="naaim-card naaim-detail"><div><span>当前敞口</span><strong class="naaim-value">${hasFiniteValue(model.value) ? Number(model.value).toFixed(2) : '—'}</strong><small>${escapeHtml(model.asOf || '—')}</small></div><dl><div><dt>上周变化</dt><dd>${hasFiniteValue(model.change) ? Number(model.change).toFixed(2) : '—'}</dd></div><div><dt>四周均值</dt><dd>${hasFiniteValue(model.fourWeekAverage) ? Number(model.fourWeekAverage).toFixed(2) : '—'}</dd></div><div><dt>一年分位</dt><dd>${hasFiniteValue(model.oneYearPercentile) ? `${Number(model.oneYearPercentile).toFixed(1)}%` : '—'}</dd></div><div><dt>全历史分位</dt><dd>${hasFiniteValue(model.allHistoryPercentile) ? `${Number(model.allHistoryPercentile).toFixed(1)}%` : '—'}</dd></div><div><dt>近52周区间</dt><dd>${hasFiniteValue(model.oneYearLow) ? `${model.oneYearLow} 至 ${model.oneYearHigh}` : '—'}</dd></div><div><dt>排除冲突日期</dt><dd>${model.excludedConflictDateCount || 0}</dd></div></dl></section><section class="external-pe-section"><div class="range-tabs">${rangeButtons}</div>${chart ? `<figure class="external-pe-series interactive-history-chart" data-chart-points="${escapeHtml(JSON.stringify(history))}"><figcaption>完整周频历史 · 0为现金、对冲或市场中性参考；100为完全投资参考</figcaption><div class="history-chart-frame"><svg viewBox="0 0 720 220" preserveAspectRatio="none" aria-label="NAAIM周频历史"><line class="baseline" x1="14" x2="706" y1="206" y2="206"></line><path class="line" d="${chart.line}"></path></svg><output class="history-chart-tooltip" hidden></output></div></figure>` : '<div class="notice"><strong>暂无数据</strong><span>尚未导入NAAIM官方数据。</span></div>'}<div class="notice"><strong>数据限制</strong><span>NAAIM官方工作簿中有2个早期同日冲突日期，本站未选择其中任何值，已将这些日期从正式序列中排除。调查参与者有限、策略不同，指标不构成投资建议。</span></div><div class="notice"><strong>本地导入状态</strong><span>服务器不会自动访问NAAIM或MacroMicro。</span></div></section></section>`;
}

function formatPercent(value, digits = 1) {
  if (!Number.isFinite(Number(value))) return '—';
  const percentage = Number(value) * 100;
  return `${percentage > 0 ? '+' : ''}${percentage.toFixed(digits)}%`;
}

function subtractCalendarYears(dateString, years) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function drawdownRangeFor(series) {
  if (!series?.length) return null;
  const firstDate = series[0].date;
  const lastDate = series.at(-1).date;
  if (state.drawdown.preset === 'CUSTOM') {
    const startDate = state.drawdown.customStart || firstDate;
    const endDate = state.drawdown.customEnd || lastDate;
    if (startDate > endDate) return { error: '起始日期不能晚于结束日期。', firstDate, lastDate };
    if (startDate < firstDate || endDate > lastDate) return { error: '所选日期必须位于当前指数的实际数据范围内。', firstDate, lastDate };
    return { startDate, endDate, firstDate, lastDate, label: `${startDate} 至 ${endDate}`, limited: false };
  }
  const preset = DRAWDOWN_PRESETS.find(([key]) => key === state.drawdown.preset) || DRAWDOWN_PRESETS[3];
  const requestedStart = preset[2] ? subtractCalendarYears(lastDate, preset[2]) : firstDate;
  const startDate = requestedStart < firstDate ? firstDate : requestedStart;
  return {
    startDate,
    endDate: lastDate,
    firstDate,
    lastDate,
    label: preset[1],
    limited: requestedStart < firstDate
  };
}

function drawdownAnalysisView() {
  const primarySeries = drawdownDatasetCache.get(state.drawdown.primaryId);
  if (!primarySeries) return null;
  const range = drawdownRangeFor(primarySeries);
  if (range?.error) return { range, error: range.error };
  const cacheKey = [state.drawdown.primaryId, state.drawdown.comparisonId, range.startDate, range.endDate].join('|');
  if (state.drawdown.calculationCache.has(cacheKey)) return { ...state.drawdown.calculationCache.get(cacheKey), range };
  const filteredPrimary = DrawdownAnalysis.filterSeriesByDateRange(primarySeries, range.startDate, range.endDate);
  const comparisonAll = state.drawdown.comparisonId ? drawdownDatasetCache.get(state.drawdown.comparisonId) : null;
  const filteredComparison = comparisonAll
    ? DrawdownAnalysis.filterSeriesByDateRange(comparisonAll, range.startDate, range.endDate)
    : [];
  const summary = DrawdownAnalysis.calculateDrawdownSummary(filteredPrimary);
  const aligned = DrawdownAnalysis.alignComparisonSeries(filteredPrimary, filteredComparison);
  const result = {
    primarySeries: filteredPrimary,
    comparisonSeries: filteredComparison,
    summary,
    aligned,
    annualReturns: DrawdownAnalysis.calculateAnnualReturns(filteredPrimary),
    distribution: DrawdownAnalysis.calculateDrawdownDistribution(summary?.episodes || [])
  };
  state.drawdown.calculationCache.set(cacheKey, result);
  if (state.drawdown.calculationCache.size > 24) state.drawdown.calculationCache.delete(state.drawdown.calculationCache.keys().next().value);
  return { ...result, range };
}

function sampleChartPoints(points, maxPoints, preserveDates = []) {
  if (points.length <= maxPoints) return points;
  const indexes = new Set([0, points.length - 1]);
  for (let index = 0; index < maxPoints; index += 1) indexes.add(Math.round(index * (points.length - 1) / (maxPoints - 1)));
  const byDate = new Map(points.map((point, index) => [point.date, index]));
  preserveDates.forEach(date => { if (byDate.has(date)) indexes.add(byDate.get(date)); });
  return [...indexes].sort((left, right) => left - right).map(index => points[index]);
}

function chartCoordinates(points, key, { width = 1000, height = 230, padX = 18, padY = 18, minValue, maxValue, startDate, endDate } = {}) {
  if (!points.length) return [];
  const start = new Date(`${startDate || points[0].date}T00:00:00Z`).valueOf();
  const end = new Date(`${endDate || points.at(-1).date}T00:00:00Z`).valueOf();
  const low = Number.isFinite(minValue) ? minValue : Math.min(...points.map(point => Number(point[key])));
  const high = Number.isFinite(maxValue) ? maxValue : Math.max(...points.map(point => Number(point[key])));
  const span = Math.max(high - low, Number.EPSILON);
  return points.map(point => {
    const time = new Date(`${point.date}T00:00:00Z`).valueOf();
    return {
      ...point,
      x: padX + ((time - start) / Math.max(end - start, 1)) * (width - padX * 2),
      y: padY + ((high - Number(point[key])) / span) * (height - padY * 2)
    };
  });
}

function coordinatesPath(points) {
  return points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}

function chartPointCoordinate(point, key, options) {
  return chartCoordinates([point], key, options)[0] || null;
}

function drawdownChartMarkup(view) {
  const { summary, aligned, range } = view;
  const maximumEpisode = summary.maximumEpisode;
  const preserved = [maximumEpisode?.peakDate, maximumEpisode?.troughDate, maximumEpisode?.recoveryDate, summary.lastDate].filter(Boolean);
  const drawdownPoints = sampleChartPoints(summary.drawdowns, 620, preserved);
  const drawdownMin = Math.min(summary.maximumDrawdown, -0.01) * 1.08;
  const drawdownCoords = chartCoordinates(drawdownPoints, 'drawdown', { minValue: drawdownMin, maxValue: 0, startDate: range.startDate, endDate: range.endDate });
  const baselineY = 18;
  const areaPath = drawdownCoords.length ? `${coordinatesPath(drawdownCoords)} L${drawdownCoords.at(-1).x.toFixed(2)},${baselineY} L${drawdownCoords[0].x.toFixed(2)},${baselineY} Z` : '';
  const maximumCoord = drawdownCoords.find(point => point.date === summary.maximumDrawdownDate);
  const ongoing = summary.episodes.find(episode => episode.status === 'ongoing');
  const dateX = date => chartCoordinates([{ date, value: 0 }], 'value', { minValue: 0, maxValue: 1, startDate: range.startDate, endDate: range.endDate })[0]?.x || 18;
  const ongoingX = ongoing ? dateX(ongoing.peakDate) : null;
  const maximumPeakX = maximumEpisode ? dateX(maximumEpisode.peakDate) : null;
  const maximumTroughX = maximumEpisode ? dateX(maximumEpisode.troughDate) : null;
  const primaryNormalized = sampleChartPoints(aligned.primary, 620, [aligned.startDate, summary.lastDate]);
  const comparisonNormalized = sampleChartPoints(aligned.comparison, 620, [aligned.startDate]);
  const allNormalized = [...primaryNormalized, ...comparisonNormalized];
  const normalizedLow = allNormalized.length ? Math.min(...allNormalized.map(point => point.normalizedValue)) : 90;
  const normalizedHigh = allNormalized.length ? Math.max(...allNormalized.map(point => point.normalizedValue)) : 110;
  const normalizedPad = Math.max((normalizedHigh - normalizedLow) * 0.08, 1);
  const normalizedOptions = { minValue: normalizedLow - normalizedPad, maxValue: normalizedHigh + normalizedPad, startDate: range.startDate, endDate: range.endDate };
  const primaryCoords = chartCoordinates(primaryNormalized, 'normalizedValue', normalizedOptions);
  const comparisonCoords = chartCoordinates(comparisonNormalized, 'normalizedValue', normalizedOptions);
  const baseCoords = chartCoordinates([{ date: range.startDate, normalizedValue: 100 }, { date: range.endDate, normalizedValue: 100 }], 'normalizedValue', normalizedOptions);
  return `<section class="drawdown-chart-card" aria-labelledby="drawdownChartTitle">
    <div class="section-heading compact"><div><h2 id="drawdownChartTitle">回撤与归一化走势</h2><p>上图使用负百分比显示每日回撤；下图从首个共同交易日以100为起点。</p></div></div>
    <p class="sr-only" aria-live="polite" data-drawdown-chart-live></p>
    <div class="drawdown-chart-stack">
      <figure class="drawdown-chart drawdown-interactive-chart" data-chart-type="drawdown">
        <figcaption><strong>每日回撤</strong><span>0%位于顶部 · 最深 ${formatPercent(summary.maximumDrawdown, 2)}</span></figcaption>
        <div class="drawdown-chart-frame">
          <svg viewBox="0 0 1000 230" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(DRAWDOWN_METRICS[state.drawdown.primaryId].label)}每日回撤面积图">
            ${ongoingX === null ? '' : `<rect class="ongoing-zone" x="${ongoingX.toFixed(2)}" y="18" width="${Math.max(0, 982 - ongoingX).toFixed(2)}" height="194"></rect>`}
            ${maximumPeakX === null ? '' : `<rect class="maximum-zone" x="${maximumPeakX.toFixed(2)}" y="18" width="${Math.max(2, maximumTroughX - maximumPeakX).toFixed(2)}" height="194"></rect>`}
            <line class="zero-line" x1="18" x2="982" y1="${baselineY}" y2="${baselineY}"></line>
            <path class="drawdown-area" d="${areaPath}"></path>
            <path class="drawdown-line" d="${coordinatesPath(drawdownCoords)}"></path>
            <line class="drawdown-chart-crosshair" x1="18" x2="18" y1="18" y2="212" hidden style="display:none"></line>
            <circle class="drawdown-chart-marker primary" cx="18" cy="18" r="5" hidden style="display:none"></circle>
            ${maximumCoord ? `<circle class="maximum-marker" cx="${maximumCoord.x.toFixed(2)}" cy="${maximumCoord.y.toFixed(2)}" r="6"></circle><text class="maximum-label" x="${Math.min(maximumCoord.x + 10, 932).toFixed(2)}" y="${Math.max(maximumCoord.y - 10, 36).toFixed(2)}">${formatPercent(summary.maximumDrawdown, 1)}</text>` : ''}
            <rect class="drawdown-chart-pointer-capture" x="18" y="18" width="964" height="194" fill="transparent" tabindex="0" role="application" aria-label="每日回撤图。使用左右方向键按交易日移动日期游标，Escape关闭提示。"></rect>
          </svg>
          <output class="drawdown-chart-tooltip" hidden></output>
        </div>
        <div class="drawdown-chart-axis"><span>0%</span><span>${formatPercent(drawdownMin, 0)}</span></div>
        <div class="drawdown-chart-dates"><span>${escapeHtml(range.startDate)}</span><span>${escapeHtml(range.endDate)}</span></div>
      </figure>
      <figure class="drawdown-chart drawdown-interactive-chart" data-chart-type="normalized">
        <figcaption><strong>归一化走势</strong><span>鼠标悬停或触摸图表查看主对象数据</span></figcaption>
        <div class="drawdown-chart-frame">
          <svg viewBox="0 0 1000 230" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(DRAWDOWN_METRICS[state.drawdown.primaryId].label)}${state.drawdown.comparisonId ? `与${escapeHtml(DRAWDOWN_METRICS[state.drawdown.comparisonId].label)}` : ''}归一化走势对比">
            ${baseCoords.length ? `<line class="normalization-line" x1="${baseCoords[0].x}" x2="${baseCoords[1].x}" y1="${baseCoords[0].y}" y2="${baseCoords[1].y}"></line>` : ''}
            <path class="normalized-primary" d="${coordinatesPath(primaryCoords)}"></path>
            ${comparisonCoords.length ? `<path class="normalized-comparison" d="${coordinatesPath(comparisonCoords)}"></path>` : ''}
            <line class="drawdown-chart-crosshair" x1="18" x2="18" y1="18" y2="212" hidden style="display:none"></line>
            <circle class="drawdown-chart-marker primary" cx="18" cy="18" r="5" hidden style="display:none"></circle>
            <circle class="drawdown-chart-marker comparison" cx="18" cy="18" r="5" hidden style="display:none"></circle>
            <rect class="drawdown-chart-pointer-capture" x="18" y="18" width="964" height="194" fill="transparent" tabindex="0" role="application" aria-label="归一化走势图。使用左右方向键按交易日移动日期游标，Escape关闭提示。"></rect>
          </svg>
          <output class="drawdown-chart-tooltip" hidden></output>
        </div>
        <div class="drawdown-chart-legend"><span class="primary">${escapeHtml(DRAWDOWN_METRICS[state.drawdown.primaryId].shortLabel)}</span>${state.drawdown.comparisonId && comparisonCoords.length ? `<span class="comparison">${escapeHtml(DRAWDOWN_METRICS[state.drawdown.comparisonId].shortLabel)}</span>` : ''}<span class="baseline">起点100</span></div>
        <div class="drawdown-chart-dates"><span>${escapeHtml(aligned.startDate || range.startDate)}</span><span>${escapeHtml(range.endDate)}</span></div>
      </figure>
    </div>
  </section>`;
}

function clearDrawdownChartInteraction({ clearDate = false } = {}) {
  drawdownChartInteraction?.destroy();
  drawdownChartInteraction = null;
  if (clearDate) state.drawdown.selectedChartDate = null;
  state.drawdown.chartCursorVisible = false;
}

function drawdownEpisodeForDate(episodes, date) {
  return episodes.find(episode => date >= episode.peakDate && (!episode.recoveryDate || date <= episode.recoveryDate)) || null;
}

function createDrawdownChartInteraction(view) {
  const interactionApi = globalThis.DrawdownChartInteractions;
  if (!interactionApi || !view?.summary || !view?.range) return null;
  const liveRegion = document.querySelector('[data-drawdown-chart-live]');
  const primaryMetric = DRAWDOWN_METRICS[state.drawdown.primaryId];
  const comparisonMetric = state.drawdown.comparisonId ? DRAWDOWN_METRICS[state.drawdown.comparisonId] : null;
  const drawdownOptions = { minValue: Math.min(view.summary.maximumDrawdown, -0.01) * 1.08, maxValue: 0, startDate: view.range.startDate, endDate: view.range.endDate };
  const sampledPrimary = sampleChartPoints(view.aligned.primary, 620, [view.aligned.startDate, view.summary.lastDate]);
  const sampledComparison = sampleChartPoints(view.aligned.comparison, 620, [view.aligned.startDate]);
  const normalizedValues = [...sampledPrimary, ...sampledComparison];
  const normalizedLow = normalizedValues.length ? Math.min(...normalizedValues.map(point => point.normalizedValue)) : 90;
  const normalizedHigh = normalizedValues.length ? Math.max(...normalizedValues.map(point => point.normalizedValue)) : 110;
  const normalizedPad = Math.max((normalizedHigh - normalizedLow) * 0.08, 1);
  const normalizedOptions = { minValue: normalizedLow - normalizedPad, maxValue: normalizedHigh + normalizedPad, startDate: view.range.startDate, endDate: view.range.endDate };
  const chartDefinitions = {
    drawdown: { points: view.summary.drawdowns, comparison: [], key: 'drawdown', options: drawdownOptions },
    normalized: { points: view.aligned.primary, comparison: view.aligned.comparison, key: 'normalizedValue', options: normalizedOptions }
  };
  const registrations = [];
  let animationFrame = 0;
  let pendingPointer = null;

  const chartElements = [...document.querySelectorAll('.drawdown-interactive-chart')].map(figure => {
    const type = figure.dataset.chartType;
    const definition = chartDefinitions[type];
    const frame = figure.querySelector('.drawdown-chart-frame');
    const crosshair = figure.querySelector('.drawdown-chart-crosshair');
    const primaryMarker = figure.querySelector('.drawdown-chart-marker.primary');
    const comparisonMarker = figure.querySelector('.drawdown-chart-marker.comparison');
    const tooltip = figure.querySelector('.drawdown-chart-tooltip');
    const capture = figure.querySelector('.drawdown-chart-pointer-capture');
    return definition && frame && crosshair && primaryMarker && tooltip && capture ? { type, definition, frame, crosshair, primaryMarker, comparisonMarker, tooltip, capture } : null;
  }).filter(Boolean);
  if (!chartElements.length) return null;

  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    registrations.push(() => target.removeEventListener(event, handler, options));
  };
  const hide = () => {
    state.drawdown.chartCursorVisible = false;
    chartElements.forEach(chart => {
      chart.crosshair.setAttribute('hidden', '');
      chart.crosshair.style.display = 'none';
      chart.crosshair.classList.remove('is-visible');
      chart.primaryMarker.setAttribute('hidden', '');
      chart.primaryMarker.style.display = 'none';
      chart.primaryMarker.classList.remove('is-visible');
      if (chart.comparisonMarker) {
        chart.comparisonMarker.setAttribute('hidden', '');
        chart.comparisonMarker.style.display = 'none';
        chart.comparisonMarker.classList.remove('is-visible');
      }
      chart.tooltip.hidden = true;
    });
  };
  const tooltipPlacement = (tooltip, x) => {
    const percent = Math.max(4, Math.min(96, x / 1000 * 100));
    tooltip.style.left = `${percent}%`;
    tooltip.classList.toggle('align-left', percent > 72);
  };
  const updateChart = (chart, selectedDate) => {
    const primaryPoint = interactionApi.findNearestDataPointByDate(chart.definition.points, selectedDate);
    if (!primaryPoint) return null;
    const primaryCoord = chartPointCoordinate(primaryPoint, chart.definition.key, chart.definition.options);
    if (!primaryCoord) return null;
    chart.crosshair.setAttribute('x1', primaryCoord.x.toFixed(2));
    chart.crosshair.setAttribute('x2', primaryCoord.x.toFixed(2));
    chart.primaryMarker.setAttribute('cx', primaryCoord.x.toFixed(2));
    chart.primaryMarker.setAttribute('cy', primaryCoord.y.toFixed(2));
    chart.crosshair.removeAttribute('hidden');
    chart.crosshair.style.display = 'inline';
    chart.crosshair.classList.add('is-visible');
    chart.primaryMarker.removeAttribute('hidden');
    chart.primaryMarker.style.display = 'inline';
    chart.primaryMarker.classList.add('is-visible');
    if (chart.type === 'drawdown') {
      const episode = drawdownEpisodeForDate(view.summary.episodes, primaryPoint.date);
      chart.tooltip.innerHTML = `<strong>${primaryPoint.date}</strong><span>${escapeHtml(primaryMetric.label)} · 回撤 ${formatPercent(primaryPoint.drawdown, 2)}</span><span>${episode ? `事件：${episode.status === 'ongoing' ? '回撤中' : '已恢复'}（${episode.peakDate} → ${episode.troughDate}）` : '状态：正常'}</span>`;
    } else {
      const comparisonPoint = interactionApi.findNearestDataPointByDate(chart.definition.comparison, primaryPoint.date);
      if (chart.comparisonMarker && comparisonPoint) {
        const comparisonCoord = chartPointCoordinate(comparisonPoint, 'normalizedValue', chart.definition.options);
        chart.comparisonMarker.setAttribute('cx', comparisonCoord.x.toFixed(2));
        chart.comparisonMarker.setAttribute('cy', comparisonCoord.y.toFixed(2));
        chart.comparisonMarker.removeAttribute('hidden');
        chart.comparisonMarker.style.display = 'inline';
        chart.comparisonMarker.classList.add('is-visible');
      } else if (chart.comparisonMarker) {
        chart.comparisonMarker.setAttribute('hidden', '');
        chart.comparisonMarker.style.display = 'none';
        chart.comparisonMarker.classList.remove('is-visible');
      }
      const primaryChange = primaryPoint.normalizedValue / 100 - 1;
      const comparisonText = comparisonPoint && comparisonMetric
        ? `<span>${escapeHtml(comparisonMetric.label)} · ${comparisonPoint.normalizedValue.toFixed(2)}（${formatPercent(comparisonPoint.normalizedValue / 100 - 1, 2)}）${comparisonPoint.date === primaryPoint.date ? '' : ` · 实际日期 ${comparisonPoint.date}`}</span>`
        : '';
      chart.tooltip.innerHTML = `<strong>${primaryPoint.date}</strong><span>${escapeHtml(primaryMetric.label)} · ${primaryPoint.normalizedValue.toFixed(2)}（${formatPercent(primaryChange, 2)}）</span>${comparisonText}`;
    }
    tooltipPlacement(chart.tooltip, primaryCoord.x);
    chart.tooltip.hidden = false;
    return primaryPoint;
  };
  const selectDate = (date, { announce = false } = {}) => {
    if (!date) return;
    state.drawdown.selectedChartDate = date;
    state.drawdown.chartCursorVisible = true;
    const selected = chartElements.map(chart => updateChart(chart, date)).filter(Boolean);
    if (announce && selected[0]) {
      const normalized = selected.find(point => point.normalizedValue !== undefined);
      liveRegion.textContent = `${selected[0].date}，${primaryMetric.label} ${selected[0].drawdown !== undefined ? `回撤 ${formatPercent(selected[0].drawdown, 2)}` : `归一化值 ${selected[0].normalizedValue.toFixed(2)}`}${normalized && selected[0] !== normalized ? `，归一化值 ${normalized.normalizedValue.toFixed(2)}` : ''}`;
    }
  };
  const queuePointer = (chart, event) => {
    pendingPointer = { chart, clientX: event.clientX };
    if (animationFrame) return;
    animationFrame = requestAnimationFrame(() => {
      animationFrame = 0;
      const next = pendingPointer;
      pendingPointer = null;
      const rect = next.chart.frame.getBoundingClientRect();
      const point = interactionApi.findNearestDataPointByX(next.chart.definition.points, next.clientX, rect, next.chart.definition.options.startDate, next.chart.definition.options.endDate);
      if (point) selectDate(point.date);
    });
  };
  const indexForDate = (points, date) => points.findIndex(point => point.date === interactionApi.findNearestDataPointByDate(points, date)?.date);

  chartElements.forEach(chart => {
    let touchStart = null;
    const pointerEnter = event => { if (event.pointerType !== 'touch') queuePointer(chart, event); };
    const pointerMove = event => {
      if (event.pointerType === 'touch' && touchStart) {
        const dx = event.clientX - touchStart.x;
        const dy = event.clientY - touchStart.y;
        if (!touchStart.tracking && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) return;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
          touchStart.tracking = true;
          chart.capture.setPointerCapture?.(event.pointerId);
        }
        if (touchStart.tracking) event.preventDefault();
      }
      queuePointer(chart, event);
    };
    const pointerDown = event => {
      const rect = chart.frame.getBoundingClientRect();
      const point = interactionApi.findNearestDataPointByX(chart.definition.points, event.clientX, rect, chart.definition.options.startDate, chart.definition.options.endDate);
      touchStart = event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY, date: point?.date || null, priorDate: state.drawdown.selectedChartDate, priorVisible: state.drawdown.chartCursorVisible, tracking: false } : null;
      if (point) selectDate(point.date);
    };
    const pointerUp = event => {
      if (event.pointerType === 'touch' && touchStart && !touchStart.tracking && touchStart.priorVisible && touchStart.priorDate === touchStart.date) hide();
      touchStart = null;
    };
    const keyDown = event => {
      const points = interactionApi.validPoints(chart.definition.points);
      if (!points.length) return;
      if (event.key === 'Escape') { event.preventDefault(); hide(); return; }
      const current = state.drawdown.selectedChartDate || points.at(-1).date;
      const index = Math.max(0, indexForDate(points, current));
      let next = null;
      if (event.key === 'ArrowLeft') next = points[Math.max(0, index - 1)];
      if (event.key === 'ArrowRight') next = points[Math.min(points.length - 1, index + 1)];
      if (event.key === 'Home') next = points[0];
      if (event.key === 'End') next = points.at(-1);
      if (!next) return;
      event.preventDefault();
      selectDate(next.date, { announce: true });
    };
    const focus = () => selectDate(state.drawdown.selectedChartDate || interactionApi.validPoints(chart.definition.points).at(-1)?.date, { announce: true });
    listen(chart.frame, 'pointerenter', pointerEnter);
    listen(chart.frame, 'pointermove', pointerMove, { passive: false });
    listen(chart.frame, 'pointerdown', pointerDown);
    listen(chart.frame, 'pointerup', pointerUp);
    listen(chart.frame, 'pointercancel', () => { touchStart = null; hide(); });
    listen(chart.frame, 'pointerleave', event => { if (event.pointerType !== 'touch') hide(); });
    listen(chart.capture, 'keydown', keyDown);
    listen(chart.capture, 'focus', focus);
  });
  listen(document, 'pointerdown', event => { if (!event.target.closest('.drawdown-interactive-chart')) hide(); });
  listen(window, 'blur', hide);
  listen(window, 'resize', () => {
    if (state.drawdown.chartCursorVisible && state.drawdown.selectedChartDate) selectDate(state.drawdown.selectedChartDate);
  });
  return {
    destroy() {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      registrations.splice(0).forEach(remove => remove());
    }
  };
}

function drawdownEventsMarkup(episodes) {
  const thresholdLabel = Math.round(state.drawdown.threshold * 100);
  const sorted = [...episodes].filter(episode => episode.maximumDrawdown <= -state.drawdown.threshold);
  const sorters = {
    'date-desc': (left, right) => right.peakDate.localeCompare(left.peakDate),
    'date-asc': (left, right) => left.peakDate.localeCompare(right.peakDate),
    depth: (left, right) => left.maximumDrawdown - right.maximumDrawdown,
    duration: (left, right) => right.totalTradingDays - left.totalTradingDays
  };
  sorted.sort(sorters[state.drawdown.sort]);
  const rows = sorted.map(episode => `<tr><td>${episode.peakDate}</td><td>${episode.troughDate}</td><td class="risk-value">${formatPercent(episode.maximumDrawdown, 2)}</td><td>${episode.declineTradingDays}</td><td>${episode.recoveryDate || '—'}</td><td>${episode.recoveryTradingDays ?? '—'}</td><td><span class="episode-status ${episode.status}">${episode.status === 'ongoing' ? '进行中' : '已恢复'}</span></td></tr>`).join('');
  const cards = sorted.map(episode => `<article><header><div><span>峰值 ${episode.peakDate}</span><strong>${formatPercent(episode.maximumDrawdown, 2)}</strong></div><span class="episode-status ${episode.status}">${episode.status === 'ongoing' ? '进行中' : '已恢复'}</span></header><dl><div><dt>谷底日期</dt><dd>${episode.troughDate}</dd></div><div><dt>下跌交易日</dt><dd>${episode.declineTradingDays}</dd></div><div><dt>恢复日期</dt><dd>${episode.recoveryDate || '—'}</dd></div><div><dt>恢复交易日</dt><dd>${episode.recoveryTradingDays ?? '—'}</dd></div></dl></article>`).join('');
  const empty = `<div class="drawdown-empty-inline"><strong>当前区间没有超过${thresholdLabel}%的回撤事件</strong><span>可以降低阈值或扩大时间范围继续查看。</span></div>`;
  return `<section class="drawdown-section-card"><div class="section-heading compact"><div><h2>超过${thresholdLabel}%的回撤事件</h2><p>每一行对应一个非重叠回撤周期，同一轮下跌不会重复计数。</p></div><span class="event-count">${sorted.length} 段</span></div>${sorted.length ? `<div class="drawdown-event-table-wrap"><table class="drawdown-event-table"><thead><tr><th>峰值日期</th><th>谷底日期</th><th>最大回撤</th><th>下跌交易日</th><th>恢复日期</th><th>恢复交易日</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table></div><div class="drawdown-event-list">${cards}</div>` : empty}</section>`;
}

function drawdownDistributionMarkup(distribution) {
  const maximum = Math.max(1, ...distribution.map(bucket => bucket.count));
  return `<section class="drawdown-section-card"><div class="section-heading compact"><div><h2>回撤深度分布</h2><p>按独立回撤事件的最大深度分组，而不是按每日观察值计数。</p></div></div><div class="drawdown-distribution">${distribution.map(bucket => `<div><span>${bucket.label}</span><div class="distribution-track"><i style="width:${(bucket.count / maximum * 100).toFixed(2)}%"></i></div><strong>${bucket.count}次</strong></div>`).join('')}</div></section>`;
}

function annualReturnsMarkup(returns) {
  return `<section class="drawdown-section-card"><div class="section-heading compact"><div><h2>历年涨幅</h2><p>每个自然年使用首条与末条有效记录计算，未结束年份标记为YTD。</p></div></div><div class="annual-return-grid">${returns.map(year => {
    const tone = year.return === null ? 'neutral' : year.return >= 0 ? 'positive' : 'negative';
    return `<article class="${tone}"><span>${year.label}</span><strong>${year.return === null ? '—' : formatPercent(year.return, 1)}</strong><small>${year.pointCount}个交易日记录</small></article>`;
  }).join('')}</div></section>`;
}

function drawdownLoadingTemplate() {
  return `<div class="page drawdown-page"><div class="breadcrumb"><a href="#/">首页</a><span>/</span><span>回撤分析</span></div><section class="hero drawdown-hero"><div class="hero-copy"><p class="eyebrow">DRAWDOWN ANALYSIS</p><h1>回撤分析</h1><p>分析指数与ETF在不同时间区间内的收益、回撤深度、持续时间和历史风险分布。</p></div><aside class="hero-panel drawdown-hero-summary" aria-label="正在加载分析摘要"><span class="drawdown-skeleton wide"></span><span class="drawdown-skeleton"></span><span class="drawdown-skeleton"></span><span class="drawdown-skeleton"></span></aside></section><section class="drawdown-loading-panel" role="status"><span class="drawdown-skeleton wide"></span><span class="drawdown-skeleton wide"></span><span class="drawdown-skeleton wide"></span><strong>正在读取本地历史数据…</strong></section></div>`;
}

function drawdownErrorTemplate() {
  return `<div class="page drawdown-page"><div class="breadcrumb"><a href="#/">首页</a><span>/</span><span>回撤分析</span></div><header class="page-title"><div><p class="eyebrow">DRAWDOWN ANALYSIS</p><h1>回撤分析</h1><p>分析指数与ETF在不同时间区间内的收益、回撤深度、持续时间和历史风险分布。</p></div></header><section class="drawdown-state-card" role="alert"><strong>暂时无法读取该对象的历史数据。</strong><span>页面不会请求外部来源；你可以重新读取本站本地API。</span><button class="button primary" type="button" data-drawdown-retry>重新读取本地API</button></section></div>`;
}

function drawdownAnalysisTemplate() {
  const primaryId = state.drawdown.primaryId;
  if (!drawdownDatasetCache.has(primaryId)) {
    return state.drawdown.errors[primaryId] ? drawdownErrorTemplate() : drawdownLoadingTemplate();
  }
  const view = drawdownAnalysisView();
  activeDrawdownChartView = view;
  const primary = DRAWDOWN_METRICS[primaryId];
  const comparison = state.drawdown.comparisonId ? DRAWDOWN_METRICS[state.drawdown.comparisonId] : null;
  const availableMetrics = availableDrawdownMetrics();
  const range = view?.range || drawdownRangeFor(drawdownDatasetCache.get(primaryId));
  const dateInputs = `<label><span>起始日期</span><input type="date" data-drawdown-date="start" min="${range.firstDate}" max="${range.lastDate}" value="${state.drawdown.preset === 'CUSTOM' ? state.drawdown.customStart : range.startDate}"></label><label><span>结束日期</span><input type="date" data-drawdown-date="end" min="${range.firstDate}" max="${range.lastDate}" value="${state.drawdown.preset === 'CUSTOM' ? state.drawdown.customEnd : range.endDate}"></label>`;
  const controls = `<section class="drawdown-control-panel" aria-labelledby="drawdownControlsTitle"><div class="section-heading compact"><div><h2 id="drawdownControlsTitle">分析设置</h2><p>完整历史仅从本站API读取一次；切换区间只在浏览器内重新计算。</p></div></div><div class="drawdown-control-grid"><label><span>主分析对象</span><select data-drawdown-control="primary">${Object.entries(availableMetrics).map(([id, metric]) => `<option value="${id}"${id === primaryId ? ' selected' : ''}>${metric.label}</option>`).join('')}</select></label><label><span>对比对象</span><select data-drawdown-control="comparison"><option value="">不对比</option>${Object.entries(availableMetrics).map(([id, metric]) => `<option value="${id}"${id === state.drawdown.comparisonId ? ' selected' : ''}${id === primaryId ? ' disabled' : ''}>${metric.label}</option>`).join('')}</select></label>${dateInputs}<label><span>回撤阈值</span><select data-drawdown-control="threshold">${[5, 10, 15, 20].map(value => `<option value="${value / 100}"${value / 100 === state.drawdown.threshold ? ' selected' : ''}>${value}%</option>`).join('')}</select></label><label><span>表格排序</span><select data-drawdown-control="sort"><option value="date-desc"${state.drawdown.sort === 'date-desc' ? ' selected' : ''}>时间倒序</option><option value="date-asc"${state.drawdown.sort === 'date-asc' ? ' selected' : ''}>时间顺序</option><option value="depth"${state.drawdown.sort === 'depth' ? ' selected' : ''}>回撤最深</option><option value="duration"${state.drawdown.sort === 'duration' ? ' selected' : ''}>持续时间最长</option></select></label></div><div class="drawdown-range-buttons" role="group" aria-label="快捷时间范围">${DRAWDOWN_PRESETS.map(([key, label]) => `<button class="range-tab${key === state.drawdown.preset ? ' active' : ''}" type="button" data-drawdown-preset="${key}" aria-pressed="${key === state.drawdown.preset}">${label}</button>`).join('')}${state.drawdown.preset === 'CUSTOM' ? '<span class="custom-range-badge">自定义</span>' : ''}</div>${state.drawdown.validationMessage || view?.error ? `<p class="drawdown-control-error" role="alert">${escapeHtml(state.drawdown.validationMessage || view.error)}</p>` : ''}${range.limited ? '<p class="drawdown-range-note">所选时间范围早于当前可用历史，已使用实际可用起始日期。</p>' : ''}</section>`;

  if (view?.error) return `<div class="page drawdown-page"><div class="breadcrumb"><a href="#/">首页</a><span>/</span><span>回撤分析</span></div><header class="page-title"><div><p class="eyebrow">DRAWDOWN ANALYSIS</p><h1>回撤分析</h1><p>分析指数在不同时间区间内的收益、回撤深度、持续时间和历史风险分布。</p></div></header>${controls}</div>`;
  if (!view?.summary) return `<div class="page drawdown-page"><div class="breadcrumb"><a href="#/">首页</a><span>/</span><span>回撤分析</span></div><header class="page-title"><div><p class="eyebrow">DRAWDOWN ANALYSIS</p><h1>回撤分析</h1><p>分析指数在不同时间区间内的收益、回撤深度、持续时间和历史风险分布。</p></div></header>${controls}<section class="drawdown-state-card"><strong>当前区间内有效数据不足，无法计算回撤。</strong><span>请扩大时间范围，或检查本地历史数据是否可用。</span></section></div>`;

  const summary = view.summary;
  const thresholdEpisodes = summary.episodes.filter(episode => episode.maximumDrawdown <= -state.drawdown.threshold);
  const maximumEpisode = summary.maximumEpisode;
  const comparisonInsufficient = comparison && (state.drawdown.errors[state.drawdown.comparisonId] || view.aligned.comparison.length < 2);
  const summaryItems = [
    ['区间收益', formatPercent(summary.intervalReturn, 2), summary.intervalReturn >= 0 ? 'positive' : 'negative'],
    ['区间最大回撤', formatPercent(summary.maximumDrawdown, 2), 'negative'],
    ['最大回撤日期区间', maximumEpisode ? `${maximumEpisode.peakDate} → ${maximumEpisode.troughDate}` : '未发生回撤', 'neutral'],
    [`超过${Math.round(state.drawdown.threshold * 100)}%的回撤段数`, `${thresholdEpisodes.length} 段`, 'neutral'],
    ['当前回撤', formatPercent(summary.currentDrawdown, 2), summary.currentDrawdown < 0 ? 'negative' : 'positive'],
    ['平均恢复交易日数', summary.averageRecoveryTradingDays === null ? '暂无已修复样本' : `${summary.averageRecoveryTradingDays.toFixed(1)} 日`, 'neutral']
  ];
  const summaryMarkup = `<section class="drawdown-summary-grid" aria-label="回撤分析摘要">${summaryItems.map(([label, value, tone]) => `<article class="${tone}"><span>${label}</span><strong>${value}</strong></article>`).join('')}</section>`;
  const recoveryStatus = maximumEpisode?.status === 'ongoing' ? '进行中' : maximumEpisode ? `已于 ${maximumEpisode.recoveryDate} 恢复` : '当前位于历史新高';
  const comparisonNotice = comparisonInsufficient ? '<div class="notice drawdown-warning"><strong>对比数据不足</strong><span>对比对象在当前区间内缺少足够数据。主对象分析不受影响。</span></div>' : '';
  const soxxNotice = primaryId === 'soxx_price' || state.drawdown.comparisonId === 'soxx_price' ? '<p><strong>iShares Semiconductor ETF（SOXX）</strong>跟踪NYSE Semiconductor Index。本页分析的是SOXX ETF本身，不是PHLX Semiconductor Sector Index（SOX）。</p>' : '';
  return `<div class="page drawdown-page"><div class="breadcrumb"><a href="#/">首页</a><span>/</span><span>回撤分析</span></div><section class="hero drawdown-hero"><div class="hero-copy"><p class="eyebrow">DRAWDOWN ANALYSIS</p><h1>回撤分析</h1><p>分析指数与ETF在不同时间区间内的收益、回撤深度、持续时间和历史风险分布。</p></div><aside class="hero-panel drawdown-hero-summary"><p class="hero-panel-label">当前分析摘要</p><h2>${primary.shortLabel}</h2><dl><div><dt>选择区间</dt><dd>${escapeHtml(range.label)}</dd></div><div><dt>当前回撤</dt><dd>${formatPercent(summary.currentDrawdown, 2)}</dd></div><div><dt>区间最大回撤</dt><dd>${formatPercent(summary.maximumDrawdown, 2)}</dd></div><div><dt>恢复状态</dt><dd>${escapeHtml(recoveryStatus)}</dd></div></dl></aside></section>${controls}${summaryMarkup}${comparisonNotice}${drawdownChartMarkup(view)}${drawdownEventsMarkup(summary.episodes)}${drawdownDistributionMarkup(view.distribution)}${annualReturnsMarkup(view.annualReturns)}<section class="drawdown-data-note"><p>${drawdownSeriesNotice(primaryId)} 历史缺失日期不插值，非交易日不补造。回撤分析仅用于个人市场观察和研究，不构成投资建议。</p>${soxxNotice}<dl><div><dt>主对象来源</dt><dd>${escapeHtml(state.drawdown.metadata[primaryId]?.sourceLabel || primary.source)}</dd></div><div><dt>主对象口径</dt><dd>${escapeHtml(drawdownSeriesTypeLabel(primaryId))}</dd></div>${comparison ? `<div><dt>对比来源</dt><dd>${escapeHtml(state.drawdown.metadata[state.drawdown.comparisonId]?.sourceLabel || comparison.source)}</dd></div><div><dt>对比口径</dt><dd>${escapeHtml(drawdownSeriesTypeLabel(state.drawdown.comparisonId))}</dd></div>` : ''}<div><dt>有效区间</dt><dd>${summary.firstDate} 至 ${summary.lastDate} · ${summary.pointCount}点</dd></div></dl></section></div>`;
}

function notFoundTemplate() {
  return `<div class="page"><header class="page-title"><div><p class="eyebrow">404</p><h1>页面不存在</h1><p>该地址没有对应内容。</p><div class="hero-actions"><a class="button primary" href="#/">返回首页</a></div></div></header></div>`;
}

async function loadMarketData(range = '1Y') {
  try {
    const response = await fetch(`/api/market-data/indicators?range=${encodeURIComponent(range)}`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`Market data API ${response.status}`);
    const payload = await response.json();
    const byId = new Map((payload.indicators || []).map(model => [model.id, model]));
    state.indicators.forEach(indicator => {
      state.marketData[indicator.id] = byId.get(indicator.id) || failedMarketModel(indicator, state.marketData[indicator.id]);
    });
  } catch (error) {
    console.error('Market data API:', error);
    state.indicators.forEach(indicator => {
      state.marketData[indicator.id] = failedMarketModel(indicator, state.marketData[indicator.id]);
    });
  }
}

async function loadExternalPE() {
  externalPEController?.abort();
  const controller = new AbortController();
  externalPEController = controller;
  state.externalPE = { ...state.externalPE, loading: true, error: null };
  try {
    const base = '/api/market-data/providers/worldperatio';
    const responses = await Promise.all(['status', 'latest', 'history', 'statistics'].map(endpoint => fetch(`${base}/${endpoint}`, {
      headers: { Accept: 'application/json' }, signal: controller.signal
    })));
    if (responses.some(response => !response.ok)) throw new Error('WorldPEratio local API unavailable');
    const [status, latest, history, statistics] = await Promise.all(responses.map(response => response.json()));
    state.externalPE = { loaded: true, loading: false, status, latest, history, statistics, error: null };
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('WorldPEratio local API:', error);
    state.externalPE = { ...state.externalPE, loaded: true, loading: false, error: 'local-api-unavailable' };
  } finally {
    if (externalPEController === controller) externalPEController = null;
  }
}

async function loadIndicatorRange(id, range) {
  const indicator = state.indicators.find(item => item.id === id);
  if (!indicator) return;
  const previous = state.marketData[id];
  if (previous?.status === 'demo') {
    render({ preserveScroll: true });
    return;
  }
  marketDataControllers.get(id)?.abort();
  const controller = new AbortController();
  marketDataControllers.set(id, controller);
  state.marketData[id] = { ...previous, status: 'loading', statusMessage: '正在读取所选时间范围' };
  render({ preserveScroll: true });
  try {
    const response = await fetch(`/api/market-data/indicators/${encodeURIComponent(id)}?range=${encodeURIComponent(range)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`Market data API ${response.status}`);
    state.marketData[id] = await response.json();
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error(`Market data range ${id}:`, error);
    state.marketData[id] = failedMarketModel(indicator, previous);
  } finally {
    if (marketDataControllers.get(id) === controller) marketDataControllers.delete(id);
  }
  render({ preserveScroll: true });
}

async function loadNaaim(range = '1Y') {
  try { const [summaryResponse, historyResponse] = await Promise.all([fetch('/api/market-data/metrics/naaim_exposure', { headers: { Accept: 'application/json' } }), fetch(`/api/market-data/metrics/naaim_exposure/history?range=${encodeURIComponent(range)}`, { headers: { Accept: 'application/json' } })]); if (!summaryResponse.ok || !historyResponse.ok) throw new Error(`NAAIM API ${summaryResponse.status}/${historyResponse.status}`); const [summary, history] = await Promise.all([summaryResponse.json(), historyResponse.json()]); state.naaim = { ...summary, history: history.history || [], requestedRange: range }; }
  catch { state.naaim = { status: 'unavailable', history: [], statusMessage: '本地NAAIM数据暂不可用' }; }
}

async function loadDrawdownDataset(id, { force = false } = {}) {
  if (!id || state.drawdown.loading.has(id)) return;
  const controller = new AbortController();
  drawdownControllers.get(id)?.abort();
  drawdownControllers.set(id, controller);
  state.drawdown.loading.add(id);
  delete state.drawdown.errors[id];
  try {
    await drawdownDatasetCache.load(id, { force, signal: controller.signal });
    state.drawdown.calculationCache.clear();
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error(`Drawdown history ${id}:`, error);
      state.drawdown.errors[id] = 'local-api-unavailable';
    }
  } finally {
    if (drawdownControllers.get(id) === controller) drawdownControllers.delete(id);
    state.drawdown.loading.delete(id);
  }
}

async function ensureDrawdownData() {
  const ids = [state.drawdown.primaryId, state.drawdown.comparisonId, 'soxx_price'].filter(Boolean);
  const missing = [...new Set(ids)].filter(id => !drawdownDatasetCache.has(id) && !state.drawdown.loading.has(id) && !state.drawdown.errors[id]);
  if (!missing.length) return;
  await Promise.all(missing.map(id => loadDrawdownDataset(id)));
  if (parseRoute() === '/drawdown-analysis') render({ preserveScroll: true });
}

function abortDrawdownRequests() {
  drawdownControllers.forEach(controller => controller.abort());
  drawdownControllers.clear();
}

function setActiveNav(route) {
  document.querySelectorAll('.desktop-nav a, .mobile-nav a').forEach(link => {
    const href = link.getAttribute('href').slice(1);
    const active = route === href || (href === '/' && route.startsWith('/stage/')) || (href === '/options' && route.startsWith('/options/'));
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const settingsActive = route === '/settings';
  settingsLink.classList.toggle('active', settingsActive);
  if (settingsActive) settingsLink.setAttribute('aria-current', 'page');
  else settingsLink.removeAttribute('aria-current');
}

function settingsStatusLabel(status) {
  return ({ fresh: '正常', stale: '数据可能延迟', running: '正在更新', unavailable: '暂不可用', error: '更新失败', manual: '本地导入', partial: '部分成功' })[status] || '状态不可用';
}

function settingsCodeLabel(value) {
  return ({ official_csv: '官方CSV', public_webpage: '公开网页', scheduled_daily: '每日计划', scheduled_weekly: '每周计划', local_import: '本地导入', manual_import: '本地导入', official_workbook_local_import: '官方工作簿本地导入', official_workbook: '官方Excel自动更新' })[value] || value || '—';
}

function settingsTemplate() {
  if (settingsError) return `<section class="page settings-page"><div class="page-title"><div><p class="eyebrow">SETTINGS · DATA ACQUISITION</p><h1>数据源与采集状态</h1><p>暂时无法读取采集状态。</p></div><button class="button" data-settings-refresh>刷新状态</button></div></section>`;
  const data = settingsStatus;
  if (!data) return `<section class="page settings-page"><div class="notice"><strong>正在读取采集状态</strong><span>仅访问本站内部状态接口。</span></div></section>`;
  const s = data.summary || {}; const scheduler = data.scheduler || {};
  const datasetStatusCounts = (data.datasets || []).reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] || 0) + 1 }), {});
  const summary = [['已启用数据源', s.enabledProviderCount], ['已启用数据集', s.enabledDatasetCount], ['正常数据集', (datasetStatusCounts.fresh || 0) + (datasetStatusCounts.manual || 0)], ['延迟数据集', datasetStatusCounts.stale || 0], ['失败数据集', (datasetStatusCounts.error || 0) + (datasetStatusCounts.unavailable || 0)], ['每日联网数据集', s.dailyNetworkDatasetCount], ['本地导入数据集', s.localImportDatasetCount], ['实时数据源', s.realtimeProviderCount], ['当前调度状态', s.schedulerStatus]];
  const providerCards = (data.providers || []).map(provider => `<article class="settings-card provider-card"><div class="card-heading-row"><div><p class="eyebrow">${escapeHtml(provider.domain)}</p><h3>${escapeHtml(provider.displayName)}</h3></div><span class="metric-status" data-status="${escapeHtml(provider.status)}">${settingsStatusLabel(provider.status)}</span></div><dl class="settings-facts"><div><dt>获取方式</dt><dd>${escapeHtml(settingsCodeLabel(provider.sourceType))}</dd></div><div><dt>联网采集</dt><dd>${provider.networkAccessEnabled ? '已启用' : '未启用'}</dd></div><div><dt>更新模式</dt><dd>${escapeHtml(settingsCodeLabel(provider.updateMode))}</dd></div><div><dt>数据频率</dt><dd>${provider.frequency === 'weekly' ? '每周' : provider.frequency === 'daily' ? '每日' : '—'}</dd></div><div><dt>首次检查</dt><dd>${escapeHtml(provider.schedule?.firstCheck || '—')} Asia/Shanghai</dd></div><div><dt>补充检查</dt><dd>${escapeHtml(provider.schedule?.retryCheck || '—')} Asia/Shanghai</dd></div><div><dt>人工导入</dt><dd>${provider.manualImportEnabled ? '保留' : '—'}</dd></div><div><dt>最近检查结果</dt><dd>${escapeHtml(provider.result || '等待首次检查')}</dd></div><div><dt>数据集</dt><dd>${provider.datasets?.length || 0}</dd></div><div><dt>排除冲突日期</dt><dd>${Number(provider.excludedConflictDateCount || 0)}</dd></div><div><dt>上次成功</dt><dd>${formatDateTime(provider.lastSuccessAt)}</dd></div><div><dt>下次计划</dt><dd>${formatDateTime(provider.nextScheduledAt)}</dd></div></dl><p class="settings-note">${escapeHtml(provider.accessState === 'authentication_required' || provider.accessState === 'subscription_required' ? '官方来源当前需要认证，网站继续使用最后一次成功数据。' : provider.note || '')}</p><details><summary>来源详情</summary><p>来源网站：${escapeHtml(provider.domain)}。${escapeHtml(provider.note || '')}</p></details></article>`).join('');
  const datasetRows = (data.datasets || []).map(item => `<tr><td><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.metricId)}</small></td><td>${escapeHtml(item.providerId)}</td><td>${item.sourceUrl ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.sourcePageLabel)}</a>` : escapeHtml(item.sourcePageLabel)}</td><td>${escapeHtml(settingsCodeLabel(item.accessMethod))}</td><td>${escapeHtml(settingsCodeLabel(item.updateMode))}</td><td>${item.isRealtime ? '是' : '否'}</td><td><span class="metric-status" data-status="${escapeHtml(item.status)}">${settingsStatusLabel(item.status)}</span></td><td>${formatDateTime(item.sourceDataDate)}</td><td>${formatDateTime(item.lastSuccessAt)}</td><td>${formatDateTime(item.nextScheduledAt)}</td></tr>`).join('');
  const allRuns = data.recentRuns || [];
  const visibleRuns = state.settingsRunsExpanded ? allRuns : allRuns.slice(0, 10);
  const runRows = visibleRuns.map(run => `<tr><td>${formatDateTime(run.startedAt)}</td><td>${escapeHtml(run.trigger)}</td><td>${escapeHtml(run.providerId)}</td><td>${escapeHtml(run.metricId)}</td><td>${escapeHtml(run.result)}</td><td>${run.externalRequestCount}</td><td>${formatDateTime(run.sourceDataDate)}</td><td>${escapeHtml(run.errorCategory || '—')}</td></tr>`).join('') || '<tr><td colspan="8">尚无本轮功能上线后的采集审计记录。</td></tr>';
  return `<section class="page settings-page"><div class="hero settings-hero"><div><p class="eyebrow">SETTINGS · DATA ACQUISITION</p><h1>数据源与采集状态</h1><p>查看网站当前使用的数据网站、采集方式、更新时间和运行状态。</p><p class="breadcrumb">首页 / 设置</p></div><div class="hero-panel"><span>数据模式：日频</span><strong>实时行情：未启用</strong><small>调度时区：${escapeHtml(scheduler.timezone || '—')} · 每日检查：${escapeHtml(scheduler.time || '—')}</small><button class="button" data-settings-refresh>刷新状态</button></div></div><p class="settings-realtime">${escapeHtml(data.realtime?.message || '')}</p><section><div class="section-heading"><div><p class="eyebrow">OVERVIEW</p><h2>采集概览</h2></div></div><div class="settings-summary">${summary.map(([label, value]) => `<article><span>${label}</span><strong>${escapeHtml(String(value ?? '—'))}</strong></article>`).join('')}</div></section><section class="settings-section"><div class="section-heading"><div><p class="eyebrow">SCHEDULE</p><h2>计划任务</h2></div></div><dl class="settings-facts settings-schedule"><div><dt>是否启用</dt><dd>${scheduler.enabled ? '已启用' : '未启用'}</dd></div><div><dt>时区 / 时间</dt><dd>${escapeHtml(scheduler.timezone || '—')} / ${escapeHtml(scheduler.time || '—')}</dd></div><div><dt>下次计划运行</dt><dd>${formatDateTime(scheduler.nextScheduledAt)}</dd></div><div><dt>上次周期结果</dt><dd>${escapeHtml(scheduler.lastCycleResult || '—')}</dd></div><div><dt>启动漏采检查</dt><dd>${scheduler.startupCatchupEnabled ? '已启用' : '未启用'}</dd></div><div><dt>当前运行</dt><dd>${scheduler.running ? `正在处理 ${scheduler.currentProviderId || 'Provider'}` : '否'}</dd></div></dl><p class="settings-note">Windows 无感启动仅负责启动网站服务；数据计划任务为网站内部每日07:30检查，两者互不混同。</p></section><section class="settings-section"><div class="section-heading"><div><p class="eyebrow">PROVIDERS</p><h2>数据源列表</h2></div></div><div class="settings-provider-grid">${providerCards}</div></section><section class="settings-section"><div class="section-heading"><div><p class="eyebrow">DATASETS</p><h2>数据集明细</h2></div></div><div class="settings-table-wrap"><table class="settings-table"><thead><tr><th>指标</th><th>来源网站</th><th>来源数据集或页面</th><th>获取方式</th><th>更新模式</th><th>实时</th><th>当前状态</th><th>源数据日期</th><th>上次成功</th><th>下次检查</th></tr></thead><tbody>${datasetRows}</tbody></table></div></section><section class="settings-section"><div class="section-heading"><div><p class="eyebrow">RECENT RUNS</p><h2>最近采集记录</h2></div></div><div class="settings-table-wrap"><table class="settings-table"><thead><tr><th>开始时间</th><th>触发方式</th><th>Provider</th><th>数据集</th><th>结果</th><th>外部请求</th><th>源数据日期</th><th>错误分类</th></tr></thead><tbody>${runRows}</tbody></table></div></section><section class="settings-section settings-storage"><p>${escapeHtml(data.storage?.message || '')}</p><dl class="settings-facts"><div><dt>runtime-data 被Git忽略</dt><dd>${data.storage?.runtimeDataIgnored ? '是' : '否'}</dd></div><div><dt>Git跟踪真实市场数据</dt><dd>${data.storage?.gitTracksRealMarketData ? '是' : '否'}</dd></div><div><dt>保存原始HTML</dt><dd>${data.storage?.rawHtmlStored ? '是' : '否'}</dd></div><div><dt>使用Cookie或Token</dt><dd>${data.storage?.credentialsUsed ? '是' : '否'}</dd></div></dl></section></section>`;
}

async function loadSettingsStatus() {
  settingsController?.abort(); settingsController = new AbortController();
  try { const response = await fetch('/api/settings/data-acquisition', { headers: { Accept: 'application/json' }, signal: settingsController.signal }); if (!response.ok) throw new Error(`settings ${response.status}`); settingsStatus = await response.json(); settingsError = false; }
  catch (error) { if (error.name !== 'AbortError') settingsError = true; }
  if (parseRoute() === '/settings') render({ preserveScroll: true });
}

function clearSettingsPolling() { if (settingsPollTimer) clearInterval(settingsPollTimer); settingsPollTimer = null; settingsController?.abort(); settingsController = null; }

function bindSettingsRunToggle() {
  if (state.route !== '/settings') return;
  const tables = document.querySelectorAll('.settings-table');
  const rows = [...(tables[1]?.querySelectorAll('tbody tr') || [])];
  if (rows.length <= 10) return;
  document.querySelector('.settings-runs-toggle')?.remove();
  rows.slice(10).forEach(row => { row.hidden = !state.settingsRunsExpanded; });
  const control = document.createElement('button');
  control.type = 'button'; control.className = 'button button-secondary settings-runs-toggle';
  control.textContent = state.settingsRunsExpanded ? '收起' : '展开全部';
  control.addEventListener('click', () => { state.settingsRunsExpanded = !state.settingsRunsExpanded; bindSettingsRunToggle(); });
  tables[1].parentElement?.after(control);
}

function indicatorInfoMeta(indicator, market) {
  return {
    metricId: indicator.id,
    label: indicator.name,
    meaning: indicator.meaning || indicator.definition || indicator.explain,
    interpretation: indicator.interpretation || indicator.explain,
    sourceDescription: market.source || indicator.source || '本站内部数据服务',
    dataDefinition: indicator.definition || indicator.meaning || indicator.explain,
    updateFrequency: market.frequency || '每日计划检查',
    limitations: indicator.limitations || indicator.limits || '数据可能延迟、修订或受来源口径影响，不构成投资建议。',
    marketRelation: indicator.marketRelation || '需要结合价格结构、波动率和市场广度共同观察。'
  };
}

function dialogFocusable(dialog) {
  return [...dialog.querySelectorAll('button:not([disabled]), [href], select, [tabindex]:not([tabindex="-1"])')]
    .filter(node => !node.hidden && node.getClientRects().length);
}

function lockDialogBackground() {
  indicatorDialogState.scrollY = window.scrollY;
  const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
  document.body.classList.add('dialog-open');
  document.body.style.top = `-${indicatorDialogState.scrollY}px`;
  document.body.style.paddingRight = scrollbarWidth ? `${scrollbarWidth}px` : '';
  indicatorDialogState.inertNodes = [...document.body.children]
    .filter(node => node !== indicatorDialogState.portal)
    .map(node => ({ node, inert: node.inert }));
  indicatorDialogState.inertNodes.forEach(({ node }) => { node.inert = true; });
}

function unlockDialogBackground() {
  indicatorDialogState.inertNodes.forEach(({ node, inert }) => { node.inert = inert; });
  indicatorDialogState.inertNodes = [];
  document.body.classList.remove('dialog-open');
  document.body.style.top = '';
  document.body.style.paddingRight = '';
  window.scrollTo({ top: indicatorDialogState.scrollY, behavior: 'instant' });
}

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function cancelDialogAnimations() {
  indicatorDialogState.animations.forEach(animation => animation.cancel());
  indicatorDialogState.animations = [];
}

function dialogTransform(triggerRect, dialogRect) {
  const scaleX = Math.max(.06, triggerRect.width / dialogRect.width);
  const scaleY = Math.max(.06, triggerRect.height / dialogRect.height);
  const x = triggerRect.left + triggerRect.width / 2 - (dialogRect.left + dialogRect.width / 2);
  const y = triggerRect.top + triggerRect.height / 2 - (dialogRect.top + dialogRect.height / 2);
  return { x, y, scaleX, scaleY };
}

function animateIndicatorDialog(dialog, backdrop, trigger, opening) {
  const triggerRect = trigger?.getBoundingClientRect();
  const dialogRect = dialog.getBoundingClientRect();
  const duration = reducedMotion() ? 140 : opening ? 330 : 270;
  const finish = opening ? 'forwards' : 'forwards';
  if (!triggerRect || !dialogRect || typeof dialog.animate !== 'function') return Promise.resolve();
  const transform = dialogTransform(triggerRect, dialogRect);
  dialog.style.willChange = 'transform, opacity, border-radius, filter';
  const from = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scaleX}, ${transform.scaleY})`;
  const to = 'translate(0, 0) scale(1)';
  const dialogFrames = opening
    ? [{ transform: reducedMotion() ? to : from, opacity: reducedMotion() ? .25 : .2, borderRadius: reducedMotion() ? '22px' : '50%', filter: reducedMotion() ? 'none' : 'blur(2px)' }, { transform: to, opacity: 1, borderRadius: '22px', filter: 'blur(0)' }]
    : [{ transform: to, opacity: 1, borderRadius: '22px', filter: 'blur(0)' }, { transform: reducedMotion() ? to : from, opacity: reducedMotion() ? 0 : .18, borderRadius: reducedMotion() ? '22px' : '50%', filter: reducedMotion() ? 'none' : 'blur(2px)' }];
  const dialogAnimation = dialog.animate(dialogFrames, { duration, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: finish });
  const backdropAnimation = backdrop.animate(opening ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion() ? 120 : duration, easing: 'ease-out', fill: finish });
  const content = dialog.querySelector('.indicator-dialog-content');
  const contentAnimation = content?.animate(opening ? [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }] : [{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion() ? 100 : 180, delay: opening && !reducedMotion() ? 100 : 0, easing: 'ease-out', fill: finish });
  indicatorDialogState.animations = [dialogAnimation, backdropAnimation, contentAnimation].filter(Boolean);
  return Promise.all(indicatorDialogState.animations.map(animation => animation.finished.catch(() => undefined))).then(() => {
    indicatorDialogState.animations = [];
    dialog.style.transform = '';
    dialog.style.opacity = '';
    dialog.style.borderRadius = '';
    dialog.style.filter = '';
    dialog.style.willChange = '';
    backdrop.style.opacity = '';
  });
}

function createIndicatorDialog(trigger) {
  const indicator = state.indicators.find(item => item.id === trigger.dataset.indicatorInfo);
  if (!indicator) return null;
  const market = state.marketData[indicator.id] || initialMarketModel(indicator);
  const status = DATA_STATUS[market.status] || DATA_STATUS.error;
  const meta = indicatorInfoMeta(indicator, market);
  const value = hasFiniteValue(market.value) ? `${Number(market.value).toFixed(2).replace(/\.00$/, '')}${market.unit === 'index_points' ? '' : market.unit || indicator.unit || ''}` : '暂无可用值';
  const portal = document.createElement('div');
  portal.id = 'indicator-dialog-portal';
  portal.innerHTML = `<div class="dialog-backdrop" data-indicator-dialog-backdrop><section id="indicatorDialog" class="indicator-dialog" role="dialog" aria-modal="true" aria-labelledby="indicatorDialogTitle" aria-describedby="indicatorDialogSummary" tabindex="-1"><header><div><span>辅助指标说明</span><h2 id="indicatorDialogTitle">${escapeHtml(meta.label)}</h2><p id="indicatorDialogSummary" class="dialog-summary">当前值 ${escapeHtml(value)} · ${escapeHtml(status.label)} · 数据日期 ${escapeHtml(market.asOf || '—')}</p></div><button class="dialog-close" type="button" data-close-indicator-dialog aria-label="关闭${escapeHtml(meta.label)}指标说明">×</button></header><div class="indicator-dialog-body indicator-dialog-content"><section><h3>指标意义</h3><p>${escapeHtml(meta.meaning)}</p></section><section><h3>如何理解</h3><p>${escapeHtml(meta.interpretation)}</p><p>${escapeHtml(meta.marketRelation)}</p></section><section><h3>数据来源与口径</h3><dl class="dialog-data-summary"><div><dt>Provider</dt><dd>${escapeHtml(market.provider || meta.sourceDescription)}</dd></div><div><dt>来源网站</dt><dd>${escapeHtml(meta.sourceDescription)}</dd></div><div><dt>数据频率</dt><dd>${escapeHtml(meta.updateFrequency)}</dd></div><div><dt>最新数据日期</dt><dd>${escapeHtml(market.asOf || '—')}</dd></div></dl><p>${escapeHtml(meta.dataDefinition)}</p></section><section class="dialog-limitations"><h3>使用限制</h3><p>${escapeHtml(meta.limitations)}</p></section><p class="notice"><strong>${escapeHtml(status.label)}</strong><span>${escapeHtml(market.statusMessage || '弹窗只读取当前已加载的本站内部数据，不触发数据更新。')}</span></p></div></section></div>`;
  return portal;
}

async function closeIndicatorDialog({ restoreFocus = true } = {}) {
  if (indicatorDialogState.phase === 'closed' || indicatorDialogState.phase === 'closing') return;
  const portal = indicatorDialogState.portal;
  const dialog = portal?.querySelector('.indicator-dialog');
  const backdrop = portal?.querySelector('.dialog-backdrop');
  const trigger = indicatorDialogState.trigger;
  indicatorDialogState.phase = 'closing';
  if (dialog && backdrop && trigger?.isConnected) await animateIndicatorDialog(dialog, backdrop, trigger, false);
  cancelDialogAnimations();
  portal?.remove();
  if (indicatorDialogState.keydownHandler) document.removeEventListener('keydown', indicatorDialogState.keydownHandler);
  indicatorDialogState.keydownHandler = null;
  indicatorDialogState.portal = null;
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  unlockDialogBackground();
  indicatorDialogState.phase = 'closed';
  indicatorDialogState.trigger = null;
  if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  const queued = indicatorDialogState.queued;
  indicatorDialogState.queued = null;
  if (queued?.isConnected) await requestIndicatorDialog(queued);
}

async function requestIndicatorDialog(trigger) {
  if (!trigger?.isConnected) return;
  if (indicatorDialogState.phase !== 'closed') {
    if (indicatorDialogState.trigger === trigger) return;
    indicatorDialogState.queued = trigger;
    await closeIndicatorDialog({ restoreFocus: false });
    return;
  }
  const portal = createIndicatorDialog(trigger);
  if (!portal) return;
  indicatorDialogState.phase = 'opening';
  indicatorDialogState.trigger = trigger;
  indicatorDialogState.portal = portal;
  trigger.setAttribute('aria-expanded', 'true');
  document.body.append(portal);
  lockDialogBackground();
  const dialog = portal.querySelector('.indicator-dialog');
  const backdrop = portal.querySelector('.dialog-backdrop');
  portal.querySelector('[data-close-indicator-dialog]')?.addEventListener('click', () => void closeIndicatorDialog());
  backdrop.addEventListener('click', event => { if (event.target === backdrop) void closeIndicatorDialog(); });
  dialog.addEventListener('click', event => event.stopPropagation());
  const keydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); void closeIndicatorDialog(); return; }
    if (event.key !== 'Tab') return;
    const focusable = dialogFocusable(dialog);
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', keydown);
  indicatorDialogState.keydownHandler = keydown;
  await animateIndicatorDialog(dialog, backdrop, trigger, true);
  if (indicatorDialogState.portal !== portal) return;
  indicatorDialogState.phase = 'open';
  portal.querySelector('[data-close-indicator-dialog]')?.focus({ preventScroll: true });
}

function destroyIndicatorDialog() {
  cancelDialogAnimations();
  if (indicatorDialogState.portal) indicatorDialogState.portal.remove();
  if (indicatorDialogState.keydownHandler) document.removeEventListener('keydown', indicatorDialogState.keydownHandler);
  indicatorDialogState.keydownHandler = null;
  if (indicatorDialogState.phase !== 'closed') unlockDialogBackground();
  indicatorDialogState.phase = 'closed';
  indicatorDialogState.portal = null;
  indicatorDialogState.trigger = null;
  indicatorDialogState.queued = null;
}

function bindCommonEvents() {
  bindSettingsRunToggle();
  document.querySelector('[data-settings-refresh]')?.addEventListener('click', () => void loadSettingsStatus());
  document.querySelectorAll('[data-naaim-range]').forEach(button => button.addEventListener('click', async () => { state.naaimRange = button.dataset.naaimRange; await loadNaaim(state.naaimRange); render({ preserveScroll: true }); }));
  document.querySelector('[data-drawdown-control="primary"]')?.addEventListener('change', event => {
    clearDrawdownChartInteraction({ clearDate: true });
    state.drawdown.primaryId = event.target.value;
    if (state.drawdown.comparisonId === state.drawdown.primaryId) {
      state.drawdown.comparisonId = state.drawdown.primaryId === 'nasdaq100_index' ? 'sp500_index' : 'nasdaq100_index';
    }
    state.drawdown.validationMessage = '';
    render({ preserveScroll: true });
  });
  document.querySelector('[data-drawdown-control="comparison"]')?.addEventListener('change', event => {
    clearDrawdownChartInteraction({ clearDate: true });
    state.drawdown.comparisonId = event.target.value === state.drawdown.primaryId ? '' : event.target.value;
    render({ preserveScroll: true });
  });
  document.querySelector('[data-drawdown-control="threshold"]')?.addEventListener('change', event => {
    state.drawdown.threshold = Number(event.target.value);
    render({ preserveScroll: true });
  });
  document.querySelector('[data-drawdown-control="sort"]')?.addEventListener('change', event => {
    state.drawdown.sort = event.target.value;
    render({ preserveScroll: true });
  });
  document.querySelectorAll('[data-drawdown-preset]').forEach(button => {
    button.addEventListener('click', () => {
      clearDrawdownChartInteraction({ clearDate: true });
      state.drawdown.preset = button.dataset.drawdownPreset;
      state.drawdown.validationMessage = '';
      render({ preserveScroll: true });
    });
  });
  document.querySelectorAll('[data-drawdown-date]').forEach(input => {
    input.addEventListener('change', () => {
      clearDrawdownChartInteraction({ clearDate: true });
      const startInput = document.querySelector('[data-drawdown-date="start"]');
      const endInput = document.querySelector('[data-drawdown-date="end"]');
      state.drawdown.preset = 'CUSTOM';
      state.drawdown.customStart = startInput?.value || '';
      state.drawdown.customEnd = endInput?.value || '';
      state.drawdown.validationMessage = state.drawdown.customStart > state.drawdown.customEnd ? '起始日期不能晚于结束日期。' : '';
      render({ preserveScroll: true });
    });
  });
  document.querySelector('[data-drawdown-retry]')?.addEventListener('click', async () => {
    clearDrawdownChartInteraction({ clearDate: true });
    const ids = [state.drawdown.primaryId, state.drawdown.comparisonId].filter(Boolean);
    ids.forEach(id => { delete state.drawdown.errors[id]; });
    render({ preserveScroll: true });
    await Promise.all([...new Set(ids)].map(id => loadDrawdownDataset(id, { force: true })));
    if (parseRoute() === '/drawdown-analysis') render({ preserveScroll: true });
  });
  if (state.route === '/drawdown-analysis' && activeDrawdownChartView?.summary) {
    drawdownChartInteraction = createDrawdownChartInteraction(activeDrawdownChartView);
  }

  document.querySelectorAll('[data-stage-id]').forEach(element => {
    const activate = () => {
      const id = element.dataset.stageId;
      state.activeStageId = id;
      location.hash = `#/stage/${id}`;
    };
    element.addEventListener('click', activate);
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
  });

  const updateCycleInspector = id => {
    const stage = state.stages.find(item => item.id === id);
    if (!stage) return;
    const shape = state.cycleShape?.stages?.find(item => item.id === id);
    const index = document.getElementById('cycleInspectorIndex');
    const name = document.getElementById('cycleInspectorName');
    const summary = document.getElementById('cycleInspectorSummary');
    const link = document.getElementById('cycleInspectorLink');
    if (index) index.textContent = `S${String(stage.order).padStart(2, '0')}`;
    if (name) name.textContent = stage.name;
    if (summary) summary.textContent = valueOr(shape?.summary, stage.summary);
    if (link) link.href = `#/stage/${stage.id}`;
  };
  document.querySelectorAll('[data-cycle-preview-id]').forEach(element => {
    const preview = () => updateCycleInspector(element.dataset.cyclePreviewId);
    element.addEventListener('mouseenter', preview);
    element.addEventListener('focus', preview);
    element.addEventListener('pointerdown', preview);
  });

  document.querySelectorAll('.range-tab').forEach(button => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      state.ranges[button.dataset.indicatorId] = button.dataset.range;
      await loadIndicatorRange(button.dataset.indicatorId, button.dataset.range);
      requestAnimationFrame(() => document.querySelector(`[data-indicator-id="${button.dataset.indicatorId}"][data-range="${button.dataset.range}"]`)?.focus());
    });
  });

  document.querySelectorAll('.interactive-history-chart').forEach(figure => {
    const frame = figure.querySelector('.history-chart-frame');
    const tooltip = figure.querySelector('.history-chart-tooltip');
    let points = [];
    try { points = JSON.parse(figure.dataset.chartPoints || '[]'); } catch { points = []; }
    if (!frame || !tooltip || points.length < 2) return;
    const showPoint = event => {
      const rect = frame.getBoundingClientRect();
      const relativeX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const index = Math.round((relativeX / Math.max(rect.width, 1)) * (points.length - 1));
      const point = points[index];
      tooltip.textContent = `${point.date} · ${point.value}`;
      tooltip.style.left = `${(index / (points.length - 1)) * 100}%`;
      tooltip.hidden = false;
    };
    frame.addEventListener('pointermove', showPoint);
    frame.addEventListener('pointerdown', showPoint);
    frame.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') tooltip.hidden = true; });
  });

  document.querySelectorAll('.formula-details, .compact-details, .option-detail-group').forEach(details => {
    const summary = details.querySelector('summary');
    if (!summary) return;
    const syncExpanded = () => summary.setAttribute('aria-expanded', String(details.open));
    details.addEventListener('toggle', syncExpanded);
    summary.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        details.open = !details.open;
        syncExpanded();
      }
    });
    syncExpanded();
  });

  document.querySelectorAll('[data-tabs]').forEach(tabGroup => {
    const tabs = [...tabGroup.querySelectorAll('[role="tab"]')];
    const selectTab = (tab, focus = false) => {
      tabs.forEach(item => {
        const selected = item === tab;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
        const panel = document.getElementById(item.getAttribute('aria-controls'));
        if (panel) panel.hidden = !selected;
      });
      if (focus) tab.focus();
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectTab(tab));
      tab.addEventListener('keydown', event => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const targetIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        selectTab(tabs[targetIndex], true);
      });
    });
  });

  document.querySelectorAll('[data-scroll-target]').forEach(button => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.scrollTarget);
      if (!target) return;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });

  document.querySelectorAll('[data-option-category]').forEach(button => {
    button.addEventListener('click', () => {
      state.optionCategory = button.dataset.optionCategory;
      const currentId = parseRoute().split('/')[2];
      const available = state.optionCategory === '全部'
        ? state.options
        : state.options.filter(option => option.category === state.optionCategory);
      const nextId = available.some(option => option.id === currentId) ? currentId : available[0]?.id;
      if (nextId && nextId !== currentId) location.hash = `#/options/${nextId}`;
      else render();
    });
  });

  document.getElementById('optionSelect')?.addEventListener('change', event => {
    location.hash = `#/options/${event.target.value}`;
  });

  document.querySelectorAll('[data-indicator-info]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void requestIndicatorDialog(button);
    });
  });

  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: .08 });
  document.querySelectorAll('.reveal').forEach(node => revealObserver.observe(node));
}

function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function render({ preserveScroll = false } = {}) {
  const route = parseRoute();
  if (route === '/indicators' || route.startsWith('/indicators/')) {
    history.replaceState(null, '', `${location.pathname}${location.search}#/`);
    render();
    return;
  }
  destroyIndicatorDialog();
  clearDrawdownChartInteraction({ clearDate: route !== '/drawdown-analysis' });
  if (route !== '/drawdown-analysis') activeDrawdownChartView = null;
  state.route = route;
  setActiveNav(route);

  if (route === '/') app.innerHTML = homeTemplate();
  else if (route === '/compare') app.innerHTML = compareTemplate();
  else if (route === '/drawdown-analysis') app.innerHTML = drawdownAnalysisTemplate();
  else if (route === '/options' || route.startsWith('/options/')) app.innerHTML = optionsTemplate(route.split('/')[2]);
  else if (route === '/settings') app.innerHTML = settingsTemplate();
  else if (route === '/indicator/naaim-exposure') app.innerHTML = naaimDetailTemplate();
  else if (route.startsWith('/stage/')) app.innerHTML = stageTemplate(state.stages.find(stage => stage.id === route.split('/')[2]));
  else app.innerHTML = notFoundTemplate();

  const titleByRoute = {
    '/': 'Market Cycle Strategy',
    '/compare': '阶段对比 · Market Cycle Strategy',
    '/drawdown-analysis': '回撤分析 · Market Cycle Strategy',
    '/options': '期权工具 · Market Cycle Strategy',
    '/settings': '设置 · Market Cycle Strategy', '/indicator/naaim-exposure': 'NAAIM主动投资经理美股敞口 · Market Cycle Strategy'
  };
  document.title = titleByRoute[route] || (route.startsWith('/stage/') ? '阶段详情 · Market Cycle Strategy' : route.startsWith('/options/') ? '期权工具 · Market Cycle Strategy' : '页面不存在 · Market Cycle Strategy');

  bindCommonEvents();
  if (route === '/drawdown-analysis') void ensureDrawdownData();
  if (route === '/settings' && !settingsPollTimer) { void loadSettingsStatus(); settingsPollTimer = setInterval(() => void loadSettingsStatus(), 60_000); }
  if (route === '/indicator/naaim-exposure') { const wanted = state.naaimRange || 'ALL'; if (state.naaim?.requestedRange !== wanted) void loadNaaim(wanted).then(() => { if (parseRoute() === route) render({ preserveScroll: true }); }); }
  if (route !== '/settings') clearSettingsPolling();
  if (!preserveScroll) {
    app.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#07101c' : '#f4f6fa');
}

function initializeTheme() {
  const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(preferred);
}

function setMobileMenu(open) {
  mobileNav.hidden = !open;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
}

themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
});

menuToggle.addEventListener('click', () => {
  setMobileMenu(mobileNav.hidden);
});

mobileNav.addEventListener('click', event => {
  if (event.target.closest('a')) setMobileMenu(false);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !mobileNav.hidden) {
    setMobileMenu(false);
    menuToggle.focus();
  }
});

window.addEventListener('hashchange', async () => {
  marketDataControllers.forEach(controller => controller.abort());
  marketDataControllers.clear();
  if (parseRoute() !== '/drawdown-analysis') abortDrawdownRequests();
  if (parseRoute() !== '/settings') clearSettingsPolling();
  render();
});

async function loadData() {
  const [stagesResponse, optionsResponse, indicatorsResponse, cycleResponse] = await Promise.all([
    fetch('/data/stages.json'),
    fetch('/data/options.json'),
    fetch('/data/indicators.json'),
    fetch('/data/cycle-shape.json')
  ]);
  if (!stagesResponse.ok || !optionsResponse.ok || !indicatorsResponse.ok || !cycleResponse.ok) throw new Error('Failed to load site data');
  state.stages = await stagesResponse.json();
  state.options = await optionsResponse.json();
  state.indicators = await indicatorsResponse.json();
  state.cycleShape = await cycleResponse.json();
  state.indicators.forEach(indicator => {
    state.ranges[indicator.id] = '1Y';
    state.marketData[indicator.id] = initialMarketModel(indicator);
  });
}

(async function bootstrap() {
  initializeTheme();
  try {
    await loadData();
    render();
    await Promise.all([loadMarketData('1Y'), loadNaaim('1Y')]);
    render({ preserveScroll: true });
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="page"><div class="notice"><strong>加载失败</strong><span>无法读取网站JSON配置，请检查server.js是否正常启动。</span></div></div>`;
  }
})();
