# 长期技术决策

本文件记录跨任务长期有效的选择。市场数据专项细节另见 `MARKET_DATA_DECISIONS.md`。

## DEC-001：保持原生技术栈

### Decision
使用原生 HTML、CSS、JavaScript 和 Node.js 原生 HTTP 服务；未经明确批准不增加前端框架、构建器、数据库或第三方运行依赖。

### Reason
当前页面和数据规模固定，原生技术栈部署简单、资源占用低且易于在 Windows 局域网环境维护。

### Impact
复杂度增长时优先保持模块边界；只有状态、并发或持久化规模明显超出现状才重新评估。

### Status
有效

## DEC-002：使用 Hash Router

### Decision
页面路由保持 `#/...`。

### Reason
静态服务器无需 History API 重写规则，局域网和 ZeroTier 访问更稳定。

### Impact
真实缺失静态文件返回 404；未知 Hash 由前端显示 404。

### Status
有效

## DEC-003：冻结九阶段与八期权

### Decision
固定九种市场阶段和八种期权策略，不擅自增加、合并、删除或改变顺序。

### Reason
这是用户确认的产品业务边界。

### Impact
数据检查强制验证固定枚举和引用；范围变化必须由用户明确批准。

### Status
有效

## DEC-004：仓位区间相互独立

### Decision
QQQ、SOXX、SOXL、现金/SGOV 的阶段仓位区间不强制合计为 100%。

### Reason
每个区间表达单项资产的允许边界，不是一组必须同时取值的组合权重。

### Impact
页面和校验不得增加仓位总和检查或自动调仓差额。

### Status
有效

## DEC-005：默认监听 `0.0.0.0:48101`

### Decision
服务默认绑定所有本机接口的 TCP 48101，允许通过环境变量覆盖。

### Reason
项目需要支持受控局域网和 ZeroTier 网卡访问。

### Impact
没有登录鉴权时只能在可信网络使用；Windows 防火墙应限定 Private 网络，不配置公网穿透。

### Status
有效

## DEC-006：缺失静态资源返回 404

### Decision
服务端不把缺失文件回退为 `index.html`。

### Reason
Hash Router 不需要服务端回退；错误返回首页会掩盖资源路径和 MIME 问题。

### Impact
真实资源错误可被测试发现；前端 Hash 兼容性不受影响。

### Status
有效

## DEC-007：详情和期权页面按需展示

### Decision
阶段页优先显示概览、仓位和初始动作；动作与资产逻辑同一时间各显示一个面板。期权页同一时间完整显示一个策略，并使用 `#/options/:id` 保存选择。

### Reason
降低长页面信息密度，同时保留直接链接、刷新恢复和浏览器历史。

### Impact
核心仓位、最大亏损和主要风险不得默认隐藏；`adjacentStages` 保留兼容但不渲染。

### Status
有效

## DEC-008：周期形态数据与 SVG 渲染解耦

### Decision
用 `public/data/cycle-shape.json` 保存手工归一化示意数据，SVG 只负责映射和交互。

### Reason
避免在 HTML 中硬编码大量坐标，并为未来经批准的数据替换保留稳定接口。

### Impact
当前曲线不得描述为真实 QQQ 日期或行情。

### Status
有效

## DEC-009：外部数据许可门槛优先

### Decision
只有定义、对象、日期、稳定机器接口、许可、历史覆盖和 Windows 访问同时通过的来源才能正式启用。

### Reason
公开端点或 HTTP 200 不等于允许自动读取、缓存和再展示。

### Impact
VIX/VXN 当前为 unavailable；其余四指标为 demo。禁止 DOM 抓取、私有接口或普通财经网站替代。

### Status
有效

## DEC-010：页面只访问内部 API

### Decision
浏览器不直接请求第三方；外部抓取与页面 GET 请求解耦。

### Reason
避免多浏览器放大流量、暴露密钥或让第三方故障阻塞页面。

### Impact
GET 指标 API 只读内存/缓存；抓取仅来自获批来源的启动检查、调度或受限维护刷新。

### Status
有效

## DEC-011：使用原子文件缓存并限制资源

### Decision
市场数据使用按指标拆分的 JSON 缓存、持久化请求状态和有界日志，不引入数据库。

### Reason
六个指标规模小，文件缓存足够，且能控制磁盘、内存、CPU 和网络成本。

### Impact
单指标每日最多 4 次、单提供方最多 20 次；手动刷新冷却 30 分钟；历史 API 最多返回 240 点。

### Status
有效

## DEC-012：代码与运行数据分离

### Decision
Git 管理源代码、产品 JSON、配置模板、测试、文档和确认后的评审资料；不管理缓存、日志、密钥和机器运行状态。

### Reason
运行数据会变化、可能包含敏感信息，并且与单机环境和容量管理相关。

### Impact
`runtime-data/`、`.env`、日志和临时文件不得提交；发现新运行目录时先评审忽略、备份和清理规则。

### Status
有效

## DEC-013：不自动判断或交易

### Decision
当前系统只提供查询与场景推演，不自动判断市场阶段、不生成自动仓位建议、不连接 IBKR、不读取持仓或下单。

### Reason
规则、数据许可、金融责任和账户安全边界尚未批准。

### Impact
任何自动化交易相关能力必须作为独立项目阶段重新设计和授权。

### Status
有效

## DEC-014：市场数据限于本人非公开内部使用

### Decision
市场数据只允许用户本人通过本机、家庭局域网和私人ZeroTier访问，不提供公开API、下载、注册、转发或第三方访问。

### Reason
将产品部署边界与数据许可审计使用场景保持一致，降低再分发、安全和隐私风险。

### Impact
仓库即使公开也只能包含源代码和人工测试数据；运行缓存、会话、密钥和真实历史不得提交。公开部署需要重新评审全部许可和鉴权。

### Status
有效

## DEC-015：Provider注册表是正式数据硬门禁

### Decision
使用版本控制的非敏感JSON登记Provider合规状态。只有`approved`，或附加条件全部满足的`approved_with_conditions`，并同时设置`enabled=true`，才能进入正式数据路径。

### Reason
避免单个环境变量、端点可访问或API成功响应绕过许可结论。

### Impact
`pending_written_confirmation`、`rejected`、`technically_unavailable`和`not_evaluated`一律禁用；服务启动和自动测试都会验证不变量。

### Status
有效

## DEC-016：v0.4采用本地输入与透明自计算内核

### Decision
当前阶段不继续IBKR、Twelve Data或Alpha Vantage；保留其历史评估和合规门禁，以用户本地导入、SEC EDGAR公共财务数据设计和CFTC TFF公共持仓数据设计建设自计算指标。

### Reason
降低人工认证、订阅、账户耦合和专有指标许可风险，并让公式、覆盖率与缺失处理可审计。

### Impact
自建结果不得命名为VIX、VXN或第三方专有指数；检查点A只实现离线内核，不修改正式首页。QQQ PE双口径已由DEC-017确定，风险偏好最终权重仍需用户确认。

### Status
有效

## DEC-017：QQQ TTM PE采用原始与WMAD4稳健双口径

### Decision
正式自计算QQQ组合TTM PE同时输出`PE-Q1-RAW-v1`和`PE-Q1-ROBUST-WMAD4-v1`。原始口径保留全部正负盈利；稳健口径只在盈利收益率层按加权中位数、加权MAD、1.4826尺度和4倍边界Winsorize，不删除成分或重新分配极值权重。排除亏损版本仅作内部诊断。

### Reason
直接截断单股PE会在盈利接近零时失真，全部排除亏损又会隐藏真实盈利拖累。E/P层稳健处理保留组合权重和普通亏损影响，同时隔离可能来自字段映射、拆股、币种或TTM拼接的统计极值。

### Impact
MAD为0、有效样本少于20、边界不可计算或非有限输入时必须标记`robust_method_unavailable`，不得回退固定阈值。正式全量阶段至少80个有效成分；受影响权重超过10%时结果仅供诊断并标记`quality_warning`。旧“总市值/总盈利”方法使用覆盖公司的完整市值和净利润，未按QQQ权重构造统一名义组合，只能标记为诊断算法；排除亏损算法同样只输出`excludeLossDiagnosticPE`。正式输入必须保留并校验权重、价格和财务日期。未来首页与PE有关的正式卡只显示原始与稳健两种自计算结果，且不得宣称等同或复制Invesco、Nasdaq、WorldPEratio指标。

### Status
有效；检查点A.1以30成分纯虚构fixture验证，检查点B已接入正式内部API、首页双口径卡和PE详情页。

## DEC-018：检查点B采用本地输入、SEC bulk和CFTC TFF的受控组合

### Decision
正式六卡固定为QQQ组合TTM PE、Forward PE、QQQ RV20、QQQ波动率分位、自建风险偏好和纳指期货机构仓位。SEC只使用官方nightly companyfacts bulk ZIP，并同时要求显式更新开关、应用名和有效联系邮箱；每天最多一次。CFTC只使用官方`gpe5-46if` TFF Futures Only数据集，`209742`为正式代理、`209747`只作诊断，每周六Asia/Shanghai检查。QQQ持仓、复权价格和Forward PE继续由用户本地CSV提供，不新增网页抓取或临时行情Provider。

### Reason
在不引入数据库、第三方运行依赖或专有行情授权的前提下，使正式指标可追溯、可离线启动并受明确请求预算控制。

### Impact
`provisional`表示结果为可追溯初步估算，`quality_warning`是独立质量维度；二者可以同时存在。覆盖低于财务70%或价格80%、分母不稳定或结果非正有限时必须使用`insufficient_coverage`并返回`null`。

### Status
有效
