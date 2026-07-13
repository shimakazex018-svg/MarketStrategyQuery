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

- 阶段：`id/order/name/category/direction/risk/mode/summary/conditions/allocations/options/actions/risks`。
- 仓位项：`ticker/range/role`；每阶段固定包含四类标的。
- 期权：`id/name/english/purpose/bias/structure/cashflow/maxGain/maxLoss/breakeven/idealStages/details/risk`。
- 指标：`id/name/subtitle/value/unit/percentile/status/explain/meaning/limits`。

新增字段必须保持现有字段兼容，并在渲染处提供缺省处理。金融内容的进一步结构化应先确定字段契约，再改 JSON 与模板。

## 市场周期图

周期图由 `marketCycleSvg()` 生成内联 SVG。九个阶段区域具有 `role="link"`、键盘焦点和 Enter/Space 激活逻辑。窄屏只允许 `.cycle-scroll` 容器横向滚动，页面本身不得横向溢出。

## 主题与响应式

主题通过根元素 `data-theme` 和 CSS 自定义属性切换，初始值跟随系统偏好。断点为 1100px、760px 和 440px；对应桌面、平板/小桌面和手机布局。所有动画在 `prefers-reduced-motion: reduce` 下缩短至近乎即时。

## Node.js 服务

默认读取 `HOST=0.0.0.0`、`PORT=48101`，提供 `/api/health` 与 `public/` 静态文件。路径先解码、规范化并用 `path.relative` 校验，防止越过公开目录；缺失文件返回 404，静态文件按扩展名返回 MIME，并启用 `nosniff`。

## 真实数据接口边界

当前没有外部请求、缓存、定时任务或账户数据。未来若获准接入真实数据，应通过独立服务接口提供，并明确来源许可、请求频率、缓存淘汰、缺失值、更新时间、限流和故障降级；不得直接把密钥或券商连接放进浏览器代码。
