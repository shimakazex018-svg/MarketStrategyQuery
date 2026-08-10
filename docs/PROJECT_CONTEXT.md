# 项目当前上下文


## Portfolio real-response calibration boundary (2026-08-10)

- The local ignored runtime may contain a user-configured, read-only IBKR Flex response and SQLite cache. This does not mean credentials, account identifiers, amounts, holdings, raw XML, or audit results are present in Git.
- The approved recalibration path is offline `npm.cmd run portfolio:replay`: it backs up ignored SQLite, reparses ignored raw XML, separates external capital flow from internal activity, recalculates `daily_flow_adjusted_return`, and aligns only existing local benchmark histories.
- This boundary does not enable trading, add a market-data Provider, change the Flex secret or Query, or expand the portfolio UI. Public fixtures remain synthetic-only.

## 项目名称与用途

- 名称：Market Cycle Strategy。
- 当前开发版本：`0.5.0-dev`（来自 `package.json`）；稳定标签仍为 `v0.4.0`。
- 用途：个人市场周期、独立仓位区间、期权策略和辅助指标查询网站。
- 产品性质：信息整理与场景推演工具，不是个性化投资建议，不保证收益或本金。

## 当前运行方式

- 环境要求：Node.js 22.5 或更高版本；投资组合 SQLite 使用内置 `node:sqlite`。
- 启动命令：`npm.cmd start` 或 `npm.cmd run start`。
- Windows 脚本：`powershell -ExecutionPolicy Bypass -File .\scripts\start-market-site.ps1`。
- Windows无感常驻：`MarketCycleStrategy-Autostart`在当前用户登录后延迟启动隐藏PowerShell宿主；日常状态、启动、停止和重启入口位于`scripts/windows/`。
- 默认监听：`0.0.0.0:48101`；可由 `HOST`、`PORT` 环境变量覆盖。
- 本机默认地址：`http://127.0.0.1:48101`。
- 局域网/ZeroTier：使用服务器对应网卡 IP 加端口 48101；实际跨设备连通性待确认。
- 没有构建步骤、前端打包器或第三方运行依赖。

## 当前主要功能

- 九种固定市场阶段的周期图、详情页和对比页。
- 独立回撤分析页：使用Nasdaq-100、S&P 500日频指数历史及可选SOXX ETF日频NAV，提供区间收益、当前/最大回撤、非重叠回撤事件、深度分布、年度收益和共同起点归一化对比；两张SVG图共享只吸附真实交易日的日期游标。
- QQQ、SOXX、SOXL、现金/SGOV 的独立允许仓位区间与资产规则。
- 八种固定期权策略的单策略详情、损益公式、管理规则与风险边界。
- 六张正式指标卡：Nasdaq-100 PE、S&P 500 PE、VIX、VXN、Nasdaq-100指数和S&P 500指数；支持七个时间范围、状态元数据和真实历史/快照结构。
- 首页指标状态支持 `loading`、`fresh`、`stale`、`error`、`demo`、`unavailable`、`provisional`、`insufficient_coverage` 和 `manual`，并可独立显示 `quality_warning`。
- 深浅主题、Hash Router、键盘/触摸交互和响应式布局。
- `#/settings` 只读展示当前正式数据源、采集状态、计划任务和有限审计记录；它只请求本站内部状态 API，不触发第三方采集。
- `#/portfolio-analysis` 是受本机密码保护的只读投资组合分析页；只读取本地 IBKR Flex v3 导入结果，不提供下单、撤单、调仓、自动投资或交易接口。
- 投资组合运行数据固定在 `runtime-data/portfolio-analysis/`，包括 SQLite、WAL/SHM、原始 Flex、导入、备份、审计、状态、日志和本机密码目录；整棵目录被 Git 忽略。
- `npm.cmd run portfolio:auth:init` 初始化本机 scrypt 密码；`npm.cmd run portfolio:sync` 执行一次受控 Flex 同步。默认同步时间为 `10:30 Asia/Shanghai`，独立于市场数据 `07:30` 调度。
- 公开仓库审查只使用 `synthetic-review-fixture`，账户标签为掩码 `SIM****0001`；真实账户、凭据、SQLite 和原始报告不得进入 Git。`PORTFOLIO_REVIEW_FIXTURE=synthetic-review-fixture` 仅供隔离视觉审查。
- NAAIM Exposure Index is an optional weekly local-import observation module; it does not change the six homepage metric cards or the daily external collection schedule.
- Node.js 静态服务、健康检查和内部市场数据 API。
- 回撤分析只通过内部history API一次读取所选完整历史；SOXX无有效本地文件时不显示选项。日期游标只更新SVG覆盖层和Tooltip，使用缓存完整序列二分查找，不改变回撤结果。现有首页和指标详情仍使用有界范围与最多240点的图表响应。

## 当前稳定状态

- 稳定版本：`main` 上的 `v0.4.0`；v0.4功能合并提交为 `a0eb46ea612dbe37254acf886b4d6a56c1cf1c66`。
- 当前开发分支：`main`；日常小步开发默认直接在main进行。六项正式首页数据已接入统一服务、内部API、首页与详情页，并建立每日07:30受控更新和stale缓存回退。
- v0.4检查点B已把自计算数据层接入正式内部API与首页。`PE-Q1-RAW-v1`和`PE-Q1-ROBUST-WMAD4-v1`在同一张卡及PE详情页展示；排除亏损版和旧完整公司总市值/总盈利方法仍仅作内部诊断。
- 市场数据 Provider 注册表中的 IBKR 仍为`not_tested`、`pending_written_confirmation`、`not_selected_by_owner`、`enabled=false`；投资组合分析使用独立的官方 Flex v3 只读导入层，当前没有本机真实凭据或真实账户数据。
- 当前没有用户本地持仓、价格、Forward PE或SEC运行输入时，六张新卡均可独立显示`unavailable`并保持离线启动；不会回退到旧VIX/VXN或演示数值。
- Cboe和IBKR在Provider注册表中均为 `pending_written_confirmation`、`enabled=false`；旧环境变量不能绕过注册表门禁。Twelve Data和Alpha Vantage为`not_evaluated`、`enabled=false`。
- 正式首页六卡现为Nasdaq-100 PE、S&P 500 PE、VIX、VXN、Nasdaq-100指数和S&P 500指数。旧自计算指标不进入首页或正常导航。
- v0.4的发布边界是自计算市场指标MVP、真实数据输入基础设施、原始和稳健QQQ PE计算、SEC/CFTC接入框架、本地CSV导入及完整数据质量状态；它不是全部真实行情、官方QQQ PE、官方VIX/VXN或实时数据正式版。
- WorldPEratio 当前按项目所有者的有限剩余风险接受边界进入六指标正式服务与每日调度；这不代表来源方书面授权，访问控制或结构异常时必须停止并保留最后成功缓存。
- 九类核心市场数据的首次可用性验证已在独立实验目录完成；实验工具不进入正式服务，真实结果和九项报告只保存在被Git忽略的运行目录。来源受限或字段缺失保持不可用，不回填、不合并成不透明数值。

## 当前数据与生成目录

| 路径 | 性质 | Git 状态 | 说明 |
| --- | --- | --- | --- |
| `config/market-data-providers.json` | 非敏感合规配置 | 跟踪 | Provider状态、用途与启用门禁；不包含凭据或真实数据 |
| `public/data/` | 产品源数据 | 跟踪 | 阶段、期权、指标和周期图 JSON；不是运行缓存 |
| `runtime-data/market-data/latest/` | 运行数据 | 忽略 | 每指标最新缓存；当前可为空 |
| `runtime-data/market-data/state/` | 运行数据 | 忽略 | 请求预算和最近状态 |
| `runtime-data/market-data/logs/` | 运行数据 | 忽略 | 有界抓取日志 |
| `runtime-data/market-data/raw/` | 运行数据 | 忽略 | 可选、受限的诊断原始响应；默认不保存 |
| `previews/` | 产品评审资料 | 跟踪 | 基线和评审截图，不是服务运行目录 |
| `tests/fixtures/market-data/` | 测试源文件 | 跟踪 | 人工最小测试夹具，不是真实行情 |
| `templates/imports/` | 导入模板 | 跟踪 | 只包含明确标注的虚构示例 |
| `runtime-data/imports/` | 用户原始导入 | 忽略 | 成分、价格和人工记录；不得提交 |
| `runtime-data/normalized/` | 标准化运行数据 | 忽略 | 导入manifest和标准化记录 |
| `runtime-data/derived/` | 派生结果 | 忽略 | 算法结果、版本和覆盖率 |
| `runtime-data/market-data/web-pages/worldperatio/` | 运行数据 | 忽略 | 保存标准化latest、请求状态、去重快照历史和last-good备份；不保存HTML，内容不得提交 |
| `runtime-data/market-data/production/` | 正式运行数据 | 忽略 | 保存四项FRED序列、两个PE当前值、PE快照历史、SOXX ETF本地导入序列及每日请求状态；由离线导入或正式Provider原子更新 |
| `runtime-data/portfolio-analysis/` | 投资组合运行数据 | 忽略 | SQLite/WAL/SHM、raw-flex、imports、backups、audit、state、logs和secrets；含本机账户分析数据，禁止提交或用于公开截图 |
| `config/ibkr-flex.example.json` | 合成配置模板 | 跟踪 | 只有占位符，不包含 Token、Query ID 或账户信息 |
| `runtime-data/system/data-acquisition-audit.json` | 运行审计数据 | 忽略 | 只记录采集元数据，原子写入、损坏隔离、最多200条或90天 |
| `runtime-data/process/` | 服务运行状态 | 忽略 | 仅保存48101经端口与进程校验后的PID元数据和最后退出记录 |
| `runtime-data/logs/market-cycle/` | 服务日志 | 忽略 | 48101启动、标准输出和错误日志；单文件10 MiB、最近5个轮转副本 |
| `tools/market-data-lab/core-data-acquisition/` | 隔离实验工具 | 跟踪 | 分来源一次性采集、规范化、冻结校验与本地报告；最新缺失项入口仅包含Invesco、Twelve Data和CFTC，不进入正式启动路径 |
| `runtime-data/market-data-lab/core-data-acquisition/` | 实验运行数据 | 忽略 | raw、normalized、snapshots、reports、state和logs；不得提交 |

投资组合模块现在使用本机 SQLite；数据库、WAL/SHM、原始 Flex、备份和日志均属于被忽略运行数据，路径和容量规则见 `docs/IBKR_PORTFOLIO_SETUP.md`。项目仍不存在媒体上传、视频缩略图、HLS或视频切片功能。

## 当前已知限制

- 六项正式指标已有本地成功缓存；来源仍可能延迟、修订或改变访问条件，失败时只显示最后成功数据并标记stale。
- WorldPEratio 当前按项目所有者风险接受边界低频读取；来源方书面授权仍不存在，完整公式和长期历史可用性仍以每次公开响应验证结果为准。
- 源码按公开仓库安全边界维护；真实凭据、账户号、原始 Flex 报告、SQLite、日志和机器标识必须保持在被忽略的本机运行目录。仓库托管端可见性不由本地代码改变。
- IBKR 投资组合路线已实现只读本机代码与合成审查夹具；真实连接仍等待用户在 Client Portal 人工创建 Activity Flex Query、配置本机凭据并确认许可范围。
- QQQ PE已确定原始与稳健双口径；至少80个有效成分和不超过10%的极值处理权重已由虚构fixture覆盖，仍需用户真实本地输入验证实际覆盖率。风险偏好最终权重仍待用户审定。
- Forward PE、QQQ/SPY价格和机构仓位代理仍不在当前版本范围。SOXX仅作为回撤分析页的ETF NAV对象，不进入首页六卡，也不授权官网自动抓取。
- 不自动判断市场阶段，不提供自动仓位建议。
- 投资组合模块可读取用户明确配置的 IBKR Flex 报告到本机数据库，但不执行交易、不读取交易 API、不提供自动调仓；未配置真实凭据时保持 `IBKR 尚未连接`。
- 当前没有多用户、后台编辑器、回测或历史策略编辑功能；组合页的单用户本机密码和 SQLite 只服务只读分析。
- 真实 iPhone/iPad、目标局域网、ZeroTier 和 Windows 防火墙跨设备验收：待确认。
- 金融策略文案、仓位区间和期权参数仍需用户或合格专业人士最终审定。

## 当前兼容与废弃状态

- `adjacentStages` 仍保留在阶段 JSON 中用于兼容，但当前详情页不渲染。
- `#/options` 继续兼容并回退到首个策略；具体策略使用 `#/options/:id`。
- 旧的“六张卡全部是模拟指标”描述已不再准确；当前必须按每张卡的真实状态说明，验收夹具必须明确标记为非真实行情。
- 没有确认已废弃的服务端 API。若未来废弃接口，必须在本文件和架构文档中明确标注。

## 不得随意修改的内容

- 九阶段名称、顺序和 ID。
- 八种期权策略名称、分类和 ID。
- 当前仓位区间、期权推荐等级、公式、DTE 和行权价逻辑，除非用户明确要求金融内容校准。
- 市场数据七个时间范围、投资组合八个时间范围、Hash Router、默认端口和原生Node.js技术栈保持不变。组合 SQLite 使用 Node 22 内置模块，不增加数据库服务器、框架、自动阶段判断或交易功能。
- 数据源许可门槛与“未获许可不抓取、不缓存、不展示”的默认边界。

## 运行数据保护

- `runtime-data/` 不应提交 Git，也不得为了清理工作树而删除。
- `.env`、密钥、日志、缓存、请求状态和机器相关文件不应提交。
- 当前 `.gitignore` 已覆盖实际使用的 `runtime-data/`、环境文件、日志、缓存、临时文件、浏览器配置、Cookie、会话、凭据、真实市场数据和导入目录。
- 合成模板放在受版本控制的 `config/`、`templates/` 或 `tests/fixtures/` 中；真实数据只能进入已忽略的运行目录。若未来引入数据库、缩略图、HLS或其他生成物，必须先单独评审忽略、备份、容量和清理策略。
