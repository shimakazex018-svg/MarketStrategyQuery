# 最新交接

## 当前状态

- 当前分支仍为 `main`；初始基线为 `5df8f65b183181cbad76809d4578d088bf647aae`。用户既有未跟踪的 `tools/market-data-lab/` 保持原样、未暂存、未接入正式服务。
- 已完成只读 IBKR Flex Web Service v3 投资组合模块：官方两步请求客户端、DOM-free XML 适配、Node 内置 SQLite/WAL、版本化 schema、幂等导入、现金流/NAV/P&L/收益率语义、基准复用、scrypt 本机密码、受保护 API、独立 `10:30 Asia/Shanghai` 同步和启动补采。
- 已完成 `#/portfolio-analysis`：金额本地显示开关、掩码账户、`1D/MTD/3M/6M/YTD/1Y/ALL/CUSTOM`、收益率/P&L/NAV SVG 曲线、鼠标/触摸/键盘十字线、收益日历、月度统计、贡献、现金流桥、持仓、交易和同步覆盖状态。
- 真实 Flex 配置尚未提供；生产页在本机密码登录后会显示 `IBKR 尚未连接` 或历史缓存状态。页面不会因打开而触发 IBKR 请求。
- 正式 `48101` 已由现有隐藏 Windows 计划任务恢复为当前代码的单实例；health 为 ready，production 未启用 `PORTFOLIO_REVIEW_FIXTURE`，`48102` 保持可用。
- 合成审查模式为 `PORTFOLIO_REVIEW_FIXTURE=synthetic-review-fixture`，使用内存 SQLite 和 `SIM000001`，不读取本机生产组合缓存。
- `npm.cmd run check` 已包含公开仓库隐私扫描；它阻止跟踪/暂存 runtime-data、SQLite/WAL/SHM、raw Flex、真实 IBKR 账户号和凭据。

## 已验证

- `node --check`：server、组合模块、前端和视觉脚本通过。
- `node --test tests/portfolio-analysis.test.js`：Flex 缺失值、幂等导入、合成夹具、API 401/登录/无交易路由通过。
- `npm.cmd run check`：178/178 测试通过；数据检查、公开仓库隐私扫描和组合模块语法检查通过，Node 测试默认单并发运行。
- 合成 Flex 两步同步：SendRequest/GetStatement 调用 2 次，NAV、现金、资金流和每日绩效正确落库，缺失字段保持 `null`。
- 隔离浏览器：桌面、768×1024、390×844 无横向溢出；金额开关、3M、NAV、键盘 Home 十字线和组合页主要内容通过。
- 当前视觉快照：`previews/current/` 含组合桌面/iPad/iPhone、日历、收益曲线以及既有页面 WebP；manifest 声明 `synthetic-review-fixture`、`containsRealAccountData: false` 和 `repositoryVisibility: public`。

## 下一步

1. 如需真实连接，按 `docs/IBKR_PORTFOLIO_SETUP.md` 在 Client Portal 人工创建 Activity Flex Query，运行本机密码初始化并把配置放入 ignored runtime-data；先手动执行一次 `npm.cmd run portfolio:sync`。
2. 真实连接验收必须使用独立端口和只读检查，确认账户号只在本机数据库、API 仅返回掩码、同步失败保留历史；不要把真实缓存用于公开截图。
3. 如需提交或推送，先检查 `git diff --check`、`git status --short`、隐私扫描和完整 `npm.cmd run check`；不要使用 `git add .`，不要处理 `tools/market-data-lab/`。

## 固定边界

- 不增加下单、撤单、调仓、自动投资、交易 API、TWS/IB Gateway 或私有接口。
- 不把演示/合成数据描述为实时或正式账户数据；真实账户、凭据、原始 Flex、SQLite、日志和机器状态继续留在 ignored runtime-data。
- 市场数据仍保持既有 Provider 许可门禁与 `07:30 Asia/Shanghai` 调度；组合 `10:30` 调度独立。
