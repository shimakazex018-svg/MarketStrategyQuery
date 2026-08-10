# IBKR Flex 诊断边界

本模块只读使用 IBKR Flex Web Service v3。凭据只从本机忽略的运行时 secret 或进程环境读取；凭据、ReferenceCode、原始 XML、账户标识、金额和持仓不会写入公开仓库。

## 请求阶段

每次同步运行记录以下脱敏阶段：

- `send_request`：HTTP 状态、Content-Type、响应字节数、响应格式、根标签、Status、IBKR 错误码是否存在、ReferenceCode 是否存在。
- `get_statement`：同上，并记录实际外部请求计数。
- `parse_response`：XML/HTML/CSV/TEXT 分类和解析结果。
- `validate_statement`：CORE 字段校验结果。
- `import_database`：SQLite 导入结果。

诊断只保存字段名、类别、计数、日期范围和布尔状态，不保存响应正文、错误原文、Query ID、Token、账户号或金额。

## 当前 CORE 映射

CORE 需要账户标识、基准货币、日期、NAV/净清算价值和外部现金流路径。Flex 的 `EquitySummaryInBase` / `EquitySummaryByReportDateInBase` 映射为 NAV 快照，`AccountInformation.currency` 映射为基准货币，`CashTransactions` 提供现金流路径；`Trades` 和 `OpenPositions` 可选导入。收入和 IBKR 报告绩效段缺失时只产生 warning，不阻断 CORE 导入。

真实响应结构审计只写入忽略的 `runtime-data/portfolio-analysis/audit/flex-capability.json`。公开测试使用从零生成的 `synthetic-review-fixture`，账户标识仅使用明显虚构值。

## 请求安全

客户端使用动态 `Node.js/<process.versions.node>` User-Agent、严格的 v3 `SendRequest` / `GetStatement` 参数、手动重定向校验和单次受控同步。HTML、CSV、TEXT 和不受信任重定向均拒绝；官方错误码只保存为类别和数字代码。

同步调度器同一 Asia/Shanghai 本地日只自动尝试一次，失败不会每分钟重试；需要重新验证时由操作者明确运行一次手动同步。
