# 项目当前上下文

## 项目名称与用途

- 名称：Market Cycle Strategy。
- 当前开发版本：`0.3.0-dev`（来自 `package.json`）。
- 用途：个人市场周期、独立仓位区间、期权策略和辅助指标查询网站。
- 产品性质：信息整理与场景推演工具，不是个性化投资建议，不保证收益或本金。

## 当前运行方式

- 环境要求：Node.js 18 或更高版本。
- 启动命令：`npm.cmd start` 或 `npm.cmd run start`。
- Windows 脚本：`powershell -ExecutionPolicy Bypass -File .\scripts\start-market-site.ps1`。
- 默认监听：`0.0.0.0:48101`；可由 `HOST`、`PORT` 环境变量覆盖。
- 本机默认地址：`http://127.0.0.1:48101`。
- 局域网/ZeroTier：使用服务器对应网卡 IP 加端口 48101；实际跨设备连通性待确认。
- 没有构建步骤、前端打包器或第三方运行依赖。

## 当前主要功能

- 九种固定市场阶段的周期图、详情页和对比页。
- QQQ、SOXX、SOXL、现金/SGOV 的独立允许仓位区间与资产规则。
- 八种固定期权策略的单策略详情、损益公式、管理规则与风险边界。
- 六张指标卡、七个时间范围、状态元数据和历史曲线结构。
- 指标状态固定支持 `loading`、`fresh`、`stale`、`error`、`demo`、`unavailable`。
- 深浅主题、Hash Router、键盘/触摸交互和响应式布局。
- Node.js 静态服务、健康检查和内部市场数据 API。

## 当前稳定状态

- 稳定版本：`main` 上的 `v0.2.0`，提交 `160345eeeefca763b05233fdae76a43025a85516`。
- 当前开发分支：`feature/v0.3-live-market-data`。
- v0.3 已完成数据源审计、市场数据基础设施、前端六状态、自动测试与评审截图，但尚未合并 `main`，也没有 `v0.3.0` 标签。
- 没有任何真实指标通过全部接入门槛：VIX/VXN 为 `unavailable`；QQQ组合TTM PE、Forward PE、恐慌贪婪指数、基金经理仓位指数为 `demo`。
- 默认 `CBOE_DATA_LICENSE_CONFIRMED=false`，正式服务不会访问 Cboe。

## 当前数据与生成目录

| 路径 | 性质 | Git 状态 | 说明 |
| --- | --- | --- | --- |
| `public/data/` | 产品源数据 | 跟踪 | 阶段、期权、指标和周期图 JSON；不是运行缓存 |
| `runtime-data/market-data/latest/` | 运行数据 | 忽略 | 每指标最新缓存；当前可为空 |
| `runtime-data/market-data/state/` | 运行数据 | 忽略 | 请求预算和最近状态 |
| `runtime-data/market-data/logs/` | 运行数据 | 忽略 | 有界抓取日志 |
| `runtime-data/market-data/raw/` | 运行数据 | 忽略 | 可选、受限的诊断原始响应；默认不保存 |
| `previews/` | 产品评审资料 | 跟踪 | 基线和评审截图，不是服务运行目录 |
| `tests/fixtures/market-data/` | 测试源文件 | 跟踪 | 人工最小测试夹具，不是真实行情 |

当前不存在数据库、缩略图目录、视频缩略图目录、HLS、上传文件或视频切片功能。数据库路径、媒体源路径和可再生成媒体规则：不适用。

## 当前已知限制

- 真实市场数据受来源定义、机器接口和再展示许可阻塞。
- 不自动判断市场阶段，不提供自动仓位建议。
- 不读取账户、持仓或 IBKR，不执行交易。
- 没有登录、多用户、数据库、后台编辑器、回测或历史策略记录。
- 真实 iPhone/iPad、目标局域网、ZeroTier 和 Windows 防火墙跨设备验收：待确认。
- 金融策略文案、仓位区间和期权参数仍需用户或合格专业人士最终审定。

## 当前兼容与废弃状态

- `adjacentStages` 仍保留在阶段 JSON 中用于兼容，但当前详情页不渲染。
- `#/options` 继续兼容并回退到首个策略；具体策略使用 `#/options/:id`。
- 旧的“六张卡全部是模拟指标”描述已不再准确；当前必须按每张卡的 `demo` 或 `unavailable` 状态说明。
- 没有确认已废弃的服务端 API。若未来废弃接口，必须在本文件和架构文档中明确标注。

## 不得随意修改的内容

- 九阶段名称、顺序和 ID。
- 八种期权策略名称、分类和 ID。
- 当前仓位区间、期权推荐等级、公式、DTE 和行权价逻辑，除非用户明确要求金融内容校准。
- 六个指标、七个时间范围、Hash Router、默认端口和原生 Node.js 技术栈。
- 数据源许可门槛与“未获许可不抓取、不缓存、不展示”的默认边界。

## 运行数据保护

- `runtime-data/` 不应提交 Git，也不得为了清理工作树而删除。
- `.env`、密钥、日志、缓存、请求状态和机器相关文件不应提交。
- 当前 `.gitignore` 已覆盖实际使用的 `runtime-data/`、`node_modules/` 和 `*.log`。
- 通用 `data/`、`cache/`、`thumbnails/`、`video-thumbnails/`、`hls/` 和 SQLite 扩展名尚无预防性忽略规则；这些目录/文件当前不存在。若未来引入，必须先单独评审 `.gitignore`、备份、容量和清理策略。
