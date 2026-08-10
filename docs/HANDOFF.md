# 最新交接

## 2026-08-10 Portfolio calendar pointer-follow tooltip

- Desktop Tooltip uses pointer client coordinates with one shared `pointer-events: none` DOM node, rAF position updates, 12px viewport margins, and right/bottom collision handling. Keyboard and touch continue to use cell-anchor positioning; no portfolio data path changed.

## 2026-08-10 Portfolio asset cache bust

- Formal 48101 returned byte-identical current app/styles/calendar assets and the production authenticated DOM showed the shared calendar popover. Public HTML now uses commit-versioned query strings for the three current assets; no Flex, portfolio service, or restart change was made.

## 2026-08-10 Portfolio daily return calendar

- The calendar now formats signed base-currency P&L values for full display when the cell fits and compact K/M values only when it does not; the full amount is retained in the shared Tooltip/Popover.
- Desktop hover/focus, iPad/iPhone tap, date switching, outside close, Escape, Hash/scroll stability, request stability, overflow, synthetic formatter tests, and visual review passed. No Flex, portfolio service, SQLite schema, CashTransactions classification, return algorithm, benchmark, or sync code changed.

## 2026-08-10 Offline portfolio performance calibration

- The existing ignored Flex XML and SQLite were recalibrated offline; no new Flex request was made and no secret, account identifier, amount, holding, or raw activity description entered Git.
- Cash activity now separates external capital flow from internal transfer and income/expense events. The date-only performance method is `daily_flow_adjusted_return`; the raw source fields remain runtime-only for audit.
- Local Nasdaq-100, S&P 500, and SOXX histories are aligned only on valid portfolio dates. Use `npm.cmd run portfolio:replay` for a future offline replay; do not use `portfolio:sync` for this calibration boundary.

## 2026-08-10 IBKR Flex real-response calibration

- The controlled read-only Flex request chain reached HTTP 200 XML for both request stages; no IBKR error code was returned. The raw response and structural capability audit remain in ignored runtime data only.
- `EquitySummaryInBase` now supplies the CORE NAV/base-currency path, and the latest parsed record date is used for coverage. The local reprocessing path verified SQLite import, daily performance generation, and cash-flow reconciliation metadata without publishing account values.
- Income and IBKR-reported performance sections were absent in the response and remain optional warnings. No Query field change is required for the CORE path based on the structure audit; do not configure trading or add credentials to Git.
- The scheduler now consumes one attempt per local day after success or failure, preventing automatic Flex request loops. Production mode remains separate from `synthetic-review-fixture`; `tools/market-data-lab/` remains untouched.

## 当前状态

- 当前分支为 `main`；本轮最终提交前基线为 `4b44705fa510e13b86fcb21ce80d2a86ae4cd9d3`。用户既有未跟踪的 `tools/market-data-lab/` 保持原样、未暂存、未接入正式服务。
- 资产分析未认证页面的真实交互循环已修复；认证修复、交互回归、视觉 manifest 和验收文档属于本轮最终公开提交范围，前一阶段已有提交不在本轮重写范围内。
- 修复后的认证状态使用 `unknown`、`checking`、`unauthenticated`、`authenticating`、`authenticated` 和 `error`；401 后不会再次自动请求，登录面板在未认证空闲期间保持单实例。
- 已完成只读 IBKR Flex Web Service v3 投资组合模块：官方两步请求客户端、DOM-free XML 适配、Node 内置 SQLite/WAL、版本化 schema、幂等导入、现金流/NAV/P&L/收益率语义、基准复用、scrypt 本机密码、受保护 API、独立 `10:30 Asia/Shanghai` 同步和启动补采。
- 已完成 `#/portfolio-analysis`：金额本地显示开关、掩码账户、`1D/MTD/3M/6M/YTD/1Y/ALL/CUSTOM`、收益率/P&L/NAV SVG 曲线、鼠标/触摸/键盘十字线、收益日历、月度统计、贡献、现金流桥、持仓、交易和同步覆盖状态。
- 真实 Flex 配置尚未提供；生产页在本机密码登录后会显示 `IBKR 尚未连接` 或历史缓存状态。页面不会因打开而触发 IBKR 请求。
- 正式 `48101` 已由现有隐藏 Windows 计划任务恢复为当前代码的单实例；health 为 ready，production 未启用 `PORTFOLIO_REVIEW_FIXTURE`，`48102` 保持可用。
- 合成审查模式为 `PORTFOLIO_REVIEW_FIXTURE=synthetic-review-fixture`，使用内存 SQLite 和 `SIM000001`，不读取本机生产组合缓存。
- `npm.cmd run check` 已包含公开仓库隐私扫描；它阻止跟踪/暂存 runtime-data、SQLite/WAL/SHM、raw Flex、真实 IBKR 账户号和凭据。
- 已新增 `npm.cmd run test:interaction`，使用独立临时端口和 `synthetic-review-fixture`，覆盖鼠标、键盘、触摸、认证错误/成功、登出、刷新和30秒未认证稳定性；视觉快照与交互测试分开。

## 已验证

- `node --check`：server、组合模块、前端和视觉脚本通过。
- `node --test tests/portfolio-analysis.test.js`：Flex 缺失值、幂等导入、合成夹具、API 401/登录/无交易路由通过。
- `npm.cmd run check`：181/181 测试通过；数据检查、公开仓库隐私扫描和组合模块语法检查通过，Node 测试默认单并发运行。
- 合成 Flex 两步同步：SendRequest/GetStatement 调用 2 次，NAV、现金、资金流和每日绩效正确落库，缺失字段保持 `null`。
- 隔离浏览器：桌面、768×1024、390×844 无横向溢出；金额开关、3M、NAV、键盘 Home 十字线和组合页主要内容通过。
- REAL INTERACTION SMOKE 已通过：未认证30秒登录表单/面板各挂载1次、移除0次、`pageIn`动画1次、Hash/滚动稳定、异常 console error 为0；错误/正确合成密码、登出、刷新、指标弹窗、阶段、回撤指针、设置页和 iPad/iPhone 触摸入口通过。
- 当前视觉快照：`previews/current/` 含组合桌面/iPad/iPhone、日历、收益曲线以及既有页面 WebP；manifest 声明 `synthetic-review-fixture`、`containsRealAccountData: false`、`repositoryVisibility: public`、`interactionReview: passed`、`portfolioLoginLoopRegression: passed` 和 `externalRequestsTriggered: 0`。

## 下一步

1. 后续保持正式 `48101` 为 production、单实例、未连接状态；不要开始真实 Flex 配置。
2. 不要使用 `git add .`，不要处理 `tools/market-data-lab/`。
3. 不要要求或写入 Token、Query ID、账户号或真实资产数据。

## 固定边界

- 不增加下单、撤单、调仓、自动投资、交易 API、TWS/IB Gateway 或私有接口。
- 不把演示/合成数据描述为实时或正式账户数据；真实账户、凭据、原始 Flex、SQLite、日志和机器状态继续留在 ignored runtime-data。
- 市场数据仍保持既有 Provider 许可门禁与 `07:30 Asia/Shanghai` 调度；组合 `10:30` 调度独立。
