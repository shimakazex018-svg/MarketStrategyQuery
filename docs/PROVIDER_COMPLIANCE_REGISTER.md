# 市场数据供应商合规登记

## 目的

本登记定义Provider的非敏感审批字段和启用规则。机器可读登记保存在 `config/market-data-providers.json`，服务端在启动时验证；本文件说明字段含义和当前结论。

## 合规状态

`complianceStatus` 只能使用：

- `approved`
- `approved_with_conditions`
- `pending_written_confirmation`
- `rejected`
- `technically_unavailable`
- `not_evaluated`

只有 `approved`，或已经满足全部附加条件的 `approved_with_conditions`，才可能设置 `enabled=true`。其他状态必须禁用。环境变量、API成功响应或本地缓存不能绕过该门禁。

## 登记字段

| 字段 | 含义 |
| --- | --- |
| `providerId` | 稳定、非敏感的Provider ID |
| `providerName` | Provider名称 |
| `targetIndicators` | 计划支持的本站指标ID |
| `technicalStatus` | 当前主机和适配器技术状态 |
| `complianceStatus` | 上述固定合规状态 |
| `selectionStatus` | 产品路线选择：`candidate`、`selected`、`deferred`或`not_selected_by_owner` |
| `accountRequirement` | 账户条件，不记录账户ID |
| `subscriptionRequirement` | 订阅或协议要求，不记录账单信息 |
| `internalDisplayAllowed` | 是否已确认允许本人内部网页展示 |
| `localCacheAllowed` | 是否已确认允许本机缓存 |
| `cacheRetention` | 已确认的缓存保留边界 |
| `historicalStorageAllowed` | 是否已确认允许保存历史序列 |
| `attributionRequirement` | 来源标注要求 |
| `writtenConfirmationRequired` | 是否仍需书面确认 |
| `termsCheckedAt` | 最近条款检查日期 |
| `technicalCheckedAt` | 最近技术检查日期 |
| `conditionsSatisfied` | `approved_with_conditions`的附加条件是否全部满足 |
| `enabled` | 是否允许进入正式数据路径 |
| `notes` | 不含敏感信息的结论与阻塞原因 |

## 当前登记摘要

| Provider | 目标指标 | 技术状态 | 合规状态 | 启用 |
| --- | --- | --- | --- | --- |
| SEC EDGAR companyfacts bulk | QQQ组合TTM PE | 官方bulk适配器已实现；运行时需显式本地配置 | `approved_with_conditions` / `selected` | 是；但默认运行配置关闭 |
| CFTC Public Reporting TFF | 纳指期货机构仓位 | 官方Socrata适配器已实现 | `approved` / `selected` | 是 |
| Cboe官方历史CSV | VIX、VXN | 适配器已实现，生产未访问 | `pending_written_confirmation` / `deferred` | 否 |
| Interactive Brokers | VIX、VXN | 未测试，用户当前不选择 | `pending_written_confirmation` / `not_selected_by_owner` | 否 |
| Twelve Data | QQQ价格候选 | 未测试 | `not_evaluated` / `deferred` | 否 |
| Alpha Vantage | QQQ价格候选 | 未测试 | `not_evaluated` / `deferred` | 否 |
| WorldPEratio | Nasdaq-100/QQQ外部参考PE | 服务器HTML可解析；无目标CSV/JSON；不需要浏览器 | `pending_written_confirmation` / `candidate` | 否 |

IBKR尚未验证具体账户类型、订阅、VIX/VXN合约搜索、历史日线返回或数据模式。用户因运行复杂度、人工认证、潜在订阅成本和券商账户耦合，决定当前阶段不采用IBKR；这不代表技术或许可失败。当前状态不允许创建正式适配器、不允许保存测试值，也不允许在页面显示IBKR来源数据。

Twelve Data和Alpha Vantage均为`deferred`，本阶段不继续技术或许可评价，也不请求其接口。

WorldPEratio 的 robots 未禁止目标路径，页面无需登录并直接返回目标 HTML；但 sitemap、页脚和定向搜索未发现 Terms 页面，也未发现自动读取、缓存或本人内部展示的明确授权。原型不进入调度，正式运行不会请求或展示该来源。审计证据见 `WORLD_PERATIO_SOURCE_AUDIT.md`。

## 复核原则

- 条款、订阅、账户分类或内部用途发生变化时重新评估。
- 任何批准都必须精确到目标指标、数据类型、展示范围、缓存和历史保存用途。
- 批准证据不得包含账户ID、用户名、密码、验证码、Cookie或Token。
- Provider被拒绝、许可过期或附加条件不再满足时，必须先禁用，再处理旧缓存；旧缓存不得继续展示。
