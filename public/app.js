'use strict';

const state = {
  stages: [],
  options: [],
  indicators: [],
  cycleShape: null,
  activeStageId: null,
  optionCategory: '全部',
  ranges: {},
  marketData: {},
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
  unavailable: { label: '正式来源暂不可用', tone: 'unavailable' }
});

const app = document.getElementById('app');
const themeToggle = document.getElementById('themeToggle');
const menuToggle = document.getElementById('menuToggle');
const mobileNav = document.getElementById('mobileNav');
let indicatorDialogTrigger = null;
const marketDataControllers = new Map();

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

function seriesToPath(values, width = 360, height = 126, pad = 6) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = pad + (index / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (value - min) / range) * (height - pad * 2);
    return [x, y];
  });
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${points.at(-1)[0].toFixed(2)},${height} L${points[0][0].toFixed(2)},${height} Z`;
  return { line, area, min, max };
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
  const isDemo = market.status === 'demo';
  const historyValues = Array.isArray(market.history) ? market.history.map(point => Number(point.value)).filter(Number.isFinite) : [];
  const values = historyValues.length > 1 ? historyValues : isDemo ? generateSeries(indicator, rangeKey) : [];
  const chart = values.length > 1 ? seriesToPath(values) : null;
  const available = new Set(market.availableRanges || []);
  const rangeButtons = RANGE_KEYS.map((key, i) => {
    const disabled = !isDemo && !available.has(key);
    return `<button class="range-tab${key === rangeKey ? ' active' : ''}" data-indicator-id="${indicator.id}" data-range="${key}" type="button" aria-pressed="${key === rangeKey}"${disabled ? ' disabled aria-disabled="true"' : ''}>${RANGE_LABELS[i]}</button>`;
  }).join('');
  const value = market.status === 'loading'
    ? '<span class="metric-value-skeleton" aria-label="加载中"></span>'
    : market.value === null || market.value === undefined
      ? '—'
      : `${escapeHtml(market.value)}${escapeHtml(market.unit || indicator.unit)}`;
  const secondaryValue = isDemo && Number.isFinite(indicator.percentile)
    ? `演示历史分位 ${indicator.percentile}%`
    : market.asOf ? `数据日期 ${escapeHtml(market.asOf)}` : '暂无可用数据日期';
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
          <div class="metric-title-row"><h3 class="metric-name">${escapeHtml(indicator.name)}</h3><button class="metric-info-button" type="button" data-indicator-info="${escapeHtml(indicator.id)}" aria-label="查看${escapeHtml(indicator.name)}指标说明">i</button></div>
          <p class="metric-subtitle">${escapeHtml(indicator.subtitle)}</p>
        </div>
        <div class="metric-value">
          <strong>${value}</strong>
          <span>${secondaryValue}</span>
        </div>
      </div>
      <div class="metric-status-row"><span class="metric-status" data-status="${statusMeta.tone}">${statusMeta.label}</span><span>${escapeHtml(market.statusMessage || '')}</span></div>
      ${chartMarkup}
      <div class="range-tabs" role="group" aria-label="时间范围">${rangeButtons}</div>
      <dl class="metric-data-meta">
        <div><dt>数据来源</dt><dd>${escapeHtml(market.source || '—')}</dd></div>
        <div><dt>更新时间</dt><dd>${escapeHtml(formatDateTime(market.updatedAt))}</dd></div>
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
          <a class="button ghost" href="#/indicators">查看指标说明</a>
        </div>
        <div class="metric-grid">${state.indicators.map(metricCard).join('')}</div>
        <div id="indicatorDialog" class="dialog-backdrop" hidden>
          <section class="indicator-dialog" role="dialog" aria-modal="true" aria-labelledby="indicatorDialogTitle" tabindex="-1">
            <header><div><span>Indicator Guide</span><h2 id="indicatorDialogTitle"></h2></div><button class="dialog-close" type="button" data-close-indicator-dialog aria-label="关闭指标说明">×</button></header>
            <div class="indicator-dialog-body">
              <p id="indicatorDialogValue" class="dialog-demo-value"></p>
              <section><h3>定义</h3><p id="indicatorDialogDefinition"></p></section>
              <section><h3>指标高低通常意味着什么</h3><p id="indicatorDialogInterpretation"></p></section>
              <section><h3>与市场周期的关系</h3><p id="indicatorDialogRelation"></p></section>
              <section class="dialog-limitations"><h3>使用限制</h3><p id="indicatorDialogLimitations"></p></section>
              <p class="notice"><strong id="indicatorDialogNoticeTitle">数据说明</strong><span id="indicatorDialogNoticeText"></span></p>
            </div>
          </section>
        </div>
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
      <header class="page-title"><div><p class="eyebrow">Indicator Reference</p><h1>六类辅助指标</h1><p>指标用于描述估值、隐含波动、情绪和机构风险敞口。数据状态逐项独立，且不构成网页自动判断。</p></div></header>
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

function setActiveNav(route) {
  document.querySelectorAll('.desktop-nav a').forEach(link => {
    const href = link.getAttribute('href').slice(1);
    const active = route === href || (href === '/' && route.startsWith('/stage/')) || (href === '/options' && route.startsWith('/options/'));
    link.classList.toggle('active', active);
  });
}

function bindCommonEvents() {
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

  const indicatorDialog = document.getElementById('indicatorDialog');
  const closeIndicatorDialog = () => {
    if (!indicatorDialog || indicatorDialog.hidden) return;
    indicatorDialog.hidden = true;
    document.body.classList.remove('dialog-open');
    indicatorDialogTrigger?.focus();
    indicatorDialogTrigger = null;
  };
  document.querySelectorAll('[data-indicator-info]').forEach(button => {
    button.addEventListener('click', () => {
      const indicator = state.indicators.find(item => item.id === button.dataset.indicatorInfo);
      if (!indicator || !indicatorDialog) return;
      const market = state.marketData[indicator.id] || initialMarketModel(indicator);
      const status = DATA_STATUS[market.status] || DATA_STATUS.error;
      indicatorDialogTrigger = button;
      const setText = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = valueOr(value); };
      setText('indicatorDialogTitle', indicator.name);
      const displayValue = market.value === null || market.value === undefined ? '暂无' : `${market.value}${market.unit || indicator.unit || ''}`;
      setText('indicatorDialogValue', `当前值：${displayValue} · ${status.label} · 来源：${market.source || '—'}`);
      setText('indicatorDialogDefinition', indicator.definition || indicator.meaning);
      setText('indicatorDialogInterpretation', indicator.interpretation || indicator.explain);
      setText('indicatorDialogRelation', indicator.marketRelation || '需要结合价格结构、波动率和市场广度共同判断。');
      setText('indicatorDialogLimitations', indicator.limitations || indicator.limits);
      setText('indicatorDialogNoticeTitle', status.label);
      setText('indicatorDialogNoticeText', market.status === 'demo'
        ? '当前数值为静态演示值，不代表实时市场数据；该指标不能单独用于判断市场阶段。'
        : `${market.statusMessage || '请核对数据状态。'}；该指标不能单独用于判断市场阶段。`);
      indicatorDialog.hidden = false;
      document.body.classList.add('dialog-open');
      indicatorDialog.querySelector('.indicator-dialog')?.focus();
    });
  });
  indicatorDialog?.querySelector('[data-close-indicator-dialog]')?.addEventListener('click', closeIndicatorDialog);
  indicatorDialog?.addEventListener('click', event => {
    if (event.target === indicatorDialog) closeIndicatorDialog();
  });
  indicatorDialog?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeIndicatorDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...indicatorDialog.querySelectorAll('button, [href], select, [tabindex]:not([tabindex="-1"])')].filter(item => !item.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
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
  state.route = route;
  document.body.classList.remove('dialog-open');
  indicatorDialogTrigger = null;
  setActiveNav(route);

  if (route === '/') app.innerHTML = homeTemplate();
  else if (route === '/compare') app.innerHTML = compareTemplate();
  else if (route === '/options' || route.startsWith('/options/')) app.innerHTML = optionsTemplate(route.split('/')[2]);
  else if (route === '/indicators') app.innerHTML = indicatorsTemplate();
  else if (route.startsWith('/stage/')) app.innerHTML = stageTemplate(state.stages.find(stage => stage.id === route.split('/')[2]));
  else app.innerHTML = notFoundTemplate();

  bindCommonEvents();
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

window.addEventListener('hashchange', () => {
  marketDataControllers.forEach(controller => controller.abort());
  marketDataControllers.clear();
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
    await loadMarketData('1Y');
    render({ preserveScroll: true });
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="page"><div class="notice"><strong>加载失败</strong><span>无法读取网站JSON配置，请检查server.js是否正常启动。</span></div></div>`;
  }
})();
