# HANDOFF

## Last Completed Task

完成检查点A.1原始与稳健QQQ TTM PE双口径：`PE-Q1-RAW-v1`保留全部正负盈利，`PE-Q1-ROBUST-WMAD4-v1`在E/P层按weighted median/MAD和4倍稳健尺度Winsorize。旧方法B已明确为覆盖公司完整总市值/完整净利润诊断，不是QQQ组合PE。没有修改正式首页、读取真实数据或进入全量计算。

## Current State

- 当前分支：`feature/v0.4-compliant-market-data-waterfall`。
- 稳定基线仍为`main@e8290d89416cd2f7915ed648f15f08d9fa71117c` / `v0.3.0`；当前分支未合并main。
- IBKR：`not_tested`、`pending_written_confirmation`、`not_selected_by_owner`、`enabled=false`。
- Twelve Data与Alpha Vantage：`not_evaluated`、`deferred`、`enabled=false`。
- Cboe保持待书面确认和禁用；没有新的真实数据来源被启用。
- 正式首页仍是v0.3六卡；新六项定义仅存在于规格和计算内核，等待检查点B。
- 与PE有关的未来正式首页卡只显示原始PE和稳健PE；排除全部亏损的`excludeLossDiagnosticPE`和旧完整公司总市值/总盈利算法仅供内部诊断。

## Implemented Boundaries

- CSV默认最大2 MiB、10,000行、单字段4,096字符；原始文件hash、导入时间、来源与行数进入manifest。
- QQQ PE门槛：财务覆盖权重90%、价格覆盖权重95%、权重日期明确、币种一致、盈利收益率有限；正式全量有效成分至少80，极值处理权重不超过10%。
- 稳健法MAD为0、有效成分少于20、边界不可计算或出现非有限输入时标记`robust_method_unavailable`，不使用固定PE阈值回退。
- PE结果输出价格/财务/权重日期血缘、原始与稳健分母稳定性、WMAD4边界、极值权重和两口径差值；正式输入必须显式提供日期。
- 风险偏好只实现`RISK-APPETITE-v1-EW`，最终权重未审定。
- SEC/CFTC本轮只有设计与虚构fixture；没有网络请求、真实缓存或运行数据提交。
- 输入状态见`docs/PE_INPUT_AVAILABILITY.md`：SEC可在批准B及配置User-Agent后受控自动下载；CFTC需先选定合约；QQQ权重和复权价格仍需用户本地CSV。

## Validation

- 官方Node.js 24.18.0 LTS与npm 11.16.0已安装到用户本地程序目录并加入用户PATH。
- 官方便携Node.js 24.18.0与npm 11.16.0执行`npm.cmd run check`通过53项测试、0失败；QQQ PE专项18项通过，固定9阶段、8期权、6个现有指标、7范围不变。
- 30成分基线fixture：rawPE与robustPE均为16.438356，weighted median为0.0625、weighted MAD为0.0375、边界为[-0.15989, 0.28489]，极值权重0。
- 单个极端正盈利：rawPE 11.152416、robustPE 15.190719，受影响权重3.3333%；单个极端亏损：rawPE 35.087719、robustPE 17.697967，受影响权重3.3333%。
- 大权重极值：rawPE 3.336185、robustPE 7.084211，受影响权重25.6410%，状态`quality_warning`而不是`fresh`。
- 没有UI变化，不需要截图；v0.3视觉归档未修改。

## Decisions Required Before Checkpoint B

1. 风险偏好最终分项映射、权重和最低覆盖率；
2. CFTC TFF选择`209742`、`209747`或明确组合方法；
3. 用户提供QQQ成分/权重日期、QQQ及成分复权价格、Forward PE人工记录；
4. 用户提供本地`SEC_USER_AGENT_APP`和`SEC_USER_AGENT_EMAIL`后，才允许SEC自动下载；
5. 检查点B是否批准使用SEC nightly companyfacts bulk ZIP和CFTC官方TFF数据。

## Next Task Boundary

在检查点A.1结束后停止。不得进入全量SEC/CFTC数据、正式首页六卡、图表、移动端或截图工作；不得恢复IBKR、Twelve Data或Alpha Vantage，也不得合并main。
