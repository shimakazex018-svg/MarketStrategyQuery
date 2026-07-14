# 架构说明

## 技术边界

项目使用原生 HTML、CSS、JavaScript 和 Node.js 原生 HTTP 模块，无第三方运行依赖、构建器、数据库或持久化层。前端由 `public/` 直接提供，策略正文由 JSON 驱动。

## 主要文件

- `public/index.html`：页面外壳、导航、主题与移动菜单控件。
- `public/app.js`：状态、数据加载、Hash 路由、模板渲染和交互绑定。
- `public/styles.css`：主题变量、布局、组件、断点和减少动画规则。
- `public/data/stages.json`：九阶段及仓位、条件、动作、风险和策略分级。
- `public/data/options.json`：八类期权工具的核心结构与损益公式。
- `public/data/indicators.json`：六个模拟指标的文案与展示值。
- `server.js`：健康检查、安全路径解析、MIME 和静态文件响应。
- `scripts/check-data.js`：数据数量、固定枚举、引用和时间范围校验。

## 页面路由

| Hash | 页面 |
| --- | --- |
| `#/` | 首页、市场周期图和指标卡片 |
| `#/stage/:id` | 单一阶段详情 |
| `#/compare` | 九阶段对比 |
| `#/options` | 八类期权工具 |
| `#/indicators` | 六类指标说明 |
| 其他 Hash | 前端 404 页面 |

Hash 不会发送给服务器，因此服务器无需为缺失静态路径回退首页；不存在的文件返回 HTTP 404。

## 数据加载与渲染

启动时 `loadData()` 并行请求三个 JSON 文件，全部成功后写入内存状态并渲染当前 Hash。失败时显示明确的加载失败提示。页面切换使用 `innerHTML` 重建当前模板，再绑定阶段、时间范围与渐入观察器；当前数据规模固定且很小，不需要分页或虚拟列表。

## JSON 数据模型

- 阶段基础字段：`id/order/name/category/direction/risk/mode/summary/marketDefinition/strategyProfile/conditions`。
- 阶段结构字段：`adjacentStages/allocations/assetRules/optionGuidance/actionPlan/transitionConditions/returnSources/lossSources/worstCase/invalidation/opportunityCost/riskNotice`。
- 仓位项：`ticker/range/role`；每阶段固定包含四类标的。`assetRules` 按 ticker 提供 `increaseWhen/reduceWhen/avoidWhen/risk`。
- 阶段期权分级：`optionGuidance` 将固定八策略完整分入 `recommended/optional/cautious/avoid`，并保留旧 `options` 引用以兼容既有数据。
- 期权基础字段：`id/name/english/category/purpose/bias/structure/buyLegs/sellLegs/underlyings/idealStages/unsuitableStages`。
- 期权损益与管理：`cashflow/maxGain/maxLoss/breakeven/dteLogic/strikeLogic/performance/thetaImpact/ivImpact/earlyExit/expiration/risk/opportunityCost/variables/formulaExample`。
- 指标：`id/name/subtitle/value/unit/percentile/status/explain/meaning/limits`。

渲染层通过 `valueOr()`、`listOr()` 和结构回退处理缺失字段，单个新字段缺失不会让整页崩溃。`scripts/check-data.js` 对完整生产数据执行严格字段与引用检查。

## 长内容页面结构

阶段详情依次展示状态定义、相邻阶段、识别条件、仓位、资产规则、期权分级、四种情景动作、切换条件、收益亏损和风险边界。期权工具页按单策略宽卡片展示交易腿、损益、DTE、行权价、三种行情表现、Theta、IV、退出与到期；只有变量说明和静态公式示例使用原生 `details` 折叠，最大亏损和主要风险始终可见。

## 市场周期图

周期图由 `marketCycleSvg()` 生成内联 SVG。九个阶段区域具有 `role="link"`、键盘焦点和 Enter/Space 激活逻辑。窄屏只允许 `.cycle-scroll` 容器横向滚动，页面本身不得横向溢出。

## 主题与响应式

主题通过根元素 `data-theme` 和 CSS 自定义属性切换，初始值跟随系统偏好。断点为 1100px、760px 和 440px；对应桌面、平板/小桌面和手机布局。所有动画在 `prefers-reduced-motion: reduce` 下缩短至近乎即时。

## Node.js 服务

默认读取 `HOST=0.0.0.0`、`PORT=48101`，提供 `/api/health` 与 `public/` 静态文件。路径先解码、规范化并用 `path.relative` 校验，防止越过公开目录；缺失文件返回 404，静态文件按扩展名返回 MIME，并启用 `nosniff`。

## 真实数据接口边界

当前没有外部请求、缓存、定时任务或账户数据。未来若获准接入真实数据，应通过独立服务接口提供，并明确来源许可、请求频率、缓存淘汰、缺失值、更新时间、限流和故障降级；不得直接把密钥或券商连接放进浏览器代码。

## v0.2 阶段详情信息架构

阶段详情页按“概览、仓位、执行动作、资产逻辑、识别条件、期权、风险”组织。仓位区间始终可见；执行动作和资产逻辑使用单选标签页，同一时间只渲染一个面板的可见状态，键盘可用方向键切换。

`adjacentStages` 为兼容历史数据继续保留，但当前不参与详情页渲染。`recognitionVisual` 是可选对象，可包含 `src/alt/title/caption/source/period`；当 `src` 缺失或为空时不创建图片或空白占位，文字识别条件仍可独立显示。

## v0.2 期权工具信息架构

期权工具页使用“策略目录 + 单策略详情”，同一时间只完整显示一种策略。`#/options/:id` 保存当前选择，因而支持刷新恢复和浏览器前进、后退；`#/options` 安全回退到第一种固定策略。分类筛选只读取现有 `category`，不改变策略分类或金融字段。

最大收益、最大亏损、盈亏平衡点和主要风险始终显示；交易设计、市场表现、时间与波动率、管理规则、公式与变量按组折叠。移动端以原生选择框替代桌面目录，避免把双栏强行压缩到窄屏。

## v0.2 市场周期图

`public/data/cycle-shape.json` 保存九阶段的手工归一化静态点位、紧凑摘要和非实时声明，阶段 ID 必须与 `stages.json` 一一对应。`marketCycleSvg()` 只负责把数据映射为平滑 SVG 曲线、标记和可访问交互区域，因此未来替换获准的历史片段时不需要重写图形组件。

该数据不是实时或历史QQQ精确数据，运行时不请求外部行情。窄屏仅允许 `.cycle-scroll` 容器横向滚动；页面根节点不得产生横向溢出。

## v0.2 指标说明弹窗

`indicators.json` 在旧有 `meaning/limits` 兼容字段之外提供 `definition/interpretation/marketRelation/limitations`。首页只创建一个可复用对话框外壳，点击指标信息按钮后以 `textContent` 写入当前指标内容，避免重复 DOM 和正文硬编码。

对话框具备 `role="dialog"`、模态语义、Escape及遮罩关闭、焦点约束与关闭后焦点返回。移动端显示为底部抽屉且正文内部滚动；指标数值继续是静态演示值，不进行网络请求或阶段自动判断。

## v0.3 市场数据边界

浏览器只访问本站 `/api/market-data/*`，页面加载不会直接请求第三方。`server/market-data/` 将数据源适配、结构校验、原子缓存、请求预算、调度、日志和 HTTP API 分离；单指标故障不会阻断其他指标或静态策略页面。服务启动先读本地缓存，缓存损坏按指标隔离；未确认来源许可时，即使存在旧缓存也不向页面展示。

当前数据源审计没有发现同时满足定义、机器可读、Windows 可访问和公开再展示许可门槛的正式来源，因此 VIX/VXN 返回 `unavailable`，QQQ组合TTM PE、Forward PE、恐慌贪婪指数和基金经理仓位指数返回 `demo`。实现保留受控 Cboe 适配器，但只有显式设置 `CBOE_DATA_LICENSE_CONFIRMED=true` 后才允许请求；默认不会发起外部请求。

指标响应统一支持 `loading/fresh/stale/error/demo/unavailable`。在线模型包含数值、数据日期、来源、最近尝试、最近成功、下次允许时间、可用时间范围及有界历史点；无缓存失败时使用 `null`，不以 0 伪装数据。历史曲线最多向前端返回 240 点，避免长期缓存和 DOM/SVG 无界增长。

缓存位于被 Git 忽略的 `runtime-data/market-data/`，采用临时文件加重命名的原子写入。日志和可选原始响应均有文件大小或保留数量上限；没有数据库、长期无限缓存或浏览器端密钥。
