# HANDOFF

## Last Completed Task

完成v0.4“自计算市场指标系统”检查点A：路线调整、离线导入、SEC/PE计算、实现波动率与分位、等权风险偏好、CFTC候选仓位、Forward PE人工结构和边界测试。没有修改正式首页、没有全量抓取。

## Current State

- 当前分支：`feature/v0.4-compliant-market-data-waterfall`。
- 稳定基线仍为`main@e8290d89416cd2f7915ed648f15f08d9fa71117c` / `v0.3.0`；当前分支未合并main。
- IBKR：`not_tested`、`pending_written_confirmation`、`not_selected_by_owner`、`enabled=false`。
- Twelve Data与Alpha Vantage：`not_evaluated`、`deferred`、`enabled=false`。
- Cboe保持待书面确认和禁用；没有新的真实数据来源被启用。
- 正式首页仍是v0.3六卡；新六项定义仅存在于规格和计算内核，等待检查点B。

## Implemented Boundaries

- CSV默认最大2 MiB、10,000行、单字段4,096字符；原始文件hash、导入时间、来源与行数进入manifest。
- QQQ PE正式门槛：财务覆盖权重90%、价格覆盖权重95%、权重日期明确、币种一致、结果有限正数。
- PE不选择默认算法或亏损版本；风险偏好只实现`RISK-APPETITE-v1-EW`，最终权重未审定。
- SEC/CFTC本轮只有设计与虚构fixture；没有网络请求、真实缓存或运行数据提交。

## Validation

- 官方Node.js 24.18.0 LTS与npm 11.16.0已安装到用户本地程序目录并加入用户PATH。
- `npm.cmd run check`通过42项测试、0失败；固定9阶段、8期权、6个现有指标、7范围不变。
- 没有UI变化，不需要截图；v0.3视觉归档未修改。

## Decisions Required Before Checkpoint B

1. QQQ PE正式默认使用哪种算法，以及包含亏损还是排除亏损并重归一化；
2. 风险偏好最终分项映射、权重和最低覆盖率；
3. CFTC TFF选择`209742`、`209747`或明确组合方法；
4. 用户提供QQQ成分/权重日期、QQQ及成分复权价格、Forward PE人工记录；
5. 用户提供本地`SEC_USER_AGENT_APP`和`SEC_USER_AGENT_EMAIL`后，才允许SEC自动下载；
6. 检查点B是否批准使用SEC nightly companyfacts bulk ZIP和CFTC官方PRE数据。

## Next Task Boundary

在用户验收检查点A前停止。不得进入全量SEC/CFTC数据、正式首页六卡、图表、移动端或截图工作；不得恢复IBKR、Twelve Data或Alpha Vantage，也不得合并main。
