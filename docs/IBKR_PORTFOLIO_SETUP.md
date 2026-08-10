# IBKR 投资组合分析本机配置

本功能是只读本机分析模块：它通过 IBKR Flex Web Service v3 获取 Activity Flex Query 报告，写入 `runtime-data/portfolio-analysis/` 下的 SQLite，再由 `#/portfolio-analysis` 展示。页面没有下单、撤单、调仓、自动投资或交易接口。

## 1. 初始化本机访问密码

在项目目录执行：

```powershell
npm.cmd run portfolio:auth:init
```

密码至少 12 个字符。密码经过 scrypt 哈希后写入被 Git 忽略的 `runtime-data/portfolio-analysis/secrets/portfolio-password.json`；不要把密码写进 URL、命令行参数、日志或仓库。

## 2. 在 IBKR Client Portal 创建 Flex Query

在 IBKR Client Portal 中人工创建一个 Activity Flex Query，范围至少包含账户活动、每日 NAV/净清算值、现金流、交易、持仓和收入事件。查询应按账户 Base Currency 保留原始金额、基准金额和汇率字段（如果报告提供）。

Flex Web Service v3 使用官方两步流程：先 `SendRequest` 取得一次性报告引用，再使用 `GetStatement` 读取报告。官方说明见 [IBKR Flex Web Service](https://ibkrcampus.com/campus/ibkr-api-page/flex-web-service/) 和 [Flex Web Service v3 错误码](https://www.ibkrguides.com/orgportal/performanceandstatements/flex3error.htm)。

## 3. 保存本机 Flex 配置

推荐把人工创建的 Query ID 和临时 Flex Token 放在以下被忽略文件中：

`runtime-data/portfolio-analysis/secrets/ibkr-flex.json`

内容格式：

```json
{
  "token": "<IBKR_FLEX_TOKEN>",
  "queryId": "<IBKR_FLEX_QUERY_ID>"
}
```

也可以仅在当前 PowerShell 会话提供 `IBKR_FLEX_TOKEN` 和 `IBKR_FLEX_QUERY_ID`。程序不会把完整 URL、Token、Query ID、原始账户号或原始 Flex XML 返回给浏览器 API，也不会把它们写入日志。

## 4. 首次手动同步

```powershell
npm.cmd run portfolio:sync
```

同步失败不会清空历史。成功导入会在本机维护快照、现金流、交易、每日持仓、收入事件、每日绩效、基准和同步运行记录；重复运行按账户、日期和来源 ID 幂等更新。默认保留最近一段原始 Flex 报告在 `raw-flex/`，该目录属于运行数据，不能提交。

## 5. 启动与访问

```powershell
npm.cmd start
```

打开 `http://127.0.0.1:48101/#/portfolio-analysis`，使用第 1 步的本机密码解锁。页面只调用本站 `/api/portfolio/*` 只读 API；打开页面不会触发 IBKR 请求。

默认计划时间为 `10:30 Asia/Shanghai`，与市场数据的 `07:30` 调度独立。服务启动时会检查是否漏采；同一自然日最多一次成功同步，失败只按有限次数等待或重试，并保留已有数据库和历史页面。

## 6. 数据口径

- 净清算值、外部资金流、投资 P&L、收益率、净投入和对账差额分别保存，不把缺失字段改写为 0。
- 如果报告包含 IBKR 官方收益率，优先保存并标记 `ibkr_reported`；否则使用本地日度 Modified Dietz 近似，不能把它称为官方 TWR。
- 区间收益为有效日度收益的连乘；跨币种数据保留账户 Base Currency 和原始币种字段。
- 未实现区间贡献需要可靠的区间起点持仓配对；当前不可靠时页面明确显示“暂不提供”。
- 基准仅复用项目已有的本地 Nasdaq-100、S&P 500 和 SOXX 历史，不新增市场数据来源。

## 7. 排错边界

设置页和投资组合页会显示 `disconnected`、`sync_error`、`authentication_error`、`invalid_query`、`report_generation_pending` 等中性状态。请先检查 Query 是否仍启用、Token 是否过期、报告是否已经生成，以及本机时间和网络；不要通过网页抓取、浏览器 Cookie、私有接口或绕过 Client Portal 登录来替代 Flex Web Service。

仓库中的 `config/ibkr-flex.example.json` 只有占位符。公开仓库只允许合成审查夹具 `SIM000001`；真实账户号、Token、Query ID、SQLite、原始 Flex 报告和运行日志必须留在被忽略的本机目录。
