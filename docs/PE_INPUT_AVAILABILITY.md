# QQQ PE 原始输入可用性调查

## 调查边界

本调查只核对官方页面、接口说明和机器可读能力，没有下载真实行情、SEC bulk数据或CFTC数据行，也没有改变Provider启用状态。网页可见不等于存在许可明确、稳定、可自动化的机器接口；以下结论不是法律意见，正式启用仍受`docs/MARKET_DATA_USAGE_BOUNDARY.md`和Provider合规门禁约束。

## 输入状态

| 输入 | 当前结论 | 检查点B边界 |
| --- | --- | --- |
| SEC companyfacts API | 官方、免API Key、机器可读，可自动获取；需遵守SEC公平访问政策并提供可联系的User-Agent | 用户在本地配置`SEC_USER_AGENT_APP`和`SEC_USER_AGENT_EMAIL`且明确批准B后，才可由服务端受控下载 |
| SEC companyfacts bulk ZIP | 官方nightly bulk ZIP可自动获取 | 与companyfacts API相同；需缓存、限流、校验和原始/标准化分层，不提交Git |
| QQQ成分与权重 | Invesco官方产品页提供持仓展示和人工导出入口；当前未找到文档化、稳定且自动化使用条件明确的官方机器API | 由用户从官方入口人工导出后本地CSV导入，或提供其有权使用的授权CSV；禁止DOM抓取或猜测私有接口 |
| QQQ与成分股复权价格 | SEC和CFTC不提供股票复权收盘价；当前没有通过本项目许可门槛的自动价格Provider | 由用户提供从其有权使用来源导出的本地CSV，并记录来源、价格口径和日期 |
| Forward PE | 没有选定定义与许可均明确的自动来源 | 继续由用户本地人工记录，固定methodology、来源、观察日期和过期规则 |
| CFTC Nasdaq期货仓位候选 | CFTC官方TFF Futures Only数据集存在机器接口；官方报告可确认`209742`（E-mini Nasdaq-100）与`209747`（Micro E-mini Nasdaq-100）合约代码 | 本轮未下载数据行。用户需先决定目标合约或组合方法，检查点B再单独批准下载和映射 |

## 八项明确结论

1. SEC companyfacts和nightly bulk ZIP技术上可以自动获得；本轮没有下载，检查点B前仍保持禁用。
2. QQQ持仓和权重当前可采用Invesco官方页面的用户人工导出，或用户提供有权使用的授权CSV；不得把网页展示当成自动接口。
3. 已确认的官方机器来源是SEC EDGAR companyfacts/bulk和CFTC TFF数据集。当前未找到许可与稳定性均明确的Invesco QQQ持仓自动API。
4. 成分股和QQQ复权价格当前只能走用户有权使用来源的本地导出；尚无获批准的自动价格来源。
5. 仍需用户本地CSV的输入包括QQQ成分/权重、QQQ复权收盘价、成分股复权收盘价和Forward PE人工记录。
6. CFTC官方资料可以确认候选合约代码`209742`和`209747`；本轮没有读取实际TFF数据行，不能据此宣称目标序列已经完成验证。
7. 检查点B在用户批准并完成本地配置后，可考虑自动下载SEC companyfacts/bulk；CFTC TFF还需用户选择合约并单独批准。QQQ持仓/权重和价格不得自动下载。
8. 用户仍需提供：QQQ成分/权重及日期、QQQ和成分复权价格及口径/日期、Forward PE记录、SEC本地User-Agent信息，以及CFTC目标合约选择。

## 官方依据

- SEC EDGAR API与bulk ZIP说明：<https://www.sec.gov/search-filings/edgar-application-programming-interfaces>
- Invesco QQQ官方产品页：<https://www.invesco.com/us/financial-products/etfs/product-detail?productId=QQQ&ticker=QQQ>
- CFTC TFF Futures Only官方数据集：<https://publicreporting.cftc.gov/Commitments-of-Traders/TFF-Futures-Only/gpe5-46if>
- CFTC当前期货报告与合约代码：<https://www.cftc.gov/dea/futures/deacmesf.htm>
