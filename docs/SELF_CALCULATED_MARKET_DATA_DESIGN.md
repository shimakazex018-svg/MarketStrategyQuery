# 自计算市场指标数据设计

## 路线

v0.4 当前阶段不继续 IBKR、Twelve Data 或 Alpha Vantage。系统改用“用户本地导入 + 官方公共财务/持仓数据 + 可审计派生计算”。本设计不授权自动交易、账户读取、网页抓取或第三方专有指标复制。

正式首页未来六张卡的目标定义是：自计算 QQQ 组合 TTM PE、Forward PE 人工录入、QQQ 20 日实现波动率、QQQ 波动率历史分位、自建风险偏好指数、Nasdaq 期货机构仓位代理。

统一免责声明：**自建指标，不等同于 Cboe VIX、VXN 或任何第三方专有指数。**

## 数据分层

```text
runtime-data/imports/      # 用户原始 CSV/JSON，不入 Git
runtime-data/normalized/   # 标准化记录和导入 manifest，不入 Git
runtime-data/derived/      # 派生指标结果，不入 Git
runtime-data/state/        # 调度/版本状态，不入 Git
runtime-data/logs/         # 有界日志，不入 Git
```

源文件、标准化数据和派生结果必须分开。导入 manifest 保存 SHA-256、导入时间、用户填写的数据来源、行数和校验结果；不得保存凭据。

## SEC EDGAR

允许设计使用 SEC 官方 submissions、companyfacts、companyconcept 和 nightly `companyfacts.zip`。`data.sec.gov` 的 JSON API 无需 API Key，bulk ZIP 每夜重编译。生产实现必须：

- 只由 Node 服务器访问，浏览器不直连；
- 使用 `SEC_USER_AGENT_APP` 与用户本地提供的 `SEC_USER_AGENT_EMAIL` 组成可识别 User-Agent；
- 缺少联系邮箱时保持自动下载关闭，服务仍可离线启动；
- 默认优先夜间 bulk ZIP，单公司 API 只用于补充和调试；
- 远低于 SEC 公平访问上限，不重复下载未变化文件；
- 原始 ZIP/JSON、缓存和日志全部留在 `runtime-data/`。

检查点 A 不发出 SEC 请求，只使用人工 fixture 验证字段映射、修订、季度 TTM、GAAP/IFRS、币种和拆股边界。

## CFTC COT

Nasdaq 机构仓位代理必须基于 CFTC Traders in Financial Futures（TFF）报告，因为 Asset Manager/Institutional 与 Leveraged Funds 是 TFF 分类；Legacy 报告的 Commercial/Non-Commercial 不可替代。

候选合约为 E-mini Nasdaq-100（CFTC contract market code `209742`）与 Micro E-mini Nasdaq-100（`209747`）。二者目前只是候选，不代表已选定正式序列。正式接入前还要核对 TFF futures-only 数据集中的合约名称、代码连续性、历史覆盖与修订行为。

候选计算字段：Asset Manager long/short、Leveraged Funds long/short、Total Open Interest、净头寸、净头寸占未平仓量比例及 3/5 年历史分位。数据日期和发布日期分别保存；每周最多检查一次，修订或缺失必须显式标记。

页面未来必须说明：“基于 CFTC 期货持仓分类构建的代理指标，只反映报告期货市场中的聚合头寸。”

## 本地 CSV

检查点 A 提供三个虚构模板：QQQ 成分权重、价格、Forward PE 人工记录。导入器限制文件大小、行数和字段长度；校验 UTF-8、标题、ticker、ISO 日期、正数价格、权重合计、重复记录、日期顺序和异常值。浏览器和服务端均不自动抓取模板中填写的来源页面。

## 资源边界

- CSV 第一版按有界文本解析；默认最大 2 MiB、10,000 行、单字段 4,096 字符。
- SEC bulk 文件在检查点 B 必须流式/分批处理，不能整体长期驻留内存。
- 派生结果按指标拆分，保留算法版本和覆盖率；运行数据继续由 `.gitignore` 排除。
- 单指标失败不得阻止其他指标计算或网站脱机启动。

## 官方资料

- SEC EDGAR APIs：<https://www.sec.gov/search-filings/edgar-application-programming-interfaces>
- SEC Developer Resources / Fair Access：<https://www.sec.gov/about/developer-resources>
- CFTC Commitments of Traders：<https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm>
- CFTC Public Reporting FAQ：<https://publicreporting.cftc.gov/stories/s/Public-Reporting-FAQ/inwp-fmhz/>

