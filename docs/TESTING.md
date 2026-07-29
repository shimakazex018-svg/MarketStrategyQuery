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

核心数据隔离实验使用Node.js 22或更高版本和实验目录自己的依赖；只运行合成测试时：

```powershell
cd tools/market-data-lab/core-data-acquisition
node --test test/*.test.js
```

实验测试不得读取真实`runtime-data/`或发起外部请求。真实`run-once.js`只在明确授权后执行，且不能通过删除state绕过当日请求预算。

缺失项入口无参数时必须只显示帮助并保持零请求；真实分项运行必须使用明确开关：

```powershell
node run-missing-only.js
node run-missing-only.js --nasdaq100-forward-pe
node run-missing-only.js --twelvedata-prices
node run-missing-only.js --cftc-positioning
```

不得在验收或常规测试中执行这些真实分项开关。

缺失项合成测试还必须覆盖：普通P/E不冒充Forward P/E、Twelve Data窗口合并/边界去重/同日冲突/Key脱敏/缺Key零请求、CFTC Futures Only字段门禁、Combined与Disaggregated拒绝、`209742`与`13874A`身份、Micro排除、null不转0、ZIP路径穿越，以及8个冻结文件的哈希保护。

该命令执行：

1. `server.js`、`public/app.js` 和 UI 评审服务语法检查。
2. 产品数据契约检查：9阶段、8期权、6指标、7范围、固定顺序、必填字段和引用。
3. Node 自动测试：缓存、结构校验、来源错误分类、限流、调度、许可边界和故障回退。
4. Provider登记检查：固定状态枚举、必填字段、重复ID、附加条件和`enabled`硬门禁。
5. 自计算指标检查：有界CSV、SEC字段/季度TTM、QQQ原始PE与WMAD4稳健PE、实现波动率、历史分位、风险偏好、CFTC候选合约和人工Forward PE边界。
6. WorldPEratio检查：风险接受与30天条款复查门禁、采集前robots、服务器HTML提取、完整序列/仅汇总判定、目标/日期/数值歧义、403/429/登录/验证码停止、每日1+1请求、快照去重/损坏恢复、HTML不落盘、四个诊断API和Trim 10%统计。
7. v0.5六指标检查：离线导入、FRED缺失值、PE统计/快照分离、日期去重与修订、stale回退、单项故障隔离、每日预算、启动补采、周末去重、API脱敏和正式六卡范围。

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

## Windows 无感启动

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\register-market-autostart.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\status-market.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\start-market-hidden.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\stop-market.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\restart-market.ps1
```

- 任务名固定为`MarketCycleStrategy-Autostart`，触发器仅为当前用户登录后的延迟启动；不得配置分钟级、小时级或07:30 Windows启动任务。
- 任务Action必须是`powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden`的长运行宿主，不得直接调用`.cmd`或`npm.cmd`。同一任务采用`IgnoreNew`，失败后最多重试3次、间隔1分钟。
- 验收应确认重复启动不增加监听进程、停止/重启只影响48101、48102继续可用、15分钟内无周期性cmd/powershell弹窗、PID/日志未被Git跟踪；Windows重启或重新登录仍需人工确认一次。

## Smoke Check

```powershell
Invoke-RestMethod http://127.0.0.1:48101/api/health
Invoke-RestMethod 'http://127.0.0.1:48101/api/market-data/indicators?range=1Y'
Invoke-RestMethod http://127.0.0.1:48101/api/market-data/summary
Invoke-RestMethod http://127.0.0.1:48101/api/market-data/metrics/vix
Invoke-RestMethod 'http://127.0.0.1:48101/api/market-data/metrics/vix/history?range=10Y'
Invoke-RestMethod http://127.0.0.1:48101/api/market-data/status
Invoke-RestMethod http://127.0.0.1:48101/api/market-data/providers/worldperatio/status
Invoke-RestMethod http://127.0.0.1:48101/api/market-data/providers/worldperatio/latest
```

通过标准：

- `/api/health` 返回 HTTP 200、`ok: true`、`marketData: "ready"`，版本与 `package.json` 一致（当前为 `0.5.0-dev`）。
- 指标接口按固定顺序返回六项正式指标；没有本地导入或运行缓存时各项独立显示`unavailable`，不得回退旧自计算指标、0或模拟值。
- 状态接口时区为 Asia/Shanghai，并返回Provider的技术状态、合规状态、登记启用值和实际启用值。
- SEC与CFTC只有在合规登记和运行配置同时满足时才可实际启用；IBKR、Twelve Data、Alpha Vantage和Cboe保持未选择或禁用，环境变量不能绕过登记门禁。
- 没有外部网络、没有 `FRED_API_KEY` 时仍能启动。
- WorldPEratio 四个 GET 诊断接口不得触发第三方请求；登记应返回 `enabled: true`、`complianceStatus: approved_with_conditions` 和风险接受标识。存在本地成功缓存时读取缓存；不存在时返回 unavailable/null。

## v0.5六指标正式集成

- 先执行`node tools/market-data/import-successful-data.js`；命令必须零网络、只读取六项成功规范化文件、原子写入正式运行目录，第二次执行应报告零个数据文件变化。
- 自动测试只使用未来日期、`.invalid`来源和临时目录，不能读取或写入真实`runtime-data/market-data/production/`。
- 四项FRED详情必须能切换1M、3M、6M、1Y、3Y、5Y、10Y；null观察不进入曲线、不补非交易日、不转0。
- 两项PE页面必须显示1/5/10/20年统计区间；0点显示暂无、1点只显示当前值与统计、2点及以上才显示真实快照折线。
- 页面应在桌面、iPad和iPhone视口检查六卡顺序、无横向溢出、曲线压缩、触控提示和旧指标不可见。
- 验收真实运行数据时只报告状态和点数，不把真实值、日期、截图或内容哈希写入Git。

## WorldPEratio第二检查点

- 自动测试只使用明确标注的合成 HTML、robots、历史结构和错误响应，不访问 WorldPEratio。
- 验证条款复查日期缺失或超过30天时返回`terms-review-due`，并在robots和目标页请求前停止；status返回上次检查日、下次复查日和到期标记。
- 验证 robots 允许/禁止/不存在、服务器 HTML 成功、JS-only 页面需浏览器、目标存在/不存在、当前值/日期缺失、多值冲突、异常值、403、429、登录、验证码和 DOM 变化。
- 验证内容哈希只留在运行缓存、每天一次目标请求且仅超时/5xx重试、最后成功缓存 stale 回退、完整 HTML 不长期保存、外部参考缓存不覆盖自计算 PE。
- 验证1/5/10/20年汇总统计、完整公开历史序列与`summary_statistics_only`分支、本站快照去重/排序/损坏隔离/last-good恢复，以及latest/history/statistics API不泄露哈希或本地路径。
- 验证 `PE-HISTORY-TRIM10-v1` Trim 10%、样本不足和输入顺序不变性。
- 浏览器 fetcher 必须保持禁用；不得安装Playwright用于采集或读取用户Chrome Profile。PE详情页视觉验收只使用合成评审夹具。

## HTTP 与安全检查

- `/`、`/styles.css`、`/app.js` 和 `public/data/*.json` 返回 200 与正确 MIME。
- 缺失静态文件返回 404 `text/plain`，不得回退首页。
- 非法 URL 解码和越界路径不得读取 `public/` 外文件。
- 浏览器只请求本站 `/api/market-data/*`，页面访问不触发第三方抓取。
- `#/settings` 只请求 `/api/settings/data-acquisition`；首次加载、刷新状态和60秒轮询不得调用刷新接口或第三方来源，离开路由必须清除轮询。
- 手动刷新只允许可信本地网络，并受 30 分钟冷却、并发锁和每日预算限制。

## 页面回归

至少检查：

1. `#/`：九阶段周期图、六指标卡和状态说明。
2. `#/stage/high-consolidation`、`#/stage/right-side-reversal`、`#/stage/one-way-decline`。
3. `#/compare`：九阶段对比。
4. `#/options/protective-put` 和另一策略；刷新、前进、后退恢复选择。
5. `#/indicators`：六指标说明。
6. `#/drawdown-analysis`：默认Nasdaq-100、S&P 500对比、近10年、15%阈值；验证七个快捷范围、自定义日期、对象互斥、阈值、排序、空错态、前进/后退，以及两张图真实交易日日期游标同步、右侧Tooltip翻转、Escape关闭和键盘导航。
7. 未知 Hash：前端 404。

交互通过标准：

- 阶段动作与资产标签同一时间各显示一个面板，方向键与 `aria-selected` 同步。
- 期权核心损益和主要风险始终可见；原生折叠可由 Enter/Space 操作。
- 阶段页期权链接直达对应 `#/options/:id`。
- 指标说明弹窗可由 Escape、遮罩和关闭按钮关闭，焦点返回触发按钮。
- 深浅主题均可读；状态不能只依赖颜色。
- 单指标切换范围不改变其他卡片；不可用范围保持禁用。
- 控制台无错误。
- 回撤页核心计算必须使用`range=ALL`完整历史；切换范围不得重复请求，同日期冲突必须失败，null不得变成0，两个对比序列必须从首个共同日期归一化为100。
- 回撤图日期游标必须从完整有效点二分吸附，不能由显示抽样或插值生成日期；pointermove使用动画帧节流，触摸仅在明确横向跟踪时阻止默认滚动，重新渲染、离开路由、失焦和取消时必须清理监听器与待执行帧。
- SOXX专项必须覆盖准确标的、SOX/SOXL/SOXS拒绝、NAV/market/adjusted口径、排序/重复/冲突/null、基金成立日前数据、2024拆分连续性、幂等原子导入、Provider失败隔离、API元数据、可选UI和首页仍为六卡。
- 官方SOXX文件只允许人工下载到`runtime-data/`后执行：`node tools/market-data/import-soxx-history.js runtime-data/market-data/soxx-audit/official-data-download.xlsx --series-type nav --adjustment-status provider_adjusted --source official-ishares --source-url https://www.ishares.com/us/products/239705/SOXX`。第二次执行必须报告`changed=false`。

## 响应式与可访问性

检查 `375×812`、`768×1024`、`1024×1366`、`1440×900`：

- 页面根节点无横向溢出；周期图只在自身容器横向滚动。
- 手机一列、平板两列、桌面三列指标卡。
- 长文本不溢出、不遮挡按钮、不被固定高度裁切。
- 导航、标签、折叠、弹窗和周期阶段支持键盘操作。
- 触摸目标不小于现有设计要求；375px 使用移动导航。
- 回撤页在平板使用两列摘要，在手机使用事件卡片和至少两列年度收益卡；图表提示不得超出视口。真实iPad/iPhone验证时应确认单指纵向滚动仍有效，横向拖动才进入日期跟踪。
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

## 自计算指标检查点B

自动测试还必须覆盖：

- CSV大小/行数/字段、标题、UTF-8文本、权重总和、重复ticker/日期、日期乱序、缺失或异常价格；
- SEC GAAP/IFRS字段回退、修订优先、重复事实、四季度TTM、10-K/10-Q防重复和显式拆股调整；
- QQQ PE财务/价格覆盖率、币种不一致、显式价格/财务日期、原始正负盈利影响、排除亏损诊断、原始/稳健近零或负分母；
- 独立30成分纯虚构fixture的无极值、正/负极值、普通亏损、大权重/多个极值、MAD为0、小于20成分、正式80成分门槛、极值权重10%门槛、顺序/权重缩放不变性、非有限输入和拆股错误；
- RV10/20/60最小样本、复权收盘价、日对数收益率、缺失交易日不插值；
- RV20分位只报告1/3/5/10年实际可用范围，不补模拟历史；
- `RISK-APPETITE-v1-EW`方向调整、等权贡献、缺失不补0和至少5/7覆盖门槛；
- Forward PE的固定methodology、来源、录入时间、重复与过期；
- CFTC目标合约缺失，以及单个派生计算失败不影响其他结果。

自动测试只使用虚构或官方格式合成fixture，不读取用户真实`runtime-data/`，不请求SEC、CFTC、IBKR、Twelve Data或Alpha Vantage。正式运行验证必须使用独立端口；缺少SEC邮箱时确认无外部请求，CFTC真实请求只能由获批Provider和周六调度或受控手动刷新触发。

检查点B还需验证：六卡独立状态、PE双曲线与详情页、`provisional`和`quality_warning`并存、财务/价格覆盖门槛、SEC每日一次、CFTC周六一次、旧缓存回退、无缓存错误、完全断网启动以及运行数据持续被Git忽略。

## IBKR隔离探测边界

- 当前主机没有TWS、IB Gateway或Client Portal Gateway，因此没有可执行的IBKR探测脚本。
- 后续只有在用户安装官方组件、本人完成登录并确认只读API设置后，才能在`scripts/data-source-probes/ibkr/`新增探测代码。
- 探测输出必须写入`runtime-data/data-source-probes/ibkr/`或操作系统临时目录，不得写入脚本目录、fixture或Git。
- 探测只允许合约搜索、行情权限模式和历史日线；不得请求账户、持仓、余额或订单信息。
- 48101现有服务不得用于探测；使用独立空闲端口或仅连接IBKR本机Socket端口。

`tests/review-server.js` 只用于展示 UI 状态，来源必须显示“UI验收合成夹具（非真实行情）”。它不进入正式启动路径，不访问第三方。

## 数据库、媒体与生成文件检查

数据库、缩略图、媒体上传、视频、HLS 和查重模块当前不存在，因此没有适用的迁移、索引、Range、转码或缩略图测试。若未来新增，必须先补充本节，不得假设已有验证覆盖。

## 常见失败现象

- `node` 或 `npm` 不可识别：安装/确认官方 Node.js 18+，或在当前 PowerShell 修正 PATH；不要改项目脚本规避环境问题。
- 48101 被占用：查明监听 PID，使用临时端口测试；不要终止未知服务。
- 自计算指标显示 unavailable：缺少对应本地导入或官方运行缓存时是预期行为，不得用演示值或零补齐。
- 没有 `FRED_API_KEY`：当前是预期配置，不影响启动。
- 单缓存损坏：服务应隔离文件并保持其他卡与健康检查可用。
- 缺失资源返回 404：Hash Router 下是预期行为。

## 最近确认的基线

2026-07-26，Windows无感启动专项：PowerShell语法与2项启动生命周期合成测试通过；任务、隐藏启动、重复启动、受控停止/重启、48101 health、首页/回撤路由、六项摘要、SOXX history和48102隔离检查通过。15分钟观察中健康和监听PID稳定、未出现新的`cmd.exe`，任务持续运行；Windows重新登录触发仍需目标桌面会话确认。

2026-07-26，回撤图同步日期游标按完整check内容验证：149项测试通过、0失败，数据检查确认9阶段、8期权、6首页指标和7范围，全部语法检查与`git diff --check`通过。合成评审页覆盖桌面、平板和手机视口的SVG虚线、选中点、同步日期、Tooltip翻转、键盘移动和Escape关闭；真实iPad/iPhone硬件触摸仍待目标设备人工验收。

2026-07-22，SOXX ETF回撤接入完整检查：144项测试通过、0失败，数据检查确认9阶段、8期权、6首页指标和7范围，全部语法检查与`git diff --check`通过。官方文件离线导入首次`changed=true`、重复执行`changed=false`；合成视觉夹具覆盖SOXX主对象、双向对比、10年、全历史、ongoing、不可用、1440×900、768×1024和390×844，控制台0错误且无页面级横向溢出。

2026-07-15，`feature/v0.4-compliant-market-data-waterfall` 检查点A.1执行`npm.cmd run check`：53项测试通过、0失败；QQQ PE专项18项通过。专项测试包括30成分无极值、正/负/普通亏损、大权重/多个极值、MAD为0、样本不足、原始/稳健近零分母、极值权重超过10%、顺序和权重尺度不变性、非有限输入及显式日期校验。固定9阶段、8期权、6个现有首页指标、7范围和Provider合规门禁仍有效。没有UI变化、真实数据读取或全量计算，不重新生成截图。真实设备和ZeroTier跨设备验收仍待确认。

2026-07-15，检查点B按`package.json`中的完整check命令逐项执行：69项测试通过、0失败；固定9阶段、8期权、6项新指标和7范围不变。独立端口48218正式进程返回`/api/health` HTTP 200，无本地输入时六卡均为`unavailable`且可离线启动。应用内浏览器已验证首页、两类阶段详情、期权工具、阶段对比、指标说明和PE详情；375×812、768×1024、1024×1366、1440×900无页面级横向溢出，深浅主题、指标弹窗Escape关闭及焦点返回正常，控制台0错误。真实设备、局域网与ZeroTier仍待用户环境验收。

2026-07-22，回撤分析实现按`package.json`完整check内容执行：133项测试通过、0失败，其中新增19项回撤专项/API/页面契约测试。48101本地服务健康检查通过，两条指数完整历史均可用；应用内浏览器验证七个快捷范围、自定义日期、对象互斥、阈值、排序、空态、主题、移动导航、刷新和前进/后退。1440×900、768×1024、390×844均无页面级横向溢出，控制台0错误。真实iPad/iPhone硬件触摸仍待目标设备人工验收。

v0.5 WorldPEratio 第一检查点使用项目认可的 Node.js 运行时按 `package.json` 的完整 check 步骤执行：95项测试通过、0失败。独立测试端口返回`/api/health` HTTP 200、版本`0.5.0-dev`、六指标；WorldPEratio status/latest 分别确认`enabled=false`、`pending_written_confirmation`、`attemptsToday=0`、`unavailable`和`currentPE=null`，GET诊断未触发第三方请求。
