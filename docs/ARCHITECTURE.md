# 当前系统架构

## 整体结构

```text
浏览器
  -> public/index.html + public/styles.css + public/app.js + public/drawdown-analysis.js + public/drawdown-chart-interactions.js
  -> public/data/*.json
  -> 本站 /api/market-data/*
       -> market data service
       -> schema / cache / limiter / scheduler / logger
       -> 已获批准的数据源适配器（当前默认全部禁用）

Node.js 原生 HTTP 服务
  -> /api/health
  -> /api/market-data/* + /api/settings/data-acquisition
  -> public/ 静态文件
```

Windows 登录后由`MarketCycleStrategy-Autostart`启动隐藏PowerShell宿主；宿主只派生当前项目的Node进程、等待其退出并将退出码交给任务计划程序。PID文件、监听端口、Node路径和`server.js`命令行必须交叉匹配，未知进程永不被停止。

项目没有前端框架、打包器、第三方运行依赖、数据库、登录系统或后台任务队列。当前固定数据规模较小，不需要分页、虚拟列表或集中式缓存。

## 主要目录

```text
public/                         # 浏览器可访问的源文件
  index.html                    # 页面外壳、导航和全局控件
  app.js                        # Hash 路由、状态、渲染和交互
  styles.css                    # 主题、布局、组件、响应式和减少动画
  data/
    stages.json                 # 九阶段产品源数据
    options.json                # 八期权产品源数据
    indicators.json             # 六指标定义、演示/不可用状态配置
    cycle-shape.json            # 手工归一化周期示意数据
server.js                       # HTTP 服务组装、健康检查、静态文件
config/
  market-data-providers.json    # 非敏感Provider合规登记与启用状态
server/
  data-sources/                 # 外部来源下载和解析适配器
    web-pages/                  # 默认禁用的公开网页审计/低频采集边界
  market-data/                  # 市场数据服务模块
  imports/                      # 有界CSV、权重、价格和人工输入校验
  derived-indicators/           # SEC/PE、RV、分位、风险偏好和COT纯计算内核
templates/imports/              # 仅含虚构数据的导入模板
scripts/                        # 数据检查、启动和防火墙辅助脚本
tests/                          # Node 自动测试与 UI 评审夹具服务
tools/market-data-lab/
  core-data-acquisition/       # 九类核心数据的一次性隔离采集与本地报告；不进入正式服务
runtime-data/market-data/       # 运行缓存、请求状态和日志；不进入 Git
previews/                       # 经确认提交的产品评审截图
docs/                           # 长期上下文与专项设计文档
```

## 前端模块

- `public/app.js` 启动时并行加载阶段、期权、指标和周期图 JSON，随后按当前 Hash 渲染页面；`public/drawdown-analysis.js`提供可由浏览器和Node测试共同调用的纯回撤计算函数；`public/drawdown-chart-interactions.js`提供日期二分吸附、SVG坐标换算和日期到X坐标映射的纯函数。
- 路由固定为 `#/`、`#/stage/:id`、`#/compare`、`#/drawdown-analysis`、`#/options`、`#/options/:id`、`#/indicators`；未知 Hash 显示前端 404。
- 阶段详情按概览、仓位、执行动作、资产逻辑、识别条件、期权和风险组织；动作和资产逻辑同一时间各显示一个面板。
- 期权工具同一时间完整展示一个策略；最大收益、最大亏损、盈亏平衡和主要风险保持可见。
- 周期图由 `cycle-shape.json` 驱动 SVG；它是静态示意，不是 QQQ 真实历史。
- 指标卡只请求本站内部 API；路由切换会取消未完成请求。历史路径在服务端限制点数，避免 SVG、内存和 DOM 无界增长。
- 回撤分析页为两个指数及可用SOXX ETF分别缓存一次`range=ALL`完整历史，所有时间区间在前端过滤和计算；SOXX缺失或无效时从选择器省略。核心算法不使用图表抽样。SVG最多保留约620个显示点，并强制保留最大回撤峰谷、恢复点与最新点；日期游标改用完整有效序列二分吸附，只重绘虚线、选中点与Tooltip，不改显示路径或算法结果。
- 主题使用根元素 `data-theme`；断点为 1100px、760px 和 440px；`prefers-reduced-motion` 下动画缩短。

## 产品 JSON 模型

- 阶段：基础定义、识别条件、四资产独立仓位、资产增减配/禁止/风险、期权分级、四种情景动作、切换条件和风险收益边界。
- `adjacentStages` 只作数据兼容，不参与当前详情页渲染。
- `recognitionVisual` 为可选图片对象；缺失 `src` 时不创建空白占位。
- 期权：结构、买卖腿、标的、适用阶段、DTE、行权价、现金流、最大收益/亏损、盈亏平衡、行情表现、Theta、IV、退出、到期、风险和公式变量。
- 指标定义：当前静态说明与回退配置；运行时统一模型由服务端补充状态、来源、日期、历史和请求元数据。
- `scripts/check-data.js` 验证固定数量、顺序、必填字段和全部引用。

## 服务端模块

- `server.js`：创建市场数据服务和调度器；处理健康检查、内部 API 和安全静态文件响应。
- `server/data-sources/cboe-history.js`：Cboe VIX/VXN CSV 适配器；许可开关未确认时不会启用。
- `server/data-sources/etf-price-provider.js`：只读取本地正式SOXX文件，校验准确标的、日频顺序、空值、重复、异常跳点、已知拆分连续性、序列类型和复权状态；不会发网络请求。
- `server/data-sources/web-pages/`：WorldPEratio 专用的固定主机 HTTP fetcher、robots 解析、字段提取校验和禁用的浏览器边界；不读取用户 Cookie/Profile，不长期保存 HTML。
- `worldperatio.js`：独立 Provider 状态与 `runtime-data/market-data/web-pages/worldperatio/` 原子 JSON 缓存；合规登记未通过时不发请求、不调度。
- `pe-history-statistics.js`：`PE-HISTORY-TRIM10-v1` 纯计算原型，与 QQQ 成分横截面 WMAD4 严格分离。
- `server/market-data/config.js`：读取环境变量和运行目录；不解析 `.env` 文件。
- `provider-compliance.js`：验证Provider字段、合规状态和`enabled`不变量；环境变量不能绕过该门禁。
- `schema.js`：统一模型、日期/数值校验、范围过滤和最多 240 点抽样。
- `cache-store.js`：按指标拆分 JSON，使用临时文件、`fsync` 和原子替换；损坏文件按指标隔离。
- `request-limiter.js`：持久化每日指标/提供方预算、手动冷却和并发锁。
- `scheduler.js`：Asia/Shanghai 工作日调度和有限重试。
- `service.js`：组合静态定义、缓存、许可决策、来源和状态回退。
- `logger.js`：有界日志轮转，防止磁盘持续增长。
- `http-api.js`：内部 API 路由、范围校验和可信网段手动刷新限制。
- `acquisition-audit.js`：只保留采集元数据的有界审计文件；设置状态 API 只聚合现有 Provider、缓存、调度和审计状态，不触发采集。
- `scripts/visual-review/`：开发期本地视觉审阅工具；只连接48101本机服务，输出受隐私扫描保护的`previews/current/` WebP快照，不进入正式服务路径。
- `server/imports/`：最大2 MiB、10,000行的CSV解析，校验ticker、日期、权重、价格、来源和人工Forward PE，并生成SHA-256导入manifest。
- `tools/market-data/import-soxx-history.js`：从`runtime-data/`内的官方SpreadsheetML或用户CSV离线、幂等、原子导入SOXX；必须显式声明`seriesType`和`adjustmentStatus`。
- `server/derived-indicators/sec-facts.js`：可配置GAAP/IFRS字段优先级、修订去重、季度TTM和显式拆股口径调整。
- `qqq-pe.js`：输出保留全部正负盈利的原始加权E/P，以及基于weighted median/MAD、1.4826尺度和4倍边界的稳健E/P；极值只Winsorize、不删成分、不改权重。排除亏损与旧聚合市值法只保留为诊断。
- `realized-volatility.js` / `volatility-percentile.js`：基于复权收盘价计算RV10/20/60与1/3/5/10年实际可用分位。
- `risk-appetite.js`：`RISK-APPETITE-v1-EW`七分项等权原型；缺失不补0，至少5/7可用。
- `cot-positioning.js`：TFF候选合约字段计算；`209742`和`209747`仍未正式选定。
- `runner.js`：逐指标捕获计算错误，避免单项失败中断其他派生结果。

## 主要 API

| 方法与路径 | 作用 |
| --- | --- |
| `GET /api/health` | 服务健康与当前包版本 |
| `GET /api/market-data/status` | 许可、请求预算、缓存错误和指标状态 |
| `GET /api/market-data/indicators?range=1Y` | 六指标统一响应 |
| `GET /api/market-data/indicators/:id?range=1Y` | 单指标与指定历史范围 |
| `GET /api/market-data/metrics/:id/history?range=ALL` | 回撤分析使用的完整已校验历史；不抽样、不触发外部请求 |
| `POST /api/market-data/refresh/:id` | 受可信网络、冷却、锁和预算约束的维护刷新 |
| `GET /api/market-data/providers/worldperatio/status` | WorldPEratio 合规、技术和请求预算诊断；只读且不触发第三方请求 |
| `GET /api/market-data/providers/worldperatio/latest` | 读取最后标准化结果；不返回HTML、内容哈希或本地路径 |
| `GET /api/market-data/providers/worldperatio/history` | 读取来源公开历史能力结论和本站去重快照序列 |
| `GET /api/market-data/providers/worldperatio/statistics` | 读取当前参考PE与1/5/10/20年均值、标准差和估值标签 |

页面访问和 GET 指标接口不会触发第三方抓取。外部访问只可能来自获批来源的启动过期检查、调度或受限手动刷新。

`range=ALL`只扩展现有history读取路径。首页和指标详情继续使用固定七范围与最多240点响应；回撤分析读取`nasdaq100_index`、`sp500_index`和可选`soxx_price`，随后在浏览器内按日期、阈值和排序设置复用缓存，不建立平行数据服务。

WorldPEratio 不加入上述通用启动或定时刷新。经项目所有者有限风险接受后，只能通过独立维护入口执行；每次先检查30天条款复查状态和robots，每日一次正常目标请求，只有超时或5xx允许延迟重试一次，并在复查到期、403/429、登录、验证码、Cloudflare、robots禁止、目标/DOM/日期/数值冲突时停止。

公开响应若包含明确、唯一且逐点带日期和值的Nasdaq-100/QQQ历史序列，history API可以返回该标准化序列；否则只返回`summary_statistics_only`并从首次成功采集起积累本站快照。均值和标准差不得反推为历史点。

## 市场数据流与状态

```text
获批机器来源
  -> Provider合规登记硬门禁
  -> source adapter
  -> schema validation
  -> atomic cache
  -> market data service
  -> internal API
  -> indicator card / SVG history
```

统一页面模型允许`loading/fresh/stale/error/demo/unavailable/insufficient_coverage/manual/provisional/quality_warning`。`quality_warning`是与主状态并列的质量维度，允许与`provisional`同时存在。无数据使用`null`，不使用0或未标记模拟点。单指标失败不影响其他指标、健康检查或静态策略页面。

## 六指标正式数据流（v0.5）

```text
隔离实验中已成功的六项规范化文件
  -> 离线一次性导入器（校验、临时文件、原子替换）
  -> runtime-data/market-data/production/
  -> FredProvider / WorldPERatioProductionProvider
  -> ProductionDataCoordinator
  -> MarketDataService
  -> 内部API
  -> 首页六卡 / 指标详情与真实历史
```

正式指标ID固定为`nasdaq100_pe`、`sp500_pe`、`vix`、`vxn`、`nasdaq100_index`、`sp500_index`。PE的1/5/10/20年统计只进入`historicalStatistics`，不得混入本站逐日快照；快照不足2点时不绘制折线。FRED缺失观察保留为`null`且不连成0。

四项FRED序列和两个WorldPEratio页面由现有市场数据服务统一协调。每天Asia/Shanghai 07:30检查；同一来源当天成功后不重复请求，只有超时或5xx允许再尝试一次。单项更新失败不清空缓存，也不影响其他指标或静态页面。

SOXX是隐藏的分析指标，不属于六项首页摘要。正式序列位于`runtime-data/market-data/production/etf/soxx.json`；07:30任务只重新读取该本地文件，不访问iShares/BlackRock。当前官方工作簿口径为`nav + provider_adjusted`，不做二次拆分调整，也不把SOXX描述成SOX指数。

## 历史自计算数据流（保留兼容，不进入v0.5首页）

```text
虚构fixture / 用户未来本地CSV
  -> 有界导入与SHA-256 manifest
  -> 标准化记录
  -> 独立派生计算
  -> 覆盖率、算法版本、输入日期和诊断
```

`server/self-calculated/coordinator.js`已将该流接入正式内部API。启动时只读取本地导入、运行缓存和已存在的官方源缓存，不因浏览器访问触发外部请求。原始、标准化和派生文件分层位于`runtime-data/sources|imports|normalized|derived|market-data`并继续由Git忽略。

该模块的旧指标与详情代码只作历史兼容，不再属于v0.5正式六卡、正常导航或每日调度。直接访问旧指标ID时页面必须显示当前版本未启用，不显示模拟历史。

SEC bulk默认关闭。只有`SEC_BULK_UPDATE_ENABLED=true`、`SEC_USER_AGENT_APP`非空且`SEC_USER_AGENT_EMAIL`为有效邮箱时，Provider合规门禁和运行配置才同时允许请求；每天最多一次。CFTC使用官方TFF Futures Only数据集`gpe5-46if`，`209742`为正式代理，`209747`只作诊断候选；调度器只在Asia/Shanghai周六检查。两类外部源均原子写入、保留最后成功结果且不提交运行数据。

QQQ PE派生结果同时保留原始与WMAD4稳健分母稳定性、价格/财务/权重日期血缘、极值影响和两口径差值。旧覆盖公司“完整总市值/完整总盈利”算法明确标记为诊断对象，不得进入正式QQQ组合PE路径。真实输入的当前可用性和人工边界见`docs/PE_INPUT_AVAILABILITY.md`。

## 缓存、调度与资源边界

- 缓存根目录：`runtime-data/market-data/`；服务启动优先读缓存。
- 单指标每日最多 4 次外部请求；失败后等待 15、60、180 分钟。
- 单提供方每日最多 20 次；手动刷新冷却 30 分钟并带并发锁。
- VIX 工作日 07:10、VXN 工作日 07:15，时区 Asia/Shanghai；当前许可未确认，默认不抓取。
- 请求总超时 15 秒；连接阶段目标预算 10 秒。
- 同数据日期不重复写入；日志、原始响应和前端历史点均有上限。

## 启动流程

1. Node 读取 `HOST`、`PORT` 和市场数据环境变量。
2. 初始化运行目录、缓存、请求状态和有界日志。
3. 加载 `public/data/indicators.json` 并按许可决策生成 demo/unavailable/缓存模型。
4. 仅对已批准且过期的来源执行启动检查；周末跳过。
5. 启动调度器和 HTTP 服务，默认监听 `0.0.0.0:48101`。
6. 服务关闭时停止调度器定时器。

## 源文件与运行文件

### NAAIM local-import checkpoint A

- `tools/market-data/import-naaim-exposure.js` is an offline-only `.xlsx` importer for an owner-supplied NAAIM workbook under `runtime-data/imports/naaim/`.
- It uses the existing bounded ZIP reader, rejects macros, external workbook relationships, path traversal, oversized files, absent explicit Date/mean headers, conflicts, future observations, and values outside -200 through 200.
- A successful import atomically writes only ignored `runtime-data/market-data/production/naaim/naaim-exposure.json` and `import-state.json`; no provider, API, scheduler, or UI is connected until a real workbook has been audited.

- 应进入 Git：源代码、`public/data/*.json`、测试、配置模板、脚本、文档和经确认的评审截图。
- Provider注册表只保存非敏感结论；账户ID、凭据、会话、订阅账单和真实响应不得进入注册表。
- 不应进入 Git：`runtime-data/`、`.env`、密钥、日志、缓存、PID、临时文件和机器相关状态。
- 核心数据实验的真实raw、normalized、snapshots、reports、state和logs位于`runtime-data/market-data-lab/core-data-acquisition/`；实验代码及独立锁文件位于`tools/market-data-lab/core-data-acquisition/`，不由正式服务导入。
- 缺失项实验流先校验8个冻结文件，再按Invesco、Twelve Data、CFTC串行执行并在每个来源后复核；Twelve Data Key只从进程环境读取，CFTC只接受固定TFF Futures Only ZIP白名单。失败只更新隔离报告，不扩展来源或触发正式Provider/调度。
- `node_modules/` 是本机依赖目录并被忽略；当前项目没有第三方运行依赖，不应提交。

## 不存在或不适用的模块

- 数据库模块：不存在。
- 缩略图生成、媒体上传、视频处理、HLS 和查重：不存在。
- 登录、权限、多用户和会话：不存在。
- IBKR正式连接、持仓读取、下单和交易队列：不存在；当前只有禁用的Provider登记和非敏感预检查文档。

若未来引入上述模块，必须同时更新本文件、`PROJECT_CONTEXT.md`、`DECISIONS.md`、`TESTING.md` 和运行数据忽略/清理策略，不能沿用本节假设。
