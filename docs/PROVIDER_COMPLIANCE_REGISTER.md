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
| Cboe官方历史CSV | VIX、VXN | 适配器已实现，生产未访问 | `pending_written_confirmation` | 否 |
| Interactive Brokers | VIX、VXN | 本机组件缺失，未登录、未请求数据 | `pending_written_confirmation` | 否 |

IBKR尚未验证具体账户类型、订阅、VIX/VXN合约搜索、历史日线返回或数据模式。当前状态不允许创建正式适配器、不允许保存测试值，也不允许在页面显示IBKR来源数据。

Twelve Data和Alpha Vantage尚未进入本瀑布阶段，不在本检查点做技术或许可评价。

## 复核原则

- 条款、订阅、账户分类或内部用途发生变化时重新评估。
- 任何批准都必须精确到目标指标、数据类型、展示范围、缓存和历史保存用途。
- 批准证据不得包含账户ID、用户名、密码、验证码、Cookie或Token。
- Provider被拒绝、许可过期或附加条件不再满足时，必须先禁用，再处理旧缓存；旧缓存不得继续展示。

