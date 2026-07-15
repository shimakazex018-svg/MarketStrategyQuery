# 项目当前上下文

## 项目名称与用途

- 名称：Market Cycle Strategy。
- 当前开发版本：`0.4.0-dev`（来自 `package.json`）。
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
- 首页指标状态支持 `loading`、`fresh`、`stale`、`error`、`demo`、`unavailable`、`provisional`、`insufficient_coverage` 和 `manual`，并可独立显示 `quality_warning`。
- 深浅主题、Hash Router、键盘/触摸交互和响应式布局。
- Node.js 静态服务、健康检查和内部市场数据 API。

## 当前稳定状态

- 稳定版本：`main` 上的 `v0.4.0`；v0.4功能合并提交为 `a0eb46ea612dbe37254acf886b4d6a56c1cf1c66`。
- 下一开发分支：`feature/v0.5-public-web-data-providers`；创建后尚未开始公开网页数据源开发。
- v0.4检查点B已把自计算数据层接入正式内部API与首页。`PE-Q1-RAW-v1`和`PE-Q1-ROBUST-WMAD4-v1`在同一张卡及PE详情页展示；排除亏损版和旧完整公司总市值/总盈利方法仍仅作内部诊断。
- IBKR登记为`not_tested`、`pending_written_confirmation`、`not_selected_by_owner`、`enabled=false`；Twelve Data和Alpha Vantage为`deferred`。未安装组件、未登录、未请求数据。
- 当前没有用户本地持仓、价格、Forward PE或SEC运行输入时，六张新卡均可独立显示`unavailable`并保持离线启动；不会回退到旧VIX/VXN或演示数值。
- Cboe和IBKR在Provider注册表中均为 `pending_written_confirmation`、`enabled=false`；旧环境变量不能绕过注册表门禁。Twelve Data和Alpha Vantage为`not_evaluated`、`enabled=false`。
- 正式首页六卡现为原始/稳健QQQ组合TTM PE、Forward PE人工录入、QQQ RV20、RV20历史分位、自建风险偏好和Nasdaq期货机构仓位代理。
- v0.4的发布边界是自计算市场指标MVP、真实数据输入基础设施、原始和稳健QQQ PE计算、SEC/CFTC接入框架、本地CSV导入及完整数据质量状态；它不是全部真实行情、官方QQQ PE、官方VIX/VXN或实时数据正式版。

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

当前不存在数据库、缩略图目录、视频缩略图目录、HLS、上传文件或视频切片功能。数据库路径、媒体源路径和可再生成媒体规则：不适用。

## 当前已知限制

- 真实市场数据受来源定义、机器接口和再展示许可阻塞。
- GitHub仓库当前为公开仓库；建议改为private，但本项目仍必须按公开仓库标准排除密钥、会话和运行数据。
- IBKR路线已由用户延期；若未来恢复，仍需用户选择并安装官方组件、人工登录和书面许可确认。
- QQQ PE已确定原始与稳健双口径；至少80个有效成分和不超过10%的极值处理权重已由虚构fixture覆盖，仍需用户真实本地输入验证实际覆盖率。风险偏好最终权重仍待用户审定。
- 真实QQQ成分/权重、复权价格和Forward PE仍需用户本地CSV。SEC bulk只有在本机显式配置应用名、联系邮箱和更新开关后才允许下载；CFTC正式选择`209742`，但运行缓存不进入Git。
- 不自动判断市场阶段，不提供自动仓位建议。
- 不读取IBKR账户、持仓或余额，不执行交易；当前只登记非敏感Provider评估结果。
- 没有登录、多用户、数据库、后台编辑器、回测或历史策略记录。
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
- 七个时间范围、Hash Router、默认端口和原生Node.js技术栈保持不变。检查点B没有增加数据库、框架、第三方依赖、自动阶段判断或交易功能。
- 数据源许可门槛与“未获许可不抓取、不缓存、不展示”的默认边界。

## 运行数据保护

- `runtime-data/` 不应提交 Git，也不得为了清理工作树而删除。
- `.env`、密钥、日志、缓存、请求状态和机器相关文件不应提交。
- 当前 `.gitignore` 已覆盖实际使用的 `runtime-data/`、`node_modules/` 和 `*.log`。
- 通用 `data/`、`cache/`、`thumbnails/`、`video-thumbnails/`、`hls/` 和 SQLite 扩展名尚无预防性忽略规则；这些目录/文件当前不存在。若未来引入，必须先单独评审 `.gitignore`、备份、容量和清理策略。
