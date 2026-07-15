'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHttpServer } = require('../server');

const rootDir = path.join(__dirname, '..');
const port = Number(process.env.PORT || 48215);
const reviewState = ['loading', 'fresh', 'stale', 'error'].includes(process.env.REVIEW_STATE)
  ? process.env.REVIEW_STATE
  : 'fresh';
const definitions = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'data', 'indicators.json'), 'utf8'));

function history() {
  const points = [];
  const end = new Date('2026-07-13T00:00:00Z');
  for (let index = 0; index < 64; index += 1) {
    const date = new Date(end.valueOf() - (63 - index) * 6 * 24 * 60 * 60 * 1000);
    const value = 18 + Math.sin(index / 4) * 3 + Math.cos(index / 9) * 1.5 + (index > 51 ? (index - 51) * 0.12 : 0);
    points.push({ date: date.toISOString().slice(0, 10), value: Number(value.toFixed(2)) });
  }
  return points;
}

function demoModel(definition) {
  return {
    id: definition.id,
    displayName: definition.name,
    value: definition.value,
    unit: definition.unit || '',
    asOf: '2026-07-13',
    source: definition.demoSource || '本地静态演示数据',
    sourceUrl: null,
    sourceType: 'demo',
    status: 'demo',
    statusMessage: definition.demoMessage || '静态演示值，不代表实时市场数据',
    updatedAt: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextAllowedAt: null,
    isDemo: true,
    isStale: false,
    availableRanges: ['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y'],
    history: []
  };
}

function unavailableModel(definition) {
  return {
    ...demoModel(definition),
    value: null,
    asOf: null,
    source: 'Cboe（许可待确认）',
    sourceType: 'unavailable',
    status: 'unavailable',
    statusMessage: '正式来源暂不可用',
    isDemo: false,
    availableRanges: []
  };
}

function vixReviewModel() {
  const isValueState = reviewState === 'fresh' || reviewState === 'stale';
  return {
    id: 'vix',
    displayName: 'VIX',
    value: isValueState ? 17.16 : null,
    unit: '',
    asOf: isValueState ? '2026-07-13' : null,
    source: 'UI验收夹具（非真实行情）',
    sourceUrl: null,
    sourceType: 'test-fixture',
    status: reviewState,
    statusMessage: reviewState === 'fresh'
      ? '状态渲染验收：模拟正常数据'
      : reviewState === 'stale'
        ? '状态渲染验收：更新失败，保留最后成功数据'
        : reviewState === 'loading'
          ? '状态渲染验收：正在读取本地缓存'
          : '状态渲染验收：无缓存且数据源请求失败',
    updatedAt: isValueState ? '2026-07-14T00:10:00.000Z' : null,
    lastAttemptAt: reviewState === 'loading' ? null : '2026-07-14T00:10:00.000Z',
    lastSuccessAt: isValueState ? '2026-07-14T00:10:00.000Z' : null,
    nextAllowedAt: reviewState === 'stale' || reviewState === 'error' ? '2026-07-14T00:25:00.000Z' : null,
    isDemo: false,
    isStale: reviewState === 'stale',
    availableRanges: isValueState ? ['1M', '3M', '6M', '1Y'] : [],
    history: isValueState ? history() : []
  };
}

function models(range = '1Y') {
  return definitions.map(definition => {
    const model = definition.id === 'vix'
      ? vixReviewModel()
      : definition.dataMode === 'demo' ? demoModel(definition) : unavailableModel(definition);
    return { ...model, requestedRange: range, servedAt: new Date().toISOString() };
  });
}

const service = {
  getIndicators: range => models(range),
  getIndicator: (id, range) => models(range).find(model => model.id === id) || null,
  getStatus: () => ({
    enabled: false,
    timezone: 'Asia/Shanghai',
    reviewFixture: true,
    indicators: models().map(({ id, status }) => ({ id, status })),
    servedAt: new Date().toISOString()
  }),
  refresh: async () => ({ ok: false, statusCode: 409, reason: 'review-fixture-read-only' })
};

const server = createHttpServer(service);
server.listen(port, '127.0.0.1', () => {
  console.log(`Review fixture (${reviewState}) running on http://127.0.0.1:${port}`);
});

