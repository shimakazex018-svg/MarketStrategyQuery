# v0.4 自计算指标 MVP 视觉验收清单

> UI验收合成夹具，非真实市场数据。

- 生成日期：2026-07-15
- 页面功能提交：`2fab39a`（`feat: integrate self-calculated indicators`）
- 验收夹具提交：`c41a028`（`test: cover provisional market data workflows`）
- 浏览器：Codex 应用内浏览器
- 正式启动路径：未使用验收夹具；正式服务无本地输入时六张卡均为 `unavailable`
- 数据边界：截图中的数值、日期、曲线、来源名称和覆盖率均为UI状态合成数据，只用于验证布局与状态表达，不代表真实市场行情或投资结论

| 文件 | 视口/区域 | 验收内容 |
| --- | --- | --- |
| `home-desktop.png` | 请求视口 1440×900 | 首页首屏、导航、周期入口；PNG为浏览器内容区尺寸 |
| `home-mobile.png` | 请求视口 375×812 | 移动导航与首页首屏；PNG为浏览器内容区尺寸 |
| `pe-fresh-or-provisional.png` | 桌面指标首行 | QQQ组合TTM PE双口径、Forward PE、QQQ RV20 |
| `pe-quality-warning.png` | 桌面指标首行 | `provisional` 与 `quality_warning` 同时显示 |
| `volatility.png` | 桌面指标首行 | QQQ RV20曲线与实际可用范围控件 |
| `risk-appetite-partial.png` | 桌面指标第二行 | 风险偏好5/7部分覆盖的 `provisional` 表达 |
| `cot-positioning.png` | 桌面指标第二行 | CFTC TFF仓位代理卡；仅为合成夹具 |
| `forward-pe-manual.png` | 桌面指标首行 | Forward PE人工录入状态；仅为合成夹具 |
| `insufficient-coverage.png` | 桌面指标首行 | 覆盖不足时不输出PE、不以0代替缺失值 |
| `contact-sheet.png` | 汇总 | 上述截图的缩略总览 |

浏览器验收同时覆盖：375×812、768×1024、1024×1366、1440×900无页面级横向溢出；深浅主题；首页、阶段详情、期权工具、阶段对比、指标说明与PE详情；指标弹窗Escape关闭及焦点返回；控制台0错误。
