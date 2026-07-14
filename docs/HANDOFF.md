# 项目交接

## 当前状态

- 稳定版本：`main` 上的 `v0.2.0`，提交 `160345eeeefca763b05233fdae76a43025a85516`。
- 开发分支：`feature/v0.3-live-market-data`，尚未合并、尚未创建 v0.3 标签。
- 技术栈：原生 HTML/CSS/JavaScript、JSON、Node.js 原生 HTTP，无第三方运行依赖。
- 默认地址：`0.0.0.0:48101`；本机访问 `http://127.0.0.1:48101`。

## v0.3 实现状态

数据源审计、市场数据基础设施、六种前端状态和异常测试已经完成。Cboe VIX/VXN 官方 CSV 在 Windows 实测可访问，但公开条款没有确认本网站缓存和再展示许可；Invesco QQQ组合TTM PE 没有找到同时满足机器接口、口径和许可的来源。因此当前没有真实指标正式上线：VIX/VXN 为 unavailable；QQQ组合TTM PE、Forward PE、恐慌贪婪指数和基金经理仓位指数为 demo。

浏览器只请求本站 `/api/market-data/*`。默认许可开关关闭，服务可以完全断网启动；缓存损坏按指标隔离，未获许可时不会展示旧在线缓存。若未来获得 Cboe 授权，可在部署环境显式设置 `CBOE_DATA_LICENSE_CONFIRMED=true`，但启用前仍应复核条款和实际请求结果。

## 资源边界

- 单指标每日最多 4 次外部请求；失败重试间隔为 15、60、180 分钟。
- 单提供方每日最多 20 次请求；手动刷新冷却 30 分钟并使用并发锁。
- VIX 07:10、VXN 07:15（Asia/Shanghai）检查，周末跳过。
- 历史 API 最多返回 240 点；缓存原子写入，日志和可选原始响应有界。
- QQQ PE 未来必须按实际来源频率调度，不能对月度文件进行每日抓取。

## 验证与验收

运行 `npm.cmd run check`。启动后检查 `/api/health`、`/api/market-data/indicators`、首页、阶段详情、阶段对比、期权工具和指标说明，以及 375、768、1024、1440 四类宽度。浏览器截图位于 `previews/review-v0.3-live-market-data/`；fresh/stale/error/loading 截图来自 `tests/review-server.js`，画面来源明确标注“UI验收夹具（非真实行情）”。

## 已知边界与下一步

- 真实 iPhone/iPad 触摸、目标局域网、ZeroTier 和 Windows 防火墙仍需用户侧复验。
- Cboe 许可、QQQ PE 正式机器来源和其余三类候选指标仍待外部确认。
- 本轮没有自动判断市场阶段、自动仓位建议、IBKR、数据库、登录、回测或自动交易。
- 用户验收 v0.3 分支后再决定是否合并 main；不要自行合并或创建 `v0.3.0` 标签。
