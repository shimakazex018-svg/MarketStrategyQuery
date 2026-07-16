# WorldPEratio 公开网页数据源审计

审计日期：2026-07-15（Asia/Hong_Kong）

用途边界：仅用户本人、非商业研究、本机/家庭 LAN/私人 ZeroTier；不公开注册、不提供第三方 API 或原始数据下载、不镜像网站。

结论：`pending_written_confirmation`；技术原型可以保留，但正式自动请求、缓存和内部展示均保持禁用。

本文件是工程与使用边界审计，不是法律意见。页面公开和 robots 允许索引不等于网站正式授权自动采集、缓存或再展示。

## 审计摘要

| 检查项 | 结果 |
| --- | --- |
| 网站根地址 | <https://worldperatio.com/> |
| `robots.txt` | 2026-07-15 以固定可识别 User-Agent 请求，HTTP 200；`User-agent: *` 的 `Disallow` 为空，目标路径未被禁止；声明 sitemap 为 `http://worldperatio.com/sitemap_index.xml` |
| sitemap | <https://worldperatio.com/sitemap_index.xml> HTTP 200，指向 `page-sitemap.xml`；页面 sitemap 列出首页、Privacy、About、Contact、Major Indices 等 8 个公开页面 |
| Terms / Terms of Use | sitemap、网站页脚和站内定向搜索均未发现 Terms、Terms of Use 或同类页面；这只能记为“未发现”，不能解释为授权 |
| Privacy Policy | <https://worldperatio.com/privacy-policy/>；说明 Cookie、Google AdSense/Analytics 等隐私事项，没有给出自动采集、缓存或展示许可 |
| About / Methodology | <https://worldperatio.com/about-us/> 说明站点用途；目标页直接公开简短统计方法说明 |
| 登录/订阅 | 目标页 HTTP 200；未见登录、订阅或付费墙要求 |
| 验证码/挑战 | 本次普通 HTTP 请求未见验证码或 Cloudflare 挑战 |
| CSV/JSON/API | 未发现目标 Nasdaq-100 PE 的公开 CSV、下载文件或文档化 API |
| 页面自身结构化请求 | HTML 宣告 WordPress REST API；`/wp-json/wp/v2/pages/24` HTTP 200，但该记录实际是 `area` 页面，不含 Nasdaq-100 或当前 PE，不能当作目标结构化数据源 |
| HTML/JavaScript | <https://worldperatio.com/index/nasdaq-100/> 服务器直接返回包含目标数值和日期的 HTML；无需执行 JavaScript。审计文档不记录真实响应大小、页面哈希、页面片段或市场数值 |
| 搜索引擎索引 | robots 未禁止，Yoast sitemap 公开，目标页可由普通搜索引擎检索；只能说明技术可索引性 |
| 自动化/保存限制 | 未发现明确禁止，也未发现明确允许自动化、保存、复制或内部展示的条款 |

## 目标对象结论

目标页面标题为“Nasdaq 100 Index: current P/E Ratio”，并明确写明该 P/E 是基于以 Nasdaq-100 为基准的 QQQ ETF 计算。因此它可以被描述为“WorldPEratio 的 Nasdaq-100/QQQ 外部参考 PE”，但不能描述为 Nasdaq 官方指数 PE、Invesco 官方 QQQ PE 或本站自计算 PE。

本次页面公开展示了：

- 当前 PE 与明确日期；
- 1 至 20 年各期平均值、标准差、标准差区间和估值标签，其中 Provider 第一版只映射当前 PE 与 5 年平均/标准差，其他期限保留在 `historicalRanges`；
- 5/10/20 年估值标签和趋势信息。

本次未发现或不应提取：

- 历史中位数、历史最高/最低；
- Forward PE；
- 原始数据来源、成分盈利口径、修订规则和更新时间承诺；
- 可下载的完整历史 PE 序列。

缺失字段必须保持 `null`，不得根据图表、区间或其他字段反推。

## 极值算法核对

目标页只公开以下说明：平均 PE 与标准差在排除最高 10% 和最低 10%（合计 20%）的观察值后计算；PE 大于 70 或低于 1 时进行“logarithmically normalized”以减少扭曲。

未公开的信息包括：

- Trim 与对数处理的先后顺序；
- 对数公式、底数、回到 PE 尺度的方法；
- 均值与标准差是在原尺度还是对数尺度计算；
- PE 等于 0 或为负时的处理；
- 分位边界、样本频率、缺失与修订处理。

因此本项目不声称完全复刻该算法。WorldPEratio 处理的是历史时间序列；本站 `PE-Q1-ROBUST-WMAD4-v1` 处理的是 QQQ 成分股盈利收益率横截面，两者对象、尺度和目的不同，不得混用。

## 合规与接入决定

状态为 `pending_written_confirmation`，理由如下：

1. robots 允许且页面无需登录，是技术与风险降低因素；
2. 用户限定为每天至多一次、个人非商业内部使用，不公开、不转发、不保存整页；
3. 但网站没有可识别的使用条款，也没有明确授予自动读取、缓存最终数据或内部网页展示的权利；
4. 现有项目决策要求许可门槛优先于 HTTP 可访问性。

在 WorldPEratio 书面确认以下用途前，`config/market-data-providers.json` 必须保持 `enabled=false`、`conditionsSatisfied=false`：每天一次自动读取公开 Nasdaq-100 页面、失败最多延迟重试一次、只保存最终提取字段/日期/URL/页面哈希、仅本人内部网页展示。

## 原型边界

- 普通 HTTP 已能获得目标字段，浏览器自动化不需要且不启用。
- 原型固定目标主机、固定可识别 User-Agent、连接 10 秒/总计 20 秒超时、750 KB 响应上限。
- 403、429、登录、验证码、目标变化、日期缺失、数值冲突立即停止；不切换 User-Agent。
- 每日正常请求最多 1 次，只有网络/连接/总超时或普通 HTTP 错误允许延迟重试 1 次；每日总请求最多 2 次。
- 只保存提取 JSON、HTTP 状态、来源 URL、日期、页面 SHA-256、字段片段 SHA-256、解析版本与最后错误；不保存完整 HTML、JavaScript、图片、广告或追踪脚本。
- Provider 不加入调度，不修改正式首页，不覆盖 `PE-Q1-RAW-v1` 或 `PE-Q1-ROBUST-WMAD4-v1`。

## 审计地址

- <https://worldperatio.com/>
- <https://worldperatio.com/robots.txt>
- <https://worldperatio.com/sitemap_index.xml>
- <https://worldperatio.com/page-sitemap.xml>
- <https://worldperatio.com/major-stock-index-pe-ratios/>
- <https://worldperatio.com/index/nasdaq-100/>
- <https://worldperatio.com/about-us/>
- <https://worldperatio.com/privacy-policy/>
- <https://worldperatio.com/contact/>
- <https://worldperatio.com/wp-json/wp/v2/pages/24>
