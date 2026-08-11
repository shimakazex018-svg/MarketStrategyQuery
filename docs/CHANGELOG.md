# 变更日志

## 2026-08-11 - Dismiss portfolio calendar Tooltip on pointer leave

- Desktop daily-return Tooltip now records pointer versus keyboard input, hides immediately on cell/calendar leave or window blur, and cancels pending pointer-position frames. Touch pinned Popover and keyboard cell-anchor behavior remain unchanged; no portfolio data, API, Flex, SQLite, or return calculations changed.

## 2026-08-10 - Indicator monitor reference semantics

- Split external catalog entries into `link_only` (stable audited HTTPS source page) and `external_reference_only` (no stable public page). The latter remains non-fetching, non-caching, and valueless; the former exposes only a read-only source link.
- Updated `/api/market-data/signals` to summarize eligible existing PE, index, VIX/VXN, NAAIM, and SOXX models while keeping local OHLCV-derived signals separate and unavailable without input. No formulas, thresholds, providers, core cards, stages, positions, or option strategies changed.

## 2026-08-10 - Portfolio calendar pointer-follow tooltip

- Desktop daily-return Tooltip now follows the real pointer with requestAnimationFrame-throttled fixed positioning and viewport collision clamping. Keyboard focus and iPad/iPhone tap remain cell-anchored; portfolio data, API, Flex, SQLite, and return calculations were unchanged.

## 2026-08-10 - Portfolio asset cache bust

- Formal 48101 returned the current app, styles, and portfolio-calendar bytes; public HTML now uses the deployed commit identifier as the asset query version so clients do not reuse the previous feature-query cache. No portfolio logic or server restart was changed.

## 2026-08-10 - Portfolio daily return calendar presentation

- Improved the daily return calendar with signed base-currency amounts, width-aware full/compact K/M presentation, and one shared date/P&L/return/quality Tooltip/Popover.
- Added synthetic formatter and browser interaction coverage for desktop hover, keyboard focus/Escape, iPad/iPhone tap switching, outside close, route/scroll stability, no extra API requests, and no horizontal overflow. Flex, portfolio calculations, SQLite, and sync paths were unchanged.

## 2026-08-10 - Offline portfolio performance calibration

- Added the offline `portfolio:replay` path. It backs up ignored SQLite, reparses the latest ignored Flex XML, replaces only the `ibkr-flex` source rows, and performs no Flex request.
- Split CashTransactions into external deposits/withdrawals, displayable internal transfers, and income events for dividends, interest, withholding tax, fees, and other internal activity. Date-only performance now uses `daily_flow_adjusted_return`; reconciliation status is separate from computed/reconciled/warning/incomplete quality.
- Added raw source-field retention inside ignored SQLite, local-history benchmark intersection import, schema version 4, and synthetic regression coverage. No real response data or runtime files are public fixtures.

## 2026-08-10 - IBKR Flex real-response calibration

- Added safe Flex request/parse/validation/import diagnostics, dynamic Node User-Agent coverage, official v3 request-shape checks, controlled redirect validation, and schema version 3 persistence for stage and IBKR error code.
- Mapped the official `EquitySummaryInBase` core fields and corrected XML responses containing commas so a valid XML response cannot be misclassified as CSV. Top-level report dates now use the latest parsed record date.
- Added a same-day scheduler retry guard and a synthetic parser regression; real Flex response material, account data, and SQLite remain ignored runtime data and are not fixtures or public examples.

## 2026-08-10 - Indicator catalog and local OHLCV signal layer

- Added the version-controlled `config/indicator-catalog.json` as the long-term registry for implemented, manual, reserved, and external link-only indicators. It records aliases, category, acquisition mode, source, frequency, formula version, compliance status, history capability, UI group, and limitations.
- Added provisional owner-defined rules in `config/market-signal-rules.json`; no RSI, volume, MACD, or Follow-Through Day threshold is treated as a permanent market-stage or position-sizing rule.
- Added local CSV normalization for full OHLCV inputs (`QQQ`, `SOXX`, `SOXL`, `TQQQ`, and `SPY`) with adjusted-close basis, provenance, as-of dates, duplicate/order/bounds/volume checks, and explicit gap warnings. Runtime input and normalized output remain ignored.
- Added versioned EMA, Wilder RSI, MACD histogram diagnostics, relative volume, 25-trading-day return, drawdown, SOXX/QQQ relative strength, Follow-Through Day evidence, and top-risk/bottom-candidate signals. Existing MA200, momentum, 52-week, RV20, CFTC, and risk-appetite implementations remain cataloged and reused.
- Added internal `/api/market-data/catalog` and `/api/market-data/signals` endpoints plus a grouped homepage Market Signal Monitor. External and unavailable indicators are not filled with zero or demo values, and no new network provider is enabled.
- Added synthetic unit and coordinator/API fixtures; no real market files, credentials, or runtime data were added.

## 2026-08-10 - 修复未认证资产分析交互循环

- 将资产分析前端认证流程明确为 `unknown`、`checking`、`unauthenticated`、`authenticating`、`authenticated` 和 `error` 状态；未认证 401 后停止自动重试，不再重复替换登录面板。
- 增加请求代次保护，避免登出、路由离开或中止请求的旧异步结果再次触发渲染。
- 增加独立 synthetic Playwright REAL INTERACTION SMOKE：覆盖真实鼠标、键盘、触摸、错误/正确合成密码、登出、刷新和30秒未认证稳定性；不使用正式端口，不访问真实 IBKR。
- 本轮修复进入最终公开提交；没有配置真实 Flex Token、Query ID 或账户数据。

## 2026-08-10 - PUBLIC 安全提交与正式服务恢复

- 加强公开仓库隐私扫描，覆盖 JSON 引号字段形式的 Flex Token/Query ID，并补充 SQLite、raw Flex、secret、session 与组合运行目录的显式忽略规则。
- 完成 synthetic-only 组合代码的提交前全量审计、production 48101 隐藏单实例恢复和未认证 API smoke 验证；真实 Flex 未配置、未请求。

## 2026-08-09 - IBKR Flex 只读投资组合分析

- 新增只读 `#/portfolio-analysis` 和受保护 `/api/portfolio/*`：账户摘要、区间绩效、收益日历、月度统计、标的贡献、现金流桥、持仓、交易和同步覆盖状态。
- 新增官方 IBKR Flex Web Service v3 两步客户端、有限轮询、超时/大小限制、错误分类、DOM-free XML 字段适配和缺失字段保持 `null` 的导入语义。
- 新增本机 SQLite/WAL、版本化 schema、foreign keys、busy timeout、quick_check、原子备份、幂等导入、每日绩效、Modified Dietz fallback、基准复用和独立 `10:30 Asia/Shanghai` 同步。
- 新增 scrypt 本机密码、HttpOnly SameSite Strict 会话、无交易路由、同步状态和启动补采；页面不会因打开而请求 IBKR。
- 新增确定性 `synthetic-review-fixture` 内存 SQLite、公开仓库隐私扫描器，并将扫描器接入 `npm.cmd run check`；真实账户、凭据、SQLite、raw Flex 和运行数据不进入仓库。
- 新增组合桌面/iPad/iPhone、日历和收益曲线视觉快照；manifest 标记 `portfolioDataMode: synthetic-review-fixture`、`containsRealAccountData: false`、`repositoryVisibility: public`。
- 图表页新增本地区间基准对比摘要（Nasdaq-100、S&P 500、SOXX），并将完整检查固定为单并发以避免 Windows 文件锁测试的并行挂起。
- 修复数值归一化把 `null` 转成 0 的问题，并新增 Flex、SQLite、认证 API、性能和合成夹具测试。
- 真实 Flex Query、Token 和账户数据未配置、未写入 Git、未用于公开截图；后续按 `docs/IBKR_PORTFOLIO_SETUP.md` 在本机配置。

## 2026-07-29 - Dashboard indicator dialogs

- Removed the standalone six-indicator navigation entry and legacy `#/indicators` rendering. Legacy hashes now use `history.replaceState` to return to the homepage without creating a dead history entry.
- Moved each explanation to an accessible top-level Dialog opened from its dashboard-card information button. The Dialog reads already-loaded internal state only, preserves scroll position, traps focus, supports Escape/backdrop/close-button dismissal, and uses a reduced-motion fallback.
- Added shared-element geometry animation from the selected information button to the Dialog and back, plus desktop, iPad, and iPhone visual-review targets.

## 2026-07-29 - NAAIM Exposure Index local integration

- Added local-only NAAIM weekly provider, API metadata, homepage institutional-exposure card, detail route, settings-source visibility, and 07:30 local reload with zero external requests.
- Canonical history excludes conflicting source dates under `exclude_conflicting_dates`; raw workbook, conflict audit, import state, and normalized real history remain ignored runtime data.

## 2026-07-29 - NAAIM local workbook import checkpoint A

- Added an offline-only NAAIM `.xlsx` importer with bounded ZIP parsing, explicit header discovery, local-path confinement, macro/external-link rejection, normalization, duplicate/conflict checks, range checks, and atomic writes to ignored runtime data.
- Added synthetic workbook tests and an npm command for an owner-supplied local workbook.
- No official workbook was present, so no real history was inspected or imported and no UI, Provider, API, scheduler, audit record, or visual snapshot was added.
- NAAIM/MacroMicro were not collected automatically. NAAIM's announced 2026-08-01 subscription transition remains a documented access limitation.

## 2026-07-26 - Windows 无感启动

- 新增`MarketCycleStrategy-Autostart`登录触发任务的注册、注销、启动、停止、重启、状态与隐藏宿主脚本；不使用`.cmd`、`npm.cmd`或周期性启动任务。
- 复用写真图集的隐藏 PowerShell 宿主模式：Node进程隐藏运行且宿主等待其退出，任务忽略并发实例并在失败后有限重试。
- 增加端口、PID元数据、Node路径和命令行交叉验证；拒绝停止未知进程，运行日志和PID只写入Git忽略的`runtime-data/`并执行有界轮转。

## 2026-07-26 - 回撤分析图表同步日期游标

- 为每日回撤图和归一化走势图增加共享日期游标：只吸附完整历史中的真实有效交易日，不插值、不重新请求API、不重新计算回撤序列。
- 新增独立纯交互工具，使用二分查找处理非等间隔日期、边界、空值和SVG viewBox/CSS缩放；两张图同步更新虚线、点标记和动态提示。
- 增加鼠标、触控笔、触摸和键盘交互；触摸仅在明确横向跟踪后阻止默认行为，离开、取消、失焦、路由切换和重新渲染都会清理监听器与待执行动画帧。
- 保留最大回撤标记、既有布局、数据接口和计算结果；新增合成测试覆盖日期吸附、缩放和页面交互契约。

## 2026-07-22 - SOXX ETF回撤分析

- 完成iShares官方产品页、公开数据下载、BlackRock使用条款、Nasdaq候选页和官方3-for-1拆分公告审计；采用日频NAV，标记为提供方已调整，不做二次拆分处理。
- 新增有界SOXX SpreadsheetML/CSV离线导入器、本地只读ETF Provider、隐藏分析指标、完整history API元数据和07:30本地重载；不建立iShares/BlackRock网络调度。
- 回撤页加入可选SOXX主/对比对象，明确NAV/市场价/复权市场价口径及SOXX不等于SOX；首页六项指标和既有数据流保持不变。
- 新增准确标的、字段口径、拆分、质量校验、幂等原子写入、失败隔离、API与UI契约测试；全部夹具为合成数据，真实数据继续留在Git忽略的runtime-data。

## 2026-07-22 - 独立回撤分析页

- 新增`#/drawdown-analysis`顶级路由与桌面/移动导航入口，沿用现有Hero、主题、卡片、按钮和响应式设计系统。
- 新增可测试的纯回撤计算模块，覆盖规范化、完整序列回撤、非重叠事件、峰谷与恢复日、交易日持续时间、深度分布、年度收益和共同日期归一化。
- 对现有history API最小增加`range=ALL`完整历史读取；首页六卡和指标详情仍保持七范围、240点图表上限及原数据逻辑。
- 页面为两条指数分别只读取一次完整历史，范围切换使用缓存计算；原生SVG显示层有界抽样并保留关键点。
- 增加控制区、六项摘要、双层图表、大回撤事件表/移动卡片、固定深度分布、年度收益、loading/错误/不足/对比不足状态及本地API重试。
- 新增19项专项测试并完成133项全量回归；本地真实历史只用于运行和Git工作树外视觉验收，没有加入源码、测试、文档或提交。

## 2026-07-18 - v0.5六项成功市场数据正式集成

- 正式指标范围固定为Nasdaq-100 PE、S&P 500 PE、VIX、VXN、Nasdaq-100指数和S&P 500指数；首页、正常导航和每日调度不再包含Forward PE、ETF价格、机构仓位或旧自计算指标。
- 增加零网络、幂等、原子写入的一次性导入器，将六项已成功规范化数据复制到被Git忽略的正式运行目录；隔离实验和原成功文件保持不变。
- 将FRED与WorldPEratio接入现有市场数据服务，提供统一摘要、详情、历史和Provider状态API；PE统计与本站快照分离，缺失观察不转为0。
- 每天Asia/Shanghai 07:30执行受控检查；当日成功不重复请求，只有超时或5xx允许一次重试，失败保留最后成功数据并只标记受影响指标为stale。
- 首页保留现有三列设计显示六张正式卡，详情页支持七个范围、真实曲线、当前点、高低点、日期/数值轴及鼠标和触控提示；PE不足2个快照时不绘制折线。
- 新增全合成自动测试和独立端口smoke检查；真实运行数据、视觉验收截图、原始响应、哈希与机器信息均不进入Git。

## 2026-07-18 - 核心市场数据隔离采集实验

- 将最新缺失项入口收窄为Invesco Forward PE、Twelve Data价格和CFTC TFF Futures Only；删除该入口中的WorldPEratio与Stooq开关，冻结清单扩展为包含S&P 500 PE在内的8个实际成功文件。
- Invesco改用指定官方产品详情URL、同域重定向和一次受限重试策略；主页面出现访问挑战后硬停止。Twelve Data只从环境变量读取Key，本机缺Key时保持零请求且不记录凭据。
- CFTC改用11个明确白名单官方ZIP并在解析前验证报告类型、三类持仓字段、ZIP边界和E-mini合约身份；首包内容验证失败后停止，未推断或请求替代文件。
- 本轮开始和结束的8文件大小、修改时间及SHA-256一致；没有请求任何冻结来源，也没有访问Yahoo、Stooq、EODHD、FRED或WorldPEratio。
- 在已验收结果上增加严格的缺失项入口；无参数只显示帮助且零网络请求，分项开关不会导入或重跑FRED、Yahoo或已成功Nasdaq-100 PE采集器。
- 缺失项运行取得S&P 500 PE单日快照；Invesco公开页超时后停止，Stooq因robots禁止CSV路径而在价格请求前停止，CFTC误匹配的非TFF归档被隔离并标记为错误报告类型。
- 增加六个冻结成功文件的运行前后大小、修改时间和SHA-256比对；本轮结束时全部一致。真实数值、日期与完整哈希仅保存在被Git忽略的本地报告。
- 增加流量预算、显式Forward字段识别、Stooq CSV质量、CFTC ZIP路径穿越/解压上限/字段别名/合约排除以及冻结完整性的合成测试。
- 暂停网站页面、正式Provider和调度开发；新增`tools/market-data-lab/core-data-acquisition/`一次性隔离采集工具，不进入`npm start`或48101服务。
- 使用FRED公开CSV、`yahoo-finance2`、WorldPEratio指定公开页和CFTC TFF候选接口验证九类数据；真实响应、标准化结果、快照、报告、状态和日志只写入被Git忽略的运行目录。
- 首次受控运行按来源请求预算串行执行；FRED四序列和Nasdaq-100 PE取得可用结果，Yahoo地区访问限制、CFTC 403与WorldPEratio S&P页面响应上限均按硬边界停止，不重试、不绕过、不伪造缺失数据。
- 生成恰好九项的本地JSON/Markdown可用性报告，并补充四家商业API的Forward PE只读可行性结论；未注册、购买或写入API凭据。
- 增加合成测试覆盖FRED缺失值、日期修订、Yahoo字段路径、WorldPEratio无历史伪造、CFTC合约发现/派生比例和错误响应脱敏。
- 未修改`public/`、正式market-data service、现有Provider、调度、48101服务、main或标签；未提交或推送。

## 2026-07-16 - v0.5第二检查点：WorldPEratio受控采集与外部PE详情

- 记录项目所有者有限剩余风险接受决定；明确`approved_with_conditions`不代表WorldPEratio书面授权。
- 每次采集先检查robots；每日最多一次目标请求，仅超时或5xx有限重试，访问控制或结构变化立即停止。
- 增加1/5/10/20年统计、公开完整序列能力判定、标准化latest、原子去重快照、损坏隔离和last-good恢复。
- 增加history/statistics API并从全部公开API移除内容哈希、本地路径和原始片段。
- PE详情页分为外部参考PE和本站自计算PE；仅汇总统计时显示估值区间条，真实快照不足2点不绘制折线。首页六卡布局不变。
- 真实缓存只保存在被Git忽略的运行目录；文档、测试和UI评审只使用合成数据，不记录真实数值、日期、哈希或页面片段。

## 2026-07-16 - v0.5本地提交隐私清理

- 从稳定基线重新构造6个尚未推送的v0.5提交，保留来源审计、合规门禁、HTML解析、robots、预算/重试、熔断、缓存回退、诊断API和PE历史统计能力。
- 将测试页面数值、日期和哈希来源全部替换为明确标注的合成fixture；删除本机绝对路径、固定私人网络地址和真实运行细节。
- 扩充运行数据、环境文件、日志、缓存、浏览器配置、Cookie、会话、凭据和真实导入数据的忽略规则；配置模板不含真实凭据。
- 本次不访问第三方网页、不生成真实缓存、不修改main或标签、不推送或改写远程历史。

## 2026-07-15 - v0.5第一检查点：WorldPEratio公开页审计与低频原型

- 审计 WorldPEratio 根站、robots、sitemap、Privacy、About、目标 Nasdaq-100 页面、公开 WordPress JSON 和服务器 HTML；确认目标页以 QQQ ETF 作为 Nasdaq-100 参考对象并直接返回当前 PE、日期和历史统计。
- 未发现 Terms/Terms of Use 或明确自动读取、缓存和本人内部展示授权，Provider 登记为 `pending_written_confirmation`、`candidate`、`enabled=false`；不加入调度、不保存本次真实值、不改正式首页。
- 新增固定主机/固定 User-Agent 的原生 HTTP fetcher、robots 解析、字段提取/冲突验证、连接/总超时、响应大小限制、每日一次加一次延迟重试、原子提取 JSON 和 stale 回退。
- 新增 WorldPEratio status/latest 只读诊断 API；GET 不触发第三方请求。浏览器 fetcher 明确保持禁用，因为普通 HTTP 已足够。
- 新增 `PE-HISTORY-TRIM10-v1` 和 A/B/C 三种极值候选比较；不复刻 WorldPEratio 未公开公式，不改 QQQ 横截面 WMAD4。
- 新增合成测试覆盖 robots、HTML/JS、目标/值/日期/歧义、403/429/登录/验证码、DOM/哈希、每日预算、重试、缓存隔离、HTML不落盘和Trim 10%。
- 使用项目认可的 Node.js 运行时完成完整 check：95项测试通过、0失败；独立测试端口确认六指标不变，WorldPEratio为禁用、零请求、无真实值。

## 2026-07-15 - v0.4.0发布

- 将v0.4自计算市场数据分支以普通`--no-ff`合并进入main，保留完整提交历史。
- 发布范围固定为：自计算市场指标MVP、真实数据输入基础设施、原始和稳健QQQ PE计算、SEC/CFTC接入框架、本地CSV导入及完整数据质量状态。
- 本版本不代表全部真实市场数据已上线，不是官方QQQ PE、官方VIX/VXN或实时市场数据正式版，也不表示所有来源均已自动化。
- 用户尚未提供真实QQQ持仓/权重、复权价格和Forward PE输入；无输入时六张卡继续独立显示`unavailable`，不以0或演示值补齐。
- 发布后只创建`feature/v0.5-public-web-data-providers`分支；未开始WorldPEratio或其他公开网页数据源开发。

## 2026-07-15 - v0.4自计算市场指标检查点B

- 正式首页六卡切换为QQQ组合TTM PE双口径、Forward PE、QQQ RV20、QQQ波动率分位、自建风险偏好和纳指期货机构仓位。
- 接入本地CSV、SEC companyfacts bulk、CFTC TFF运行协调器；启动优先读缓存，浏览器访问不触发外部请求。
- SEC要求显式开关、应用名和有效联系邮箱，每天最多一次；CFTC选择`209742`并在Asia/Shanghai周六检查，`209747`仅作诊断。
- 新增`provisional`、`insufficient_coverage`、`manual`和独立`quality_warning`显示；覆盖不足不使用0或演示值。
- 新增`#/indicators/pe`详情页，展示双口径、覆盖、日期、亏损与极值诊断，不把内部市值聚合或排除亏损算法描述为正式PE。
- 自动检查69项通过；正式服务在独立端口健康检查200并可无输入离线启动。应用内浏览器完成四档响应式、主题、核心路由、弹窗键盘和控制台验收，并补齐明确标注为非真实行情的UI状态截图。
- 修复PE覆盖不足时`null`副值被格式化为`0x`的问题；缺失值统一保持为占位符，不伪造零值。

## 2026-07-15 - 检查点A.1原始与稳健QQQ PE

### Added
- 新增`PE-Q1-RAW-v1`：在组合加权盈利收益率中保留正盈利和负盈利，非正或不稳定分母不输出正PE。
- 新增`PE-Q1-ROBUST-WMAD4-v1`：在E/P层按weighted median ± 4个稳健尺度Winsorize，不删除成分、不改变权重。
- 新增稳健方法回退、覆盖率、正式成分数、极值权重、亏损公司和受影响成分诊断；排除亏损版只保留为内部字段。
- 新增30成分纯虚构fixture，覆盖正/负/大权重/多个极值、普通亏损、MAD为0、小样本、近零/负分母、顺序、未标准化权重、非有限输入和拆股错误。
- 明确旧方法B使用覆盖公司的完整市场总市值/完整净利润，未按QQQ权重构造统一名义组合，因此只保留为诊断算法；正式原始PE以方法A为准。
- 补充价格/财务/权重日期血缘、原始与稳健分母稳定性、`robustScale`、两口径差值和EPS/净利润一致性诊断。
- 新增QQQ PE输入可用性调查：SEC与CFTC存在官方机器来源，QQQ持仓/权重和复权价格当前仍需用户本地CSV。

### Validation
- `npm.cmd run check`通过53项测试、0失败；QQQ PE专项18项通过。未修改正式首页、读取真实市场数据、进入全量计算或检查点B。

## 2026-07-15 - v0.4自计算市场指标检查点A

### Changed
- 当前阶段不继续IBKR、Twelve Data或Alpha Vantage；保留历史评估与合规硬门禁，全部保持禁用。
- 定义检查点B目标六项为自计算QQQ组合TTM PE、Forward PE人工录入、QQQ RV20、RV20历史分位、自建风险偏好和Nasdaq期货机构仓位代理。
- 统一状态扩展`insufficient_coverage`与`manual`；正式首页仍保持v0.3六卡，未改前端。

### Added
- 新增有界CSV解析、QQQ成分权重/价格/人工Forward PE导入和仅含虚构数据的模板。
- 新增SEC GAAP/IFRS字段映射、修订去重、四季度TTM和显式拆股调整内核。
- 新增QQQ PE加权盈利收益率与覆盖样本总市值/总盈利两种候选算法，均比较亏损处理版本。
- 新增RV10/20/60、RV20历史分位、`RISK-APPETITE-v1-EW`、CFTC TFF候选仓位和逐指标故障隔离。

### Validation
- `npm.cmd run check`通过42项测试、0失败；固定9阶段、8期权、6个现有指标和7范围不变。
- 测试覆盖CSV错误、SEC修订/重叠/GAAP/IFRS/拆股、覆盖不足、币种、亏损、近零/负PE、波动率样本、Forward PE过期、COT缺失和单项故障隔离。
- 所有fixture均为虚构数据；未下载SEC bulk、未请求CFTC/IBKR/Twelve Data/Alpha Vantage，也未修改正式页面或截图。

## 2026-07-15 - v0.4第一检查点：个人用途与Provider合规门禁

### Added
- 固化仅限本人、本机/家庭局域网/私人ZeroTier、非盈利且不再分发的市场数据使用边界。
- 新增非敏感Provider注册表、状态校验模块和环境变量之前的正式启用硬门禁。
- 新增IBKR非敏感本机预检查、官方资料评估和未发送的英文客服询问模板。

### Validation
- 仓库可见性由项目所有者在托管端管理；源码、文档和运行数据始终按最小披露原则维护。
- 本机未发现TWS、IB Gateway、Client Portal Gateway或典型API监听端口；未安装、未登录、未请求行情。
- `npm.cmd run check`通过22项测试、0失败；固定9阶段、8期权、6指标和7范围不变。

### Notes
- Cboe与IBKR均为`pending_written_confirmation`、`enabled=false`；VIX/VXN继续unavailable。
- 因需要安装官方组件、用户人工登录、订阅确认和书面许可，本检查点停止；未进入Twelve Data。
- 没有UI变化，未修改v0.3截图或评审清单。

## 2026-07-14 - 建立 Codex 长期上下文管理体系

### Changed
- 规范八份长期文档的职责边界、读取顺序和任务结束更新规则。
- 将项目上下文、架构、测试方法和交接状态更新到当前 v0.3 开发分支事实。
- 将长期技术选择整理为带编号、原因、影响和状态的决策记录。
- 将待办整理为 High、Medium、Low、Done、Deferred 和 Cancelled 状态。

### Added
- 在 `AGENTS.md` 中增加修改前后检查、Git、运行数据保护和文档维护规则。
- 记录当前实际运行目录与未来通用缓存、媒体和 SQLite 忽略规则的待确认风险。

### Files
- `AGENTS.md`
- `docs/PROJECT_CONTEXT.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/TODO.md`
- `docs/TESTING.md`
- `docs/CHANGELOG.md`
- `docs/HANDOFF.md`

### Validation
- 检查八份文档齐全、边界与互相引用。
- 执行 `git diff --check`、`git status` 和现有 `npm.cmd run check`。

### Notes
- 本次只修改文档；没有修改业务代码、配置、脚本、接口或运行数据。
- 当前不存在数据库、缩略图或 HLS；未修改 `.gitignore`。

## v0.3 在线市场数据接入候选 — 2026-07-14

- 完成 VIX、VXN、QQQ组合TTM PE、Forward PE、恐慌贪婪指数和基金经理仓位候选来源审计；没有来源通过全部接入门槛，未伪造正式实时接入。
- 新增原生 Node 市场数据服务、原子缓存、有界日志、请求预算、重试调度、手动刷新冷却和内部 API；默认不请求第三方。
- 指标卡支持 loading、fresh、stale、error、demo、unavailable，显示数据日期、来源、更新时间、状态和实际可用时间范围；无数据不再使用 0。
- 历史曲线由内部 API 数据驱动并限制为最多 240 点；单指标失败不影响其他指标和静态策略页面。
- 增加 17 项自动测试及只读 UI 状态验收夹具；夹具明确标注为非真实行情。
- 未增加框架、第三方依赖、数据库、自动阶段判断、IBKR、登录或交易功能。

## v0.2 信息架构与核心页面可读性 — 2026-07-14

- 阶段详情按概览、仓位、执行动作、资产逻辑、识别条件、期权和风险重排；相邻阶段区别不再显示。
- 四种执行状态与四类资产规则改为单面板标签切换，仓位区间、初始动作和关键风险保持醒目。
- 新增可选 `recognitionVisual` 契约；无图片时不渲染占位，识别条件精简显示最多六条。
- 期权工具改为目录加单策略详情，新增 `#/options/:id` 可恢复路由和分类筛选。
- 新增 `cycle-shape.json`，以手工归一化静态点位驱动更突出的九阶段波形；未使用真实QQQ数据。
- 六张指标卡新增 JSON 驱动的无障碍信息弹窗，明确数值为静态演示且不可单独判断阶段。
- 修复 375px 阶段详情标签组造成的页面级横向溢出，并补充周期图和指标说明数据校验。
- 未修改九阶段顺序、仓位数字、期权推荐等级、公式、DTE、行权价、六指标、七周期、服务器、端口或访问方式。

## 第二阶段：静态策略内容结构 — 2026-07-13

- 为九个市场阶段补齐状态定义、相邻阶段区别、策略属性和完整风险边界。
- 为四类资产逐阶段补齐增配、减配、禁止条件和主要风险。
- 将固定八种期权策略在每个阶段完整分为推荐、可选、谨慎和不建议。
- 为阶段补齐初始、恶化、维持、改善动作，以及切换条件、收益亏损来源、最大不利情景、失效条件和机会成本。
- 为八类期权工具补齐分类、买卖腿、标的、适用与不适用阶段、DTE、行权价、三种行情表现、Theta、IV、退出、到期、机会成本、变量和静态公式示例。
- 重构阶段详情和期权工具页的信息层级，保持关键动作、最大亏损和主要风险直接可见。
- 加强数据契约检查、缺失字段回退、长内容响应式布局和折叠键盘状态。
- 未接入真实行情、期权链、自动判断、持仓、数据库、登录或交易功能。

## 0.1.0 接管基线 — 2026-07-13

- 核实原生技术栈、九阶段、八期权、六指标、七周期和主要 Hash 路由。
- 修复缺失静态资源错误返回首页 200 的问题，改为明确 404。
- 强化公开目录路径边界和非法 URL 解码处理。
- 为移动菜单补充展开状态、控制关系和 Escape 关闭行为。
- 为指标周期按钮补充按压状态并扩大触摸区域。
- 新增无依赖的数据契约检查，并纳入 `npm run check`。
- 补齐项目上下文、架构、决策、待办、测试和交接文档。

本基线不新增真实行情、自动判断、IBKR、数据库、登录或交易功能。
# 数据源与采集状态设置页 — 2026-07-29

- 新增持续视觉快照流程：本机Chrome开发工具、固定三视口WebP、contact sheet、隐私门禁、大小上限和`previews/current/manifest.md`。
- 设置页摘要新增正常、延迟和失败数据集计数；Provider和数据集的主要来源/更新代码显示中文标签。
- 设置状态 API 的凭据使用布尔字段改为中性名称，避免接口文本出现Cookie或Token字样；页面仍显示同一只读状态。
- 新增 `#/settings` 只读设置页和顶部可访问设置入口；页面通过本站内部状态 API 展示正式 Provider、7 个数据集、日频调度、无实时行情说明、最近审计记录和运行数据隐私状态。
- 新增 `GET /api/settings/data-acquisition`，聚合现有正式 Provider、运行缓存和 scheduler 状态；读取该接口不会刷新 Provider、消耗请求预算或触发第三方网络请求。
- 新增有界 `runtime-data/system/data-acquisition-audit.json` 审计记录：原子写入、损坏隔离、最多200条/90天，只记录脱敏采集元数据。
- 保持 FRED、WorldPEratio、SOXX 本地导入、Asia/Shanghai 07:30 调度、48101 和 Windows 无感启动不变。
