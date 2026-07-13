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
