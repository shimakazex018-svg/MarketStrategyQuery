'use strict';

const state = {
  stages: [],
  options: [],
  indicators: [],
  activeStageId: null,
  ranges: {},
  route: ''
};

const RANGE_LABELS = ['1个月', '3个月', '6个月', '1年', '3年', '5年', '10年'];
const RANGE_KEYS = ['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y'];

const app = document.getElementById('app');
const themeToggle = document.getElementById('themeToggle');
const menuToggle = document.getElementById('menuToggle');
const mobileNav = document.getElementById('mobileNav');

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
      <div>${listOr(guidance[level], '暂无').map(name => `<strong>${escapeHtml(name)}</strong>`).join('')}</div>
    </div>`).join('')}
    <p class="guidance-note">${escapeHtml(valueOr(guidance.note))}</p>`;
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

function marketCycleSvg(stages) {
  const boxes = [
    [52, 165, 156, 110], [236, 190, 156, 140], [420, 240, 156, 164],
    [604, 315, 156, 182], [788, 330, 156, 142], [972, 250, 156, 180],
    [1156, 158, 156, 170], [1340, 106, 156, 130], [1524, 58, 176, 126]
  ];
  const d = [
    'M 78 226',
    'C 105 184, 130 270, 165 220',
    'C 205 180, 230 294, 270 242',
    'C 306 215, 336 350, 370 292',
    'C 408 230, 430 382, 468 336',
    'C 508 286, 540 442, 575 370',
    'C 610 315, 625 520, 674 448',
    'C 718 386, 742 492, 786 438',
    'C 834 380, 876 360, 916 398',
    'C 954 420, 980 326, 1025 286',
    'C 1068 245, 1106 230, 1148 205',
    'C 1192 178, 1216 255, 1260 198',
    'C 1300 150, 1330 214, 1370 152',
    'C 1410 92, 1450 175, 1490 122',
    'C 1535 66, 1574 136, 1618 92',
    'C 1650 62, 1670 112, 1690 80'
  ].join(' ');
  const groups = stages.map((stage, i) => {
    const [x, y, w, h] = boxes[i];
    return `
      <g class="stage-zone${state.activeStageId === stage.id ? ' is-active' : ''}" tabindex="0" role="link" aria-label="查看${escapeHtml(stage.name)}策略" data-stage-id="${stage.id}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}"></rect>
        <text class="stage-index" x="${x + 16}" y="${y + 24}">S${String(stage.order).padStart(2, '0')}</text>
        <text x="${x + 16}" y="${y + 52}">${escapeHtml(stage.name)}</text>
        <text x="${x + 16}" y="${y + 77}" style="font-size:12px;fill:var(--text-soft);font-weight:500">${escapeHtml(stage.direction)}</text>
      </g>`;
  }).join('');
  return `
    <svg class="market-cycle" viewBox="0 0 1760 590" role="img" aria-label="九阶段横向市场周期示意图">
      <path class="cycle-path" d="${d}"></path>
      ${groups}
    </svg>`;
}

function metricCard(indicator, index) {
  const rangeKey = state.ranges[indicator.id] || '1Y';
  const values = generateSeries(indicator, rangeKey);
  const { line, area, min, max } = seriesToPath(values);
  const rangeButtons = RANGE_KEYS.map((key, i) => `<button class="range-tab${key === rangeKey ? ' active' : ''}" data-indicator-id="${indicator.id}" data-range="${key}" type="button" aria-pressed="${key === rangeKey}">${RANGE_LABELS[i]}</button>`).join('');
  return `
    <article class="metric-card reveal" style="transition-delay:${index * 45}ms">
      <div class="metric-top">
        <div>
          <h3 class="metric-name">${escapeHtml(indicator.name)}</h3>
          <p class="metric-subtitle">${escapeHtml(indicator.subtitle)}</p>
        </div>
        <div class="metric-value">
          <strong>${escapeHtml(indicator.value)}${escapeHtml(indicator.unit)}</strong>
          <span>历史分位 ${indicator.percentile}%</span>
        </div>
      </div>
      <span class="metric-status">${escapeHtml(indicator.status)}</span>
      <svg class="metric-chart" viewBox="0 0 360 126" preserveAspectRatio="none" aria-label="${escapeHtml(indicator.name)} ${rangeKey}模拟波形">
        <defs><linearGradient id="metricGradient-${index}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".65"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
        <line class="baseline" x1="0" x2="360" y1="63" y2="63"></line>
        <path d="${area}" fill="url(#metricGradient-${index})" opacity=".25"></path>
        <path class="line" d="${line}"></path>
      </svg>
      <div class="range-tabs" role="group" aria-label="时间范围">${rangeButtons}</div>
      <p class="metric-explain">${escapeHtml(indicator.explain)}</p>
      <p class="metric-subtitle">模拟区间：${min.toFixed(1)}–${max.toFixed(1)}</p>
    </article>`;
}

function homeTemplate() {
  const active = state.stages.find(stage => stage.id === state.activeStageId);
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
            ${active ? `<a class="button primary" href="#/stage/${active.id}">打开策略详情</a>` : '<a class="button primary" href="#cycle">选择市场阶段</a>'}
            <a class="button ghost" href="#/compare">查看阶段对比</a>
          </div>
        </aside>
      </section>

      <section id="cycle" class="section reveal">
        <div class="section-heading">
          <div><h2>市场周期地图</h2><p>九种形态覆盖从高位震荡、趋势破坏、恐慌去杠杆，到底部修复、右侧确认与过热上涨的主要循环。</p></div>
        </div>
        <div class="cycle-shell">
          <div class="cycle-toolbar"><strong>点击蓝色区域进入详情</strong><span>横向滚动可查看完整周期</span></div>
          <div class="cycle-scroll">${marketCycleSvg(state.stages)}</div>
          <div class="stage-strip">
            ${state.stages.map(stage => `<button type="button" class="stage-pill${state.activeStageId === stage.id ? ' active' : ''}" data-stage-id="${stage.id}"><span>S${String(stage.order).padStart(2, '0')} · ${escapeHtml(stage.category)}</span><strong>${escapeHtml(stage.name)}</strong></button>`).join('')}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <div><h2>辅助指标仪表盘</h2><p>第一版使用静态演示数值与模拟波形。每张卡片独立切换时间范围，互不联动。</p></div>
          <a class="button ghost" href="#/indicators">查看指标说明</a>
        </div>
        <div class="metric-grid">${state.indicators.map(metricCard).join('')}</div>
      </section>

      <section class="section reveal">
        <div class="notice"><strong>当前版本边界</strong><span>不接入真实行情、不进行系统自动判断、不保存人工确认、不读取IBKR持仓。页面结构和JSON数据接口已为后续版本预留。</span></div>
      </section>
    </div>`;
}

function stageTemplate(stage) {
  if (!stage) return notFoundTemplate();
  state.activeStageId = stage.id;
  const previous = stage.adjacentStages?.previous;
  const next = stage.adjacentStages?.next;
  const allocations = listOr(stage.allocations, {}).filter(item => item && typeof item === 'object');
  const actionPlan = stage.actionPlan || { initial: stage.actions };
  return `
    <div class="page">
      <div class="breadcrumb"><a href="#/">市场周期</a><span>/</span><span>${escapeHtml(stage.name)}</span></div>
      <header class="page-title">
        <div><p class="eyebrow">Stage ${String(stage.order).padStart(2, '0')} · ${escapeHtml(stage.category)}</p><h1>${escapeHtml(stage.name)}</h1><p>${escapeHtml(stage.summary)}</p></div>
        <a class="button" href="#/">返回周期图</a>
      </header>

      <section class="stage-summary-grid">
        <article class="summary-card reveal">
          <h2>市场状态定义</h2>
          <p>${escapeHtml(valueOr(stage.marketDefinition, stage.mode))}</p>
          <div class="stage-meta">
            <div class="meta-cell"><span>市场方向</span><strong>${escapeHtml(valueOr(stage.direction))}</strong></div>
            <div class="meta-cell"><span>风险等级</span><strong>${escapeHtml(valueOr(stage.risk))}</strong></div>
            <div class="meta-cell"><span>策略属性</span><strong>${escapeHtml(valueOr(stage.strategyProfile, stage.mode))}</strong></div>
          </div>
        </article>
        <article class="summary-card reveal">
          <h2>相邻阶段区别</h2>
          <div class="adjacent-grid">
            <div><span>与前一阶段</span><strong>${escapeHtml(valueOr(state.stages.find(item => item.id === previous?.id)?.name, '周期前序'))}</strong><p>${escapeHtml(valueOr(previous?.difference))}</p></div>
            <div><span>与后一阶段</span><strong>${escapeHtml(valueOr(state.stages.find(item => item.id === next?.id)?.name, '周期后序'))}</strong><p>${escapeHtml(valueOr(next?.difference))}</p></div>
          </div>
        </article>
      </section>

      <section class="content-grid">
        <article class="content-card full reveal">
          <h2>典型识别条件</h2>
          ${renderList(stage.conditions)}
        </article>
        <article class="content-card full reveal">
          <h2>允许仓位区间</h2>
          <p>各资产区间相互独立，不要求上下限合计为100%，也不代表应同时取上限或下限。</p>
          <div class="allocation-grid">
            ${allocations.map(item => `<div class="allocation-card"><span class="ticker">${escapeHtml(valueOr(item.ticker))}</span><div class="range">${escapeHtml(valueOr(item.range))}</div><p>${escapeHtml(valueOr(item.role))}</p></div>`).join('')}
          </div>
        </article>
        <article class="content-card full reveal">
          <h2>各资产配置逻辑</h2>
          <div class="asset-rule-grid">
            ${allocations.map(item => {
              const rule = stage.assetRules?.[item.ticker] || {};
              return `<section class="asset-rule-card"><header><strong>${escapeHtml(valueOr(item.ticker))}</strong><span>${escapeHtml(valueOr(item.range))}</span></header><p>${escapeHtml(valueOr(item.role))}</p><dl><div><dt>增配条件</dt><dd>${escapeHtml(valueOr(rule.increaseWhen))}</dd></div><div><dt>减配条件</dt><dd>${escapeHtml(valueOr(rule.reduceWhen))}</dd></div><div><dt>禁止条件</dt><dd>${escapeHtml(valueOr(rule.avoidWhen))}</dd></div><div><dt>主要风险</dt><dd>${escapeHtml(valueOr(rule.risk))}</dd></div></dl></section>`;
            }).join('')}
          </div>
        </article>
        <article class="content-card full reveal">
          <div class="card-heading-row"><div><h2>期权策略分级</h2><p>阶段分级只说明用途优先级；建仓前仍需核对完整损益与管理规则。</p></div><a class="button ghost" href="#/options">打开期权工具库</a></div>
          <div class="guidance-grid">${optionGuidanceMarkup(stage)}</div>
        </article>
        <article class="content-card full reveal">
          <h2>执行动作</h2>
          <div class="scenario-grid">
            <section><h3>初始执行</h3>${renderList(actionPlan.initial, 'action-list')}</section>
            <section><h3>继续恶化</h3>${renderList(actionPlan.worsening, 'risk-list')}</section>
            <section><h3>维持不变</h3>${renderList(actionPlan.unchanged, 'condition-list')}</section>
            <section><h3>市场改善</h3>${renderList(actionPlan.improving, 'action-list')}</section>
          </div>
        </article>
        <article class="content-card full reveal">
          <h2>阶段切换条件</h2>
          ${renderList(stage.transitionConditions, 'condition-list')}
        </article>
        <article class="content-card reveal">
          <h2>潜在收益来源</h2>
          ${renderList(stage.returnSources, 'action-list')}
        </article>
        <article class="content-card reveal">
          <h2>潜在亏损来源</h2>
          ${renderList(stage.lossSources, 'risk-list')}
        </article>
        <article class="content-card full reveal risk-boundary">
          <h2>风险边界与机会成本</h2>
          <div class="risk-boundary-grid"><div><span>最大不利情景</span><p>${escapeHtml(valueOr(stage.worstCase))}</p></div><div><span>策略失效条件</span><p>${escapeHtml(valueOr(stage.invalidation))}</p></div><div><span>机会成本</span><p>${escapeHtml(valueOr(stage.opportunityCost))}</p></div></div>
          <div class="critical-notice"><strong>风险提示</strong><p>${escapeHtml(valueOr(stage.riskNotice, listOr(stage.risks).join('；')))}</p></div>
        </article>
      </section>
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
  const performance = option.performance || {};
  const example = option.formulaExample || {};
  return `
    <article class="option-card reveal">
      <div class="option-header">
        <h2>${escapeHtml(option.name)}<small>${escapeHtml(option.english)}</small></h2>
        <div class="option-badges"><span class="option-purpose">${escapeHtml(valueOr(option.category))}</span><span class="option-purpose muted">${escapeHtml(valueOr(option.purpose))}</span></div>
      </div>
      <div class="option-structure"><span>交易结构</span>${escapeHtml(valueOr(option.structure))}</div>
      <div class="option-facts">
        <div class="option-fact"><span>建仓现金流</span><strong>${escapeHtml(valueOr(option.cashflow))}</strong></div>
        <div class="option-fact"><span>市场方向判断</span><strong>${escapeHtml(valueOr(option.bias))}</strong></div>
        <div class="option-fact"><span>适用标的</span><strong>${listOr(option.underlyings).map(escapeHtml).join(' / ')}</strong></div>
        <div class="option-fact"><span>适用阶段</span><strong>${listOr(option.idealStages).map(escapeHtml).join(' / ')}</strong></div>
      </div>
      <div class="option-leg-grid"><div><span>买入腿</span>${renderList(listOr(option.buyLegs, '无独立买入期权腿'), 'compact-list')}</div><div><span>卖出腿</span>${renderList(listOr(option.sellLegs, '无独立卖出期权腿'), 'compact-list')}</div><div><span>不适用阶段</span>${renderList(option.unsuitableStages, 'compact-list')}</div></div>
      <ul class="formula-list">
        <li><strong>最大收益：</strong>${escapeHtml(valueOr(option.maxGain))}</li>
        <li><strong>最大亏损：</strong>${escapeHtml(valueOr(option.maxLoss))}</li>
        <li><strong>盈亏平衡：</strong>${escapeHtml(valueOr(option.breakeven))}</li>
      </ul>
      <div class="option-planning-grid"><section><h3>DTE选择逻辑</h3><p>${escapeHtml(valueOr(option.dteLogic))}</p></section><section><h3>行权价逻辑</h3><p>${escapeHtml(valueOr(option.strikeLogic))}</p></section></div>
      <div class="performance-grid"><section><span>标的上涨</span><p>${escapeHtml(valueOr(performance.up))}</p></section><section><span>标的横盘</span><p>${escapeHtml(valueOr(performance.sideways))}</p></section><section><span>标的下跌</span><p>${escapeHtml(valueOr(performance.down))}</p></section></div>
      <div class="management-grid"><section><h3>时间价值</h3><p>${escapeHtml(valueOr(option.thetaImpact))}</p></section><section><h3>隐含波动率</h3><p>${escapeHtml(valueOr(option.ivImpact))}</p></section><section><h3>提前退出</h3><p>${escapeHtml(valueOr(option.earlyExit))}</p></section><section><h3>到期处理</h3><p>${escapeHtml(valueOr(option.expiration))}</p></section></div>
      <div class="option-risk-grid"><section><h3>主要风险</h3><p>${escapeHtml(valueOr(option.risk))}</p></section><section><h3>机会成本</h3><p>${escapeHtml(valueOr(option.opportunityCost))}</p></section></div>
      <details class="formula-details"><summary role="button" tabindex="0" aria-expanded="false">变量说明与公式示例</summary><div class="variable-grid">${listOr(option.variables, {}).filter(item => item && typeof item === 'object').map(item => `<div><strong>${escapeHtml(valueOr(item.symbol))}</strong><span>${escapeHtml(valueOr(item.meaning))}</span></div>`).join('')}</div><p><strong>示例假设：</strong>${escapeHtml(valueOr(example.scenario))}</p><p><strong>计算：</strong>${escapeHtml(valueOr(example.calculation))}</p><p><strong>解释：</strong>${escapeHtml(valueOr(example.conclusion))}</p><p>公式默认1张美股期权对应100股，未计佣金、税费、提前行权、指派和实际滑点。</p></details>
    </article>`;
}

function optionsTemplate() {
  return `
    <div class="page">
      <div class="breadcrumb"><a href="#/">首页</a><span>/</span><span>期权工具</span></div>
      <header class="page-title"><div><p class="eyebrow">Option Toolkit</p><h1>八类期权工具</h1><p>逐项核对交易腿、适用场景、损益边界、期限与行权价、行情表现、退出和到期处理。</p></div></header>
      <div class="notice" style="margin-bottom:18px"><strong>计算口径</strong><span>示例公式按每股权利金表达，乘数按100计算。组合内现货成本、净权利金的正负方向必须在实际建仓时重新核对。</span></div>
      <section class="option-grid">${state.options.map(optionTemplate).join('')}</section>
    </div>`;
}

function indicatorsTemplate() {
  return `
    <div class="page">
      <div class="breadcrumb"><a href="#/">首页</a><span>/</span><span>指标说明</span></div>
      <header class="page-title"><div><p class="eyebrow">Indicator Reference</p><h1>六类辅助指标</h1><p>指标用于描述估值、隐含波动、情绪和机构风险敞口。第一版全部为演示数据，不构成网页自动判断。</p></div></header>
      <section class="indicator-list">
        ${state.indicators.map(indicator => `<article class="indicator-row reveal"><div><h2>${escapeHtml(indicator.name)}</h2><span class="metric-status">演示值 ${escapeHtml(indicator.value)}${escapeHtml(indicator.unit)}</span></div><div><strong>指标意义</strong><p>${escapeHtml(indicator.meaning)}</p></div><div><strong>使用限制</strong><p>${escapeHtml(indicator.limits)}</p></div></article>`).join('')}
      </section>
    </div>`;
}

function notFoundTemplate() {
  return `<div class="page"><header class="page-title"><div><p class="eyebrow">404</p><h1>页面不存在</h1><p>该地址没有对应内容。</p><div class="hero-actions"><a class="button primary" href="#/">返回首页</a></div></div></header></div>`;
}

function setActiveNav(route) {
  document.querySelectorAll('.desktop-nav a').forEach(link => {
    const href = link.getAttribute('href').slice(1);
    const active = route === href || (href === '/' && route.startsWith('/stage/'));
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

  document.querySelectorAll('.range-tab').forEach(button => {
    button.addEventListener('click', () => {
      state.ranges[button.dataset.indicatorId] = button.dataset.range;
      render();
      requestAnimationFrame(() => document.querySelector(`[data-indicator-id="${button.dataset.indicatorId}"][data-range="${button.dataset.range}"]`)?.focus());
    });
  });

  document.querySelectorAll('.formula-details').forEach(details => {
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

function render() {
  const route = parseRoute();
  state.route = route;
  setActiveNav(route);

  if (route === '/') app.innerHTML = homeTemplate();
  else if (route === '/compare') app.innerHTML = compareTemplate();
  else if (route === '/options') app.innerHTML = optionsTemplate();
  else if (route === '/indicators') app.innerHTML = indicatorsTemplate();
  else if (route.startsWith('/stage/')) app.innerHTML = stageTemplate(state.stages.find(stage => stage.id === route.split('/')[2]));
  else app.innerHTML = notFoundTemplate();

  bindCommonEvents();
  app.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
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

window.addEventListener('hashchange', render);

async function loadData() {
  const [stagesResponse, optionsResponse, indicatorsResponse] = await Promise.all([
    fetch('/data/stages.json'),
    fetch('/data/options.json'),
    fetch('/data/indicators.json')
  ]);
  if (!stagesResponse.ok || !optionsResponse.ok || !indicatorsResponse.ok) throw new Error('Failed to load site data');
  state.stages = await stagesResponse.json();
  state.options = await optionsResponse.json();
  state.indicators = await indicatorsResponse.json();
  state.indicators.forEach(indicator => { state.ranges[indicator.id] = '1Y'; });
}

(async function bootstrap() {
  initializeTheme();
  try {
    await loadData();
    render();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="page"><div class="notice"><strong>加载失败</strong><span>无法读取网站JSON配置，请检查server.js是否正常启动。</span></div></div>`;
  }
})();
