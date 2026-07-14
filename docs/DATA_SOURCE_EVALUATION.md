# v0.3 在线市场数据源审计

审计日期：2026-07-14（Asia/Shanghai）  
审计环境：Windows PowerShell、Node.js 24.18.0；未设置 `HTTP_PROXY`、`HTTPS_PROXY` 或 `ALL_PROXY` 环境变量。  
接入门槛：定义、对象、日期、机器可读性、稳定性、许可、历史覆盖和当前服务器访问必须同时通过。

本文件是工程审计，不是法律意见。若来源条款要求书面授权，本项目在取得授权前不会自动抓取、缓存或再展示该来源的数据。

## 结论摘要

| 指标 | 首选官方来源 | 机器可读与本机访问 | 口径/历史 | 许可与再展示 | v0.3 决策 |
| --- | --- | --- | --- | --- | --- |
| VIX | Cboe `VIX_History.csv` | CSV，HTTP 200，9,227 行 | 日收盘；1990-01-02 起；覆盖全部既定范围 | Cboe 网站条款要求存储、展示前取得书面许可 | 暂不正式启用；保留受控适配器与 unavailable 状态 |
| VIX 备选 | FRED `VIXCLS` | 正式 API 需 Key；本机 CSV 下载测试超时 | 日收盘；来源仍为 Cboe | 系列标记为版权数据；FRED API 条款不覆盖原所有者权利，且禁止 API 内容缓存 | 不作为规避 Cboe 许可的替代源 |
| VXN | Cboe `VXN_History.csv` | CSV，HTTP 200，4,234 行 | 日收盘；2009-09-14 起；覆盖 10 年 | 与 VIX 相同的 Cboe 内容许可限制 | 暂不正式启用；不抓网页 DOM 或私有端点 |
| QQQ 组合 TTM PE | Invesco QQQ 官方事实表 | 公开 PDF，但当前 Windows 请求 HTTP 406；无公开稳定 CSV/JSON/API | 官方定义为 12 个月 trailing、加权调和平均 P/E；事实表有日期 | 条款禁止未经许可的重复自动访问、复制和展示 | 保留演示数据；不自动抓 PDF |
| Nasdaq-100 指数 TTM PE | Nasdaq 官方 fundamentals PDF | PDF，HTTP 200；无适合本项目的结构化历史接口 | 对象为指数而非 QQQ 基金组合 | 数据服务与持续分发通常属于授权产品；公开 PDF不等于机器再分发许可 | 仅记录候选，不与 QQQ PE 混用 |
| Forward PE | 暂无通过门槛的官方来源 | 未发现定义、历史、许可均明确的稳定接口 | FTM、NFY、指数与基金口径不能混用 | 普通财经网页不符合门槛 | 保留演示数据并标记待接入 |
| 恐慌贪婪指数 | CNN Fear & Greed 候选 | 未发现正式公开 API；网页抓取被排除 | 复合指标权重和修订依提供方 | 无明确机器再展示许可 | 保留演示数据 |
| 基金经理仓位指数 | NAAIM Exposure Index 候选 | 官方网页 HTTP 200，但没有公开机器接口 | 会员主动管理者对美股平均风险敞口；通常周频 | 官方宣布 2026-08-01 转订阅访问；网页 DOM 抓取不允许 | 保留演示数据 |

## 1. VIX

- 准确名称：Cboe Volatility Index（VIX）。
- 数据对象：由 S&P 500 指数期权价格推导的近端预期波动率指数；本项目只使用官方历史文件的日收盘值，不宣称盘中实时。
- 官方所有者/提供方：Cboe Global Markets / Cboe Exchange。
- 官方机器来源：`https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv`。
- 格式：CSV，列为 `DATE,OPEN,HIGH,LOW,CLOSE`；日期格式 `MM/DD/YYYY`；本次检查无空 `CLOSE`。
- 访问：2026-07-14 Windows 请求 HTTP 200，`text/csv`，约 470 KB，约 2.9 秒；无 `Access-Control-Allow-Origin`，因此也不应由浏览器直连。
- 历史：1990-01-02 至 2026-07-13；最近文件收盘值 17.16；支持 1m、3m、6m、1y、3y、5y、10y。
- 更新：交易日日线；响应提供 `ETag` 和 `Last-Modified`。节假日可能维持旧数据日期，必须以数据日期去重。
- 修订：官方未承诺不可修订；抓取器必须把文件视为可替换历史快照并校验日期单调性。
- Key/费用：该历史 CSV 本次访问不需要 Key；不据此推断免费再展示权。
- 许可：Cboe 条款允许个人非商业场景查看、打印和下载一份材料，但同时禁止未经书面同意的电子存储、展示、发布和分发；Cboe 的“Use of Content”页面要求事先批准并签署许可协议。
- 结论：技术、口径和历史门槛通过；许可门槛未通过。在取得书面授权前不启用自动抓取和再展示。

### FRED VIXCLS 备选

- FRED 页面确认单位为 Index、频率为 Daily Close，原始来源仍为 Cboe。
- FRED 正式 API 要求 `FRED_API_KEY`。
- FRED 明确指出第三方版权不因 API 可访问而被覆盖；`VIXCLS` 页面标记版权并要求查看分享条件。
- 当前 FRED API 条款还禁止把 API 内容存入缓存、档案或数据库，与本项目的离线缓存要求冲突。
- 当前 Windows 对 `fredgraph.csv` 的 15 秒请求超时；这不是主要阻塞，许可与缓存条款才是决定性阻塞。

## 2. VXN

- 准确名称：Cboe Nasdaq-100 Volatility Index（VXN）。
- 数据对象：由 Nasdaq-100 指数期权推导的近端预期波动率指数；使用日收盘历史。
- 官方所有者/提供方：Cboe。
- 官方机器来源：`https://cdn.cboe.com/api/global/us_indices/daily_prices/VXN_History.csv`。
- 格式：CSV，字段与 VIX 一致；本次检查无空 `CLOSE`。
- 访问：2026-07-14 Windows 请求 HTTP 200，`text/csv`，约 216 KB，约 1.0 秒；无浏览器 CORS 许可。
- 历史：2009-09-14 至 2026-07-13；最近文件收盘值 27.30；支持全部七个范围。
- Key/频率/修订：无需 Key 的日文件；以数据日期去重，不假设不可修订。
- 许可：与 VIX 相同，尚无本项目书面使用许可。
- 结论：技术、口径、日期和历史门槛通过；许可门槛未通过。不得因端点公开而视为获准再展示。

## 3. QQQ 组合 TTM PE

- 准确名称：Invesco QQQ ETF 持仓组合加权调和平均市盈率（12-month trailing）。
- 数据对象：QQQ 基金持仓组合，不是 Nasdaq-100 指数本身。
- 官方所有者/提供方：Invesco。
- 口径证据：Invesco 官方事实表把 P/E 定义为股价除以每股收益，采用 12 个月 trailing，并以 weighted harmonic average 汇总。
- 尚未确认：GAAP/调整后盈利、亏损公司在汇总中的完整处理规则、是否有连续历史修订序列。
- 获取：官方事实表为 PDF，不是稳定结构化数据接口；公开产品页和 PDF 在当前 Windows 环境均返回 HTTP 406。
- 更新：事实表按文件日期发布，属于季度/月度资料而非日频行情；即使获准接入也只能按实际文件周期检查。
- 许可：Invesco 条款仅授予个人访问；明确禁止未经许可的重复自动访问、复制及展示网站内容。
- 结论：对象和 TTM/调和平均口径得到部分确认，但机器可读稳定性、完整口径、访问和许可均未过门槛。保留演示数据，不改称 Nasdaq-100 PE，不自行用持仓与第三方 EPS 拼算。

## 4. Nasdaq-100 指数 TTM PE

- 数据对象：Nasdaq-100 Index（NDX），与 QQQ 基金组合是不同对象。
- 候选：Nasdaq 官方 `NDX_Fundamentals.pdf`，当前 Windows HTTP 200，约 4.7 MB。
- 局限：PDF提供研究材料，不是带数据日期、修订与历史查询合同的结构化接口；Nasdaq 的 GIDS/GIFFD 是正式数据交付产品，但未发现适合本项目且许可明确的免费端点。
- 结论：仅作研究候选，不接入，不与 QQQ 组合 TTM PE 拼接或替代。

## 5. Forward PE

- 必须分别描述：Forward Twelve Months、Next Fiscal Year；QQQ 基金组合、Nasdaq-100 指数；GAAP 或调整后预测；一致预期提供方。
- 本次未发现同时公开预测口径、预测提供者、数据日期、历史序列、机器接口和再展示许可的官方免费来源。
- 普通财经页面上的单点数值不可审计其一致预期口径，也不能作为历史数据源。
- 结论：卡片继续使用演示数据，标记“演示数据 / 待接入正式来源”。

## 6. 情绪与基金经理仓位候选

### 恐慌贪婪指数

- 候选对象：CNN Fear & Greed Index。
- 阻塞：没有审计到正式公开 API；页面访问/内部端点/DOM 抽取不符合本项目门槛；复合指标的成分、权重和历史修订也需要明确授权资料。
- 决策：保留演示数据。

### 基金经理仓位指数

- 候选对象：NAAIM Exposure Index。
- 定义：NAAIM 会员报告的美国股票市场平均敞口；官方强调它不是预测指标。
- 访问：官方说明页当前 Windows HTTP 200，但仅有网页展示，未发现公开 CSV/JSON/API。
- 商业状态：官方页面公告自 2026-08-01 起转为订阅访问。
- 决策：不抓网页 DOM，不绕过订阅；保留演示数据。

## 官方参考

- Cboe 历史数据：<https://www.cboe.com/us/indices/market_statistics/historical_data/>
- Cboe 网站条款：<https://www.cboe.com/terms/>
- Cboe 内容许可申请：<https://www.cboe.com/use-of-content/>
- FRED VIXCLS：<https://fred.stlouisfed.org/series/VIXCLS>
- FRED API 条款：<https://fred.stlouisfed.org/docs/api/terms_of_use.html>
- FRED 法律条款：<https://fred.stlouisfed.org/legal/terms/>
- Invesco QQQ：<https://www.invesco.com/qqq-etf/en/home.html>
- Invesco 使用条款：<https://www.invesco.com/us/en/resources/terms-of-use.html>
- Nasdaq-100：<https://indexes.nasdaq.com/Index/Overview/NDX>
- NAAIM Exposure Index：<https://naaim.org/programs/naaim-exposure-index/>

## 重新评估条件

满足任一条件后可重新评估：

1. 用户取得 Cboe 对本网站自动下载、缓存和展示 VIX/VXN 的书面许可；
2. 官方发布附带明确再展示权的公共 API 或开放许可数据集；
3. Invesco 提供定义完整、稳定机器可读且允许自动使用的 QQQ 组合估值接口；
4. 用户提供已授权的数据订阅及其许可范围，但密钥仍只通过环境变量配置。
