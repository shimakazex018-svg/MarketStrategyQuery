# 当前系统架构

## 整体结构

```text
浏览器
  -> public/index.html + public/styles.css + public/app.js
  -> public/data/*.json
  -> 本站 /api/market-data/*
       -> market data service
       -> schema / cache / limiter / scheduler / logger
       -> 已获批准的数据源适配器（当前默认全部禁用）

Node.js 原生 HTTP 服务
  -> /api/health
  -> /api/market-data/*
  -> public/ 静态文件
```

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
  market-data/                  # 市场数据服务模块
  imports/                      # 有界CSV、权重、价格和人工输入校验
  derived-indicators/           # SEC/PE、RV、分位、风险偏好和COT纯计算内核
templates/imports/              # 仅含虚构数据的导入模板
scripts/                        # 数据检查、启动和防火墙辅助脚本
tests/                          # Node 自动测试与 UI 评审夹具服务
runtime-data/market-data/       # 运行缓存、请求状态和日志；不进入 Git
previews/                       # 经确认提交的产品评审截图
docs/                           # 长期上下文与专项设计文档
```

## 前端模块

- `public/app.js` 启动时并行加载阶段、期权、指标和周期图 JSON，随后按当前 Hash 渲染页面。
- 路由固定为 `#/`、`#/stage/:id`、`#/compare`、`#/options`、`#/options/:id`、`#/indicators`；未知 Hash 显示前端 404。
- 阶段详情按概览、仓位、执行动作、资产逻辑、识别条件、期权和风险组织；动作和资产逻辑同一时间各显示一个面板。
- 期权工具同一时间完整展示一个策略；最大收益、最大亏损、盈亏平衡和主要风险保持可见。
- 周期图由 `cycle-shape.json` 驱动 SVG；它是静态示意，不是 QQQ 真实历史。
- 指标卡只请求本站内部 API；路由切换会取消未完成请求。历史路径在服务端限制点数，避免 SVG、内存和 DOM 无界增长。
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
- `server/market-data/config.js`：读取环境变量和运行目录；不解析 `.env` 文件。
- `provider-compliance.js`：验证Provider字段、合规状态和`enabled`不变量；环境变量不能绕过该门禁。
- `schema.js`：统一模型、日期/数值校验、范围过滤和最多 240 点抽样。
- `cache-store.js`：按指标拆分 JSON，使用临时文件、`fsync` 和原子替换；损坏文件按指标隔离。
- `request-limiter.js`：持久化每日指标/提供方预算、手动冷却和并发锁。
- `scheduler.js`：Asia/Shanghai 工作日调度和有限重试。
- `service.js`：组合静态定义、缓存、许可决策、来源和状态回退。
- `logger.js`：有界日志轮转，防止磁盘持续增长。
- `http-api.js`：内部 API 路由、范围校验和可信网段手动刷新限制。
- `server/imports/`：最大2 MiB、10,000行的CSV解析，校验ticker、日期、权重、价格、来源和人工Forward PE，并生成SHA-256导入manifest。
- `server/derived-indicators/sec-facts.js`：可配置GAAP/IFRS字段优先级、修订去重、季度TTM和显式拆股口径调整。
- `qqq-pe.js`：比较加权盈利收益率与覆盖样本总市值/总盈利两种方法，同时输出包含亏损与排除亏损版本；不选择默认值。
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
| `POST /api/market-data/refresh/:id` | 受可信网络、冷却、锁和预算约束的维护刷新 |

页面访问和 GET 指标接口不会触发第三方抓取。外部访问只可能来自获批来源的启动过期检查、调度或受限手动刷新。

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

统一模型允许 `loading/fresh/stale/error/demo/unavailable/insufficient_coverage/manual`。后两种当前只供检查点A派生内核使用，正式首页要到检查点B才接入。无数据使用 `null`，不使用 0 或未标记模拟点。单指标失败不影响其他指标、健康检查或静态策略页面。

## 自计算数据流（检查点A）

```text
虚构fixture / 用户未来本地CSV
  -> 有界导入与SHA-256 manifest
  -> 标准化记录
  -> 独立派生计算
  -> 覆盖率、算法版本、输入日期和诊断
```

检查点A没有把该流接入`server.js`或正式API，也没有下载SEC/CFTC数据。检查点B才会把`runtime-data/imports|normalized|derived`接入内部API；原始、标准化和派生文件必须分层且继续忽略。

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

- 应进入 Git：源代码、`public/data/*.json`、测试、配置模板、脚本、文档和经确认的评审截图。
- Provider注册表只保存非敏感结论；账户ID、凭据、会话、订阅账单和真实响应不得进入注册表。
- 不应进入 Git：`runtime-data/`、`.env`、密钥、日志、缓存、PID、临时文件和机器相关状态。
- `node_modules/` 是本机依赖目录并被忽略；当前项目没有第三方运行依赖，不应提交。

## 不存在或不适用的模块

- 数据库模块：不存在。
- 缩略图生成、媒体上传、视频处理、HLS 和查重：不存在。
- 登录、权限、多用户和会话：不存在。
- IBKR正式连接、持仓读取、下单和交易队列：不存在；当前只有禁用的Provider登记和非敏感预检查文档。

若未来引入上述模块，必须同时更新本文件、`PROJECT_CONTEXT.md`、`DECISIONS.md`、`TESTING.md` 和运行数据忽略/清理策略，不能沿用本节假设。
