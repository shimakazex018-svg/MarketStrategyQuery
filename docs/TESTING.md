# 当前测试与验收方法

## 环境要求

- Windows PowerShell。
- Node.js 18 或更高版本。
- 项目没有第三方运行依赖和构建步骤；不需要生成 `package-lock.json` 或 `pnpm-lock.yaml`。
- 启动前检查目标端口，发现占用时先识别 PID，不终止未知进程。

## 自动检查

```powershell
npm.cmd run check
```

该命令执行：

1. `server.js`、`public/app.js` 和 UI 评审服务语法检查。
2. 产品数据契约检查：9阶段、8期权、6指标、7范围、固定顺序、必填字段和引用。
3. Node 自动测试：缓存、结构校验、来源错误分类、限流、调度、许可边界和故障回退。
4. Provider登记检查：固定状态枚举、必填字段、重复ID、附加条件和`enabled`硬门禁。
5. 自计算指标检查：有界CSV、SEC字段/季度TTM、QQQ PE双算法、实现波动率、历史分位、风险偏好、CFTC候选合约和人工Forward PE边界。

单独运行测试：

```powershell
npm.cmd test
```

当前没有编译或数据库迁移命令。

## 启动

```powershell
npm.cmd start
```

或：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-market-site.ps1
```

默认监听 `0.0.0.0:48101`。测试占用冲突时可以只在当前 PowerShell 会话覆盖端口：

```powershell
$env:PORT = "48216"
npm.cmd start
```

不要把临时测试端口写回代码或启动脚本。

## Smoke Check

```powershell
Invoke-RestMethod http://127.0.0.1:48101/api/health
Invoke-RestMethod 'http://127.0.0.1:48101/api/market-data/indicators?range=1Y'
Invoke-RestMethod http://127.0.0.1:48101/api/market-data/status
```

通过标准：

- `/api/health` 返回 HTTP 200、`ok: true`、`marketData: "ready"`，版本与 `package.json` 一致（当前为 `0.3.0-dev`）。
- 指标接口返回 6 个指标；默认许可未确认时 VIX/VXN 为 unavailable，其余四卡为 demo。
- 状态接口时区为 Asia/Shanghai，Cboe 权限为 not-confirmed。
- 状态接口同时返回Provider的技术状态、合规状态、登记启用值和实际启用值；第一检查点的Cboe与IBKR实际启用值均为false。
- 没有外部网络、没有 `FRED_API_KEY` 时仍能启动。

## HTTP 与安全检查

- `/`、`/styles.css`、`/app.js` 和 `public/data/*.json` 返回 200 与正确 MIME。
- 缺失静态文件返回 404 `text/plain`，不得回退首页。
- 非法 URL 解码和越界路径不得读取 `public/` 外文件。
- 浏览器只请求本站 `/api/market-data/*`，页面访问不触发第三方抓取。
- 手动刷新只允许可信本地网络，并受 30 分钟冷却、并发锁和每日预算限制。

## 页面回归

至少检查：

1. `#/`：九阶段周期图、六指标卡和状态说明。
2. `#/stage/high-consolidation`、`#/stage/right-side-reversal`、`#/stage/one-way-decline`。
3. `#/compare`：九阶段对比。
4. `#/options/protective-put` 和另一策略；刷新、前进、后退恢复选择。
5. `#/indicators`：六指标说明。
6. 未知 Hash：前端 404。

交互通过标准：

- 阶段动作与资产标签同一时间各显示一个面板，方向键与 `aria-selected` 同步。
- 期权核心损益和主要风险始终可见；原生折叠可由 Enter/Space 操作。
- 阶段页期权链接直达对应 `#/options/:id`。
- 指标说明弹窗可由 Escape、遮罩和关闭按钮关闭，焦点返回触发按钮。
- 深浅主题均可读；状态不能只依赖颜色。
- 单指标切换范围不改变其他卡片；不可用范围保持禁用。
- 控制台无错误。

## 响应式与可访问性

检查 `375×812`、`768×1024`、`1024×1366`、`1440×900`：

- 页面根节点无横向溢出；周期图只在自身容器横向滚动。
- 手机一列、平板两列、桌面三列指标卡。
- 长文本不溢出、不遮挡按钮、不被固定高度裁切。
- 导航、标签、折叠、弹窗和周期阶段支持键盘操作。
- 触摸目标不小于现有设计要求；375px 使用移动导航。
- `prefers-reduced-motion: reduce` 下动画近乎即时。

真实 iPad/iPhone 触摸、系统字体、125% 缩放、ZeroTier 路由和防火墙策略必须在目标设备人工验证，当前状态：待确认。

## 市场数据异常测试

自动测试应覆盖：

- 无缓存/有缓存启动、完全断网、没有 FRED Key。
- 超时、404、429、空数据、格式变化和异常数值。
- 数据日期未变化、不重复写入。
- 旧缓存回退、无缓存失败和单缓存文件损坏。
- 反复重启、周末跳过、预算跨日重置。
- 多请求并发锁、手动刷新冷却、指标与提供方每日上限。
- 许可未确认时不读取或展示旧在线缓存。
- 环境变量不能绕过`pending_written_confirmation`等未批准Provider状态。

## 自计算指标检查点A

自动测试还必须覆盖：

- CSV大小/行数/字段、标题、UTF-8文本、权重总和、重复ticker/日期、日期乱序、缺失或异常价格；
- SEC GAAP/IFRS字段回退、修订优先、重复事实、四季度TTM、10-K/10-Q防重复和显式拆股调整；
- QQQ PE财务/价格覆盖率、币种不一致、亏损公司两版本、近零或负分母；
- RV10/20/60最小样本、复权收盘价、日对数收益率、缺失交易日不插值；
- RV20分位只报告1/3/5/10年实际可用范围，不补模拟历史；
- `RISK-APPETITE-v1-EW`方向调整、等权贡献、缺失不补0和至少5/7覆盖门槛；
- Forward PE的固定methodology、来源、录入时间、重复与过期；
- CFTC目标合约缺失，以及单个派生计算失败不影响其他结果。

检查点A测试只使用虚构fixture，不读取`runtime-data/`，不请求SEC、CFTC、IBKR、Twelve Data或Alpha Vantage。正式首页和既有六卡仍按v0.3页面回归标准检查。

## IBKR隔离探测边界

- 当前主机没有TWS、IB Gateway或Client Portal Gateway，因此没有可执行的IBKR探测脚本。
- 后续只有在用户安装官方组件、本人完成登录并确认只读API设置后，才能在`scripts/data-source-probes/ibkr/`新增探测代码。
- 探测输出必须写入`runtime-data/data-source-probes/ibkr/`或操作系统临时目录，不得写入脚本目录、fixture或Git。
- 探测只允许合约搜索、行情权限模式和历史日线；不得请求账户、持仓、余额或订单信息。
- 48101现有服务不得用于探测；使用独立空闲端口或仅连接IBKR本机Socket端口。

`tests/review-server.js` 只用于展示六种 UI 状态，来源必须显示“UI验收夹具（非真实行情）”。它不进入正式启动路径，不访问第三方。

## 数据库、媒体与生成文件检查

数据库、缩略图、媒体上传、视频、HLS 和查重模块当前不存在，因此没有适用的迁移、索引、Range、转码或缩略图测试。若未来新增，必须先补充本节，不得假设已有验证覆盖。

## 常见失败现象

- `node` 或 `npm` 不可识别：安装/确认官方 Node.js 18+，或在当前 PowerShell 修正 PATH；不要改项目脚本规避环境问题。
- 48101 被占用：查明监听 PID，使用临时端口测试；不要终止未知服务。
- VIX/VXN 显示 unavailable：默认许可未确认时是预期行为，不是抓取故障。
- 没有 `FRED_API_KEY`：当前是预期配置，不影响启动。
- 单缓存损坏：服务应隔离文件并保持其他卡与健康检查可用。
- 缺失资源返回 404：Hash Router 下是预期行为。

## 最近确认的基线

2026-07-15，`feature/v0.4-compliant-market-data-waterfall` 自计算指标检查点A执行`npm.cmd run check`：42项测试通过、0失败；固定9阶段、8期权、6个现有首页指标、7范围和Provider合规门禁仍有效。没有UI变化，不重新生成截图。真实设备和ZeroTier跨设备验收仍待确认。
