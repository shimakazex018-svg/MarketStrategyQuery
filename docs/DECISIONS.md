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

## DEC-019：公开网页只允许逐来源审计后的禁用原型

### Decision
`DEC-009` 的许可硬门禁继续有效。对用户明确指定的单一公开网页来源，可以在完成 robots、条款、目标、字段、访问方式和缓存边界审计后建立默认禁用、合成测试驱动的 Provider 原型；这不等于允许生产抓取。WorldPEratio 第一检查点仅使用服务器直出 HTML，不启用浏览器自动化，不进入首页或自动调度。

### Reason
需要把“技术上可解析”与“已获授权自动采集/缓存/展示”分开验证，同时在许可结论未通过时仍能验证限流、错误停止、字段歧义和缓存隔离的工程边界。

### Impact
WorldPEratio 登记为 `pending_written_confirmation`、`candidate`、`enabled=false`。只有取得覆盖每天一次读取、最终字段缓存和本人内部展示的明确许可并更新登记后，才可独立评审启用；环境变量和 HTTP 200 不能绕过。

### Status
部分被 DEC-020 取代；默认禁用原型规则仍适用于其他来源，WorldPEratio 改按项目所有者风险接受边界执行。

## DEC-020：WorldPEratio有限剩余风险由项目所有者接受

### Decision
WorldPEratio 登记为 `approved_with_conditions`、`selected`、`conditionsSatisfied=true`、`enabled=true`，并记录 `riskAcceptance: owner_accepted_limited_internal_use`。该状态表示项目所有者接受有限剩余风险，不表示 WorldPEratio 提供了书面授权。

### Reason
目标页面公开且无需登录，robots 未禁止目标路径，当前未发现 Terms 或明确自动访问禁令；使用被限定为本人、非商业、每天最多一次正常请求、仅超时或5xx有限重试、不保存HTML、不公开API/下载/转发，并在访问控制或来源结构变化时立即停止。

### Impact
每次正常采集前必须检查 robots；真实结果只写入被 Git 忽略的标准化运行缓存。外部参考PE必须与 `PE-Q1-RAW-v1`、`PE-Q1-ROBUST-WMAD4-v1` 严格分离，不得覆盖本站自计算结果。条款或robots出现禁止性变化时必须自动停止并保留最后成功结果为 stale。

### Status
有效

## DEC-021：v0.5正式范围固定为六项已成功数据

### Decision
v0.5首页和公开摘要固定为Nasdaq-100 PE、S&P 500 PE、VIX、VXN、Nasdaq-100指数和S&P 500指数。真实数据保存在`runtime-data/market-data/production/`，由离线导入器和现有市场数据服务中的FRED、WorldPEratio Provider维护。Forward PE、QQQ/SPY价格和机构仓位代理不显示、不调度、不以其他指标代替；SOXX仅作为DEC-023定义的隐藏回撤分析对象。

### Reason
六项来源、字段和本地成功缓存已经验证；其余指标仍受访问、定义或输入条件阻塞。固定正式范围可以避免伪造、口径替代和继续扩大数据源风险。

### Impact
六项通过统一API提供摘要、详情、历史和Provider状态；每天Asia/Shanghai 07:30受控检查，失败保留最后成功缓存并标记stale。PE统计与逐日快照严格分离，真实运行数据不得进入Git。DEC-018定义的旧首页六卡不再是当前产品范围，但其自计算模块可保留为内部兼容代码。

### Status
有效；取代DEC-018的正式首页六卡定义。

## DEC-022：回撤分析使用完整历史计算与有界SVG显示

### Decision
`#/drawdown-analysis`读取`nasdaq100_index`、`sp500_index`和可用的`soxx_price`内部history API。history路径允许`range=ALL`返回完整已校验日频序列；回撤、事件、持续交易日、分布和年度收益全部使用完整序列计算，原生SVG显示层再按宽度抽样并保留关键日期。

### Reason
现有最多240点的详情图抽样会漏掉真实峰值、谷底和恢复日，不能作为回撤算法输入；两条约万点以内的日频序列一次读取并在浏览器缓存，资源成本仍可控。

### Impact
首页六卡、七个既有范围、Provider、每日07:30更新和运行数据结构不变。页面不得直接读取`runtime-data/`、请求外部来源或用抽样点计算回撤。未来只有数据规模明显扩大时才评审Worker或服务端预聚合。

### Status
有效

## DEC-023：SOXX仅以官方基金NAV本地导入方式进入回撤分析

### Decision
SOXX标的严格定义为iShares Semiconductor ETF，不是SOX、SOXL或SOXS。当前官方可用序列为iShares工作簿的日频NAV，保存为`seriesType=nav`、`adjustmentStatus=provider_adjusted`；已知2024年3-for-1拆分只做连续性验证，不再次调整。真实文件和标准化序列只保存在`runtime-data/`。

### Reason
iShares产品页提供无需登录的公开数据下载，历史工作表字段明确为NAV；官方拆分公告与拆分日前后连续序列支持“提供方已调整”结论。BlackRock条款允许个人非商业下载，但禁止未经授权的自动监控或复制，因此不能建立官网定时抓取。

### Impact
`EtfPriceProvider`和07:30任务只重载本地文件，不联网。SOXX有至少两个有效点时才出现在回撤页选择器；API和页面必须明确显示NAV口径及“SOXX不是SOX”。首页六卡、现有四项FRED与两个PE流程不变。

### Status
有效
