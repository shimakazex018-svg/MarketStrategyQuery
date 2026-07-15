# 市场数据架构

## 目标

在不增加第三方运行依赖和数据库的前提下，为六张指标卡提供统一、可离线启动、失败隔离且受请求预算约束的数据层。来源是否启用由审计决策控制，公开端点不等于许可通过。

## 数据流

```text
已批准的官方来源
  -> provider compliance registry（状态与附加条件硬门禁）
  -> source adapter（下载、解析）
  -> schema validation（日期、数值、顺序、异常值）
  -> cache store（临时文件 + 原子替换）
  -> market data service（fresh/stale/error/demo/unavailable）
  -> internal API
  -> browser cards and SVG history
```

浏览器访问首页、指标说明或其他页面时只请求本网站的 `/api/market-data/*`。页面访问不会触发任何第三方请求。

正式启用还要求Provider注册状态为`approved`，或`approved_with_conditions`且附加条件全部满足，并明确设置`enabled=true`。环境变量只是第二确认，不能覆盖注册状态。

## 模块边界

```text
server/
  data-sources/       # 每个官方来源独立的下载与解析适配器
  market-data/
    cache-store.js    # 原子 JSON 缓存、损坏隔离、容量控制
    schema.js         # 统一模型与范围过滤
    request-limiter.js# 指标/提供方每日预算、冷却与并发锁
    scheduler.js      # Asia/Shanghai 调度与有限重试
    service.js        # 组合演示配置、缓存和在线来源
    logger.js         # 有界抓取日志
    provider-compliance.js # Provider登记校验与启用判定
config/
  market-data-providers.json # 非敏感合规状态；不得保存凭据或真实响应
runtime-data/         # 不提交；运行时缓存、状态和日志
tests/
  fixtures/market-data/
```

`server.js` 只负责创建服务、路由内部 API 和静态文件，不包含各来源解析细节。

## 统一模型

```json
{
  "id": "vix",
  "displayName": "VIX",
  "value": null,
  "unit": "",
  "asOf": null,
  "source": "Cboe",
  "sourceUrl": "https://www.cboe.com/",
  "sourceType": "official",
  "frequency": "daily-close",
  "status": "unavailable",
  "statusMessage": "正式来源许可待确认",
  "updatedAt": null,
  "lastAttemptAt": null,
  "lastSuccessAt": null,
  "nextAllowedAt": null,
  "isDemo": false,
  "isStale": false,
  "availableRanges": [],
  "historyStart": null,
  "history": []
}
```

合法状态固定为 `loading`、`fresh`、`stale`、`error`、`demo`、`unavailable`。没有数值时使用 `null`，绝不使用 0 占位。

## 缓存与磁盘边界

- 每个指标保存独立 `latest/<id>.json`，单文件损坏只影响该指标。
- 写入同目录临时文件，完成 `fsync` 后原子替换。
- 历史按日期去重并升序保存；相同日期、值和来源不重复写入。
- 原始响应只用于诊断且有数量/大小上限；默认不保存受许可限制的响应。
- 日志按大小轮转并限制保留份数，防止硬盘持续增长。
- `runtime-data/` 整体忽略；fixtures 使用人工或最小化合规样本。

## 请求与调度

- 时区：`Asia/Shanghai`。
- VIX：工作日 07:10；VXN：工作日 07:15。
- 单指标每日最多 4 次外部请求，延迟为 0、15、60、180 分钟；四次失败后当天停止。
- 单提供方每日最多 20 次，若官方上限更低则使用更低值。
- 总请求超时 15 秒；连接阶段目标预算 10 秒。原生 `fetch` 无独立连接超时回调，因此由总超时可靠中止并在日志中分类。
- 缓存未过期时不抓取；数据日期未变化时不写入历史。
- 服务启动优先读缓存；仅过期且来源已批准时安排一次启动检查。
- 手动刷新为维护接口，30 分钟冷却、持久化计数、并发锁，只接受可信本地网络。
- 周末不安排正常抓取；短时间反复重启不能重置持久化预算。

## 前端性能

- 六张卡分别读取同一个内部 API 响应，一个指标失败不阻塞其余指标。
- 范围切换请求内部 API，不访问第三方。
- 服务端按范围过滤；绘图前把超长日线抽样到有限点数，避免 SVG 路径和内存无界增长。
- 请求通过 `AbortController` 在路由切换或重载时取消；事件监听仍由现有单页生命周期管理。
- loading 保持卡片尺寸，避免布局跳动；stale 保留最后成功值；error/unavailable 不绘制伪造曲线。

## 脱机行为

没有网络、没有 Key 或来源未获许可时，服务仍可启动：

1. 有有效缓存：显示 fresh；
2. 有旧缓存且更新失败：显示 stale；
3. 无缓存且获批来源请求失败：显示 error；
4. 静态演示指标：显示 demo；
5. 审计后无可用来源：显示 unavailable。

任何情况下都不因外部来源失败而使 `/api/health` 或静态页面失效。

## v0.4自计算扩展

检查点A新增`server/imports/`与`server/derived-indicators/`，但尚未接入正式服务。详细数据层次、SEC/CFTC边界和资源限制见`SELF_CALCULATED_MARKET_DATA_DESIGN.md`，PE与风险偏好口径分别见对应规格文档。

派生状态增加`insufficient_coverage`与`manual`。覆盖不足时值必须为`null`；人工Forward PE必须携带来源、口径、数据日期和录入时间。检查点A不改变现有首页六卡、调度器或外部请求路径。
