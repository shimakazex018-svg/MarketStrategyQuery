# 自计算 QQQ 组合 TTM PE 规格

## 定位与边界

本指标是基于用户提供的 QQQ 成分、权重和价格，以及 SEC EDGAR 财务事实计算的组合估值代理。它不等同于 Invesco 官方 QQQ PE、Nasdaq-100 官方 PE 或任何供应商专有指标，也不能被描述为实时数据。

检查点 A 只使用虚构小样本 fixture 验证计算内核，不下载 SEC bulk 文件、不请求约 100 家公司的网络数据，也不修改正式首页卡片。

## 输入与血缘

每个成分至少保存：ticker、权重、权重日期、价格、价格日期、价格口径、TTM EPS 或 TTM 归母净利润、稀释股数、币种、使用的 XBRL 标签、报告期、表单、filing accession、是否回退映射和置信度。

价格默认口径为复权收盘价。若价格币种与财务币种不一致，且没有明确汇率和汇率日期，该成分不得进入计算。

## SEC 字段优先级

字段映射必须可配置，并保留实际命中的 taxonomy/tag：

| 目的 | US GAAP 优先级 | IFRS 回退候选 |
| --- | --- | --- |
| 归母普通股净利润 | `NetIncomeLossAvailableToCommonStockholdersBasic` → `NetIncomeLoss` → `ProfitLoss` | `ProfitLossAttributableToOwnersOfParent` → `ProfitLoss` |
| 稀释加权平均股数 | `WeightedAverageNumberOfDilutedSharesOutstanding` | `WeightedAverageNumberOfSharesOutstandingDiluted` |
| 稀释每股收益 | `EarningsPerShareDiluted` | `DilutedEarningsLossPerShare` → `BasicAndDilutedEarningsLossPerShare` |

同一报告期出现重复或修订时，以较晚 filed 日期为优先，并保留被替换 accession 的诊断记录。10-K 年度事实不得与覆盖同一期间的四个离散 10-Q 季度重复相加。

## TTM 组合

优先使用最近四个不重叠、可识别为离散季度的事实求和。年度事实只作为回退或桥接输入，不与已覆盖的季度重复计算。拆股后的每股事实必须使用申报者已重述口径，或通过显式拆股调整元数据统一口径；不得默默混合拆股前后 EPS。

## 方法 A：加权盈利收益率

对成分 `i`：

```text
earningsYield_i = TTM_EPS_i / Price_i
portfolioEarningsYield = Σ(weight_i × earningsYield_i)
portfolioPE = 1 / portfolioEarningsYield
```

变量：

- `weight_i`：成分在同一权重日期的十进制权重；
- `TTM_EPS_i`：统一拆股口径、最近十二个月稀释 EPS；
- `Price_i`：与权重/财务币种兼容的正数价格；
- `portfolioPE`：组合盈利收益率的倒数。

该方法与 QQQ 组合权重直接一致，但对亏损公司和极小分母敏感。

## 方法 B：覆盖样本总市值 / 总盈利

```text
marketCap_i = Price_i × DilutedShares_i
aggregatePE = Σ(marketCap_i) / Σ(TTMNetIncome_i)
```

变量：

- `DilutedShares_i`：最近可用的稀释股数口径；
- `TTMNetIncome_i`：与股数和币种兼容的 TTM 归母净利润。

该方法衡量覆盖样本公司的聚合市值/盈利，不严格复现 QQQ 权重；若样本不全、股数口径不同或真实指数采用其他自由流通调整，会产生系统偏差。因此它只用于与方法 A 比较，不可命名为官方指数 PE。

## 亏损公司版本

两种方法都输出候选诊断：

- `including_losses`：保留负盈利或负盈利收益率；
- `excluding_losses_renormalized`：排除亏损公司，并对剩余权重重新归一化（方法 A）或排除其市值与盈利（方法 B）。

页面未来必须明确展示所用版本。默认版本尚未由用户确认，检查点 A 不作产品默认选择。

## 覆盖率与拒绝条件

第一版正式输出门槛：

- 财务数据覆盖权重至少 90%；
- 价格覆盖权重至少 95%；
- 权重日期明确；
- 输入币种一致；
- 结果为有限正数，分母不得接近零。

任一门槛不满足时，状态必须为 `insufficient_coverage`，正式 `value` 为 `null`。诊断可以保留候选原始结果，但不得沿用旧值并标记 `fresh`。

## 小样本输出

fixture 使用 5 至 10 个虚构成分，并输出每个成分的权重、价格、TTM EPS/净利润、盈利收益率、贡献、是否亏损以及缺失/异常原因。小样本结果只证明算法行为，不代表 QQQ 当前估值。

