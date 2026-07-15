# 自建风险偏好指数规格

## 定位

页面目标名称为“自建风险偏好指数”。它是透明、可解释的 0—100 组合评分，不使用机器学习，不等同于 CNN Fear & Greed Index、VIX、VXN 或任何第三方专有指数。

## 等权原型

检查点B正式算法版本为`RISK-APPETITE-v1-EW`，底层线性映射版本为`RISK-SIGNAL-MAPPINGS-v1-LINEAR`。七个分项为：

1. QQQ 价格相对 200 日均线；
2. QQQ 20 日与 120 日动量；
3. QQQ 距离 52 周高点；
4. QQQ 最大回撤；
5. RV20 水平与历史分位；
6. SOXX 相对 QQQ 强弱；
7. Nasdaq 期货机构仓位代理。

每项先由独立、版本化的转换规则映射为 0—100。100 始终代表更强风险偏好；对于波动率、回撤等“数值越高风险偏好越弱”的输入，在聚合前反向转换。

## 聚合与缺失

```text
availableScore_i = directionAdjusted(score_i)
weight_i = 1 / availableComponentCount
totalScore = Σ(weight_i × availableScore_i)
coverage = availableComponentCount / 7
```

缺失分项不填 0、不用模拟值补齐；只在可用分项之间等权重归一化，并显示缺失项。首版内核要求至少 5/7 分项可用，否则状态为 `insufficient_coverage`，`value` 为 `null`。

## 输出

结果至少包含：总分、每个分项原始分、方向调整后分数、实际权重、对总分的贡献、算法版本、输入日期、计算时间、数据覆盖率、缺失项和状态。

## 后续校准（不阻塞检查点B）

- 七个原始分项各自最终映射阈值；
- 是否保留等权作为正式版本；
- 最低覆盖率与状态文案；
- CFTC 代理指标在正式权重中的上限。

在用户审定前不得用历史拟合结果擅自优化权重，也不得将该指数用于自动判断市场阶段或自动仓位建议。
