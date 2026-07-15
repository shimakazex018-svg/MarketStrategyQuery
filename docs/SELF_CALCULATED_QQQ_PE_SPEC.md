# 自计算 QQQ 组合 TTM PE 规格

## 定位与边界

本指标是基于用户提供的 QQQ 成分、权重和价格，以及 SEC EDGAR 财务事实计算的组合估值代理。对外提供“自计算QQQ组合TTM PE”和“稳健QQQ组合TTM PE”两个口径；与PE有关的正式首页卡未来只显示这两个口径。它们不等同于Invesco官方QQQ PE、Nasdaq-100官方PE或WorldPEratio指标，也不声称复制WorldPEratio的具体算法，不能被描述为实时数据。

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

## 原始PE：`PE-Q1-RAW-v1`

对成分 `i`：

```text
earningsYield_i = TTM_EPS_i / Price_i
portfolioEarningsYieldRaw = Σ(weight_i × earningsYield_i)
rawPE = 1 / portfolioEarningsYieldRaw
```

变量：

- `weight_i`：成分在同一权重日期的十进制权重；
- `TTM_EPS_i`：统一拆股口径、最近十二个月稀释 EPS；
- `Price_i`：与权重/财务币种兼容的正数价格；
- `rawPE`：组合盈利收益率的倒数。

原始PE保留正盈利和负盈利，不因单只公司PE过高而删除成分。输入权重整体不为1时，只按全部输入总权重做一次比例归一化；缺失或异常成分的权重不分配给其他公司。组合盈利收益率小于等于0时`rawPE=null`；绝对值不超过`denominatorEpsilon`时增加`unstable_denominator`。

## 稳健PE：`PE-Q1-ROBUST-WMAD4-v1`

稳健处理只在盈利收益率E/P层执行，不截断或排序单只股票PE，不删除成分，也不改变其权重：

1. 对全部有效成分计算`earningsYield_i`；
2. 计算加权中位数`weightedMedianEarningsYield`；
3. 计算`weightedMAD = weightedMedian(abs(earningsYield_i - weightedMedianEarningsYield))`；
4. `robustScale = 1.4826 × weightedMAD`；
5. `lowerBound = weightedMedianEarningsYield - 4 × robustScale`；
6. `upperBound = weightedMedianEarningsYield + 4 × robustScale`；
7. `adjustedEarningsYield_i = clamp(earningsYield_i, lowerBound, upperBound)`；
8. `portfolioEarningsYieldRobust = Σ(weight_i × adjustedEarningsYield_i)`；
9. `robustPE = 1 / portfolioEarningsYieldRobust`。

普通亏损公司继续参与；只有低于下边界的极端负盈利收益率才被压缩。`affectedConstituents`记录ticker、权重、原始/调整后盈利收益率、方向和原因。组合盈利收益率小于等于0时`robustPE=null`。

## 稳健方法不可用

以下任一条件成立时，不使用固定PE阈值或其他静默回退，`robustPE=null`并标记`robust_method_unavailable`：

- `weightedMAD=0`；
- 有效成分少于20；
- 中位数、MAD或边界无法计算；
- EPS或价格存在非有限数。

覆盖样本总市值/总盈利的旧原型保留为legacy诊断，不是正式第三口径。排除全部亏损公司并重归一化的结果只输出`excludeLossDiagnosticPE`，不作为正式首页第三张指标卡。

## 输出契约

至少输出：`rawPE`、`robustPE`、`excludeLossDiagnosticPE`、两个组合盈利收益率、两个算法版本、weighted median/MAD、上下界、极值数量/权重、亏损数量/权重、财务/价格覆盖权重、受影响成分和`qualityFlags`。另输出`rawStatus`与`robustStatus`，避免原始PE可用但稳健方法不可用时混淆。

## 覆盖率与拒绝条件

第一版正式输出门槛：

- 财务数据覆盖权重至少 90%；
- 价格覆盖权重至少 95%；
- 权重日期明确；
- 输入币种一致；
- 最终盈利收益率为有限数；
- 检查点B正式全量阶段有效成分至少80；
- 极值处理权重不超过10%。

覆盖、日期、币种、正式成分数或分母门槛不满足时状态为`insufficient_coverage`。极值处理权重超过10%时仍输出诊断结果，但状态为`quality_warning`、不得为`fresh`，并提示检查字段映射、拆股、币种、TTM拼接和真实市场异常。

## 小样本输出

原始兼容测试保留6成分fixture；稳健方法使用独立30成分纯虚构fixture，覆盖正/负极值、普通亏损、多个/大权重极值、MAD为0、小于20成分、近零/负分母、权重缩放、顺序不变性、非有限输入和拆股错误。fixture结果只证明算法行为，不代表QQQ当前估值。
