# v0.3 在线市场数据 UI 评审清单

- 分支：`feature/v0.3-live-market-data`
- 页面代码提交：`ac6afc72f95a70b05bcc4649d13cfa00ead6662f`
- 截图日期：2026-07-14
- 视口：桌面 1440×900；移动端 375×812
- 正式运行状态：VIX/VXN 为 unavailable；QQQ组合TTM PE、Forward PE、恐慌贪婪指数、基金经理仓位指数为 demo。

## 文件

| 文件 | 内容 | 数据性质 |
| --- | --- | --- |
| `home-live-desktop-1440x900.png` | v0.3 首页桌面首屏 | 正式运行配置，不请求第三方 |
| `home-live-mobile-375x812.png` | v0.3 首页移动端首屏 | 正式运行配置，不请求第三方 |
| `vix-fresh.png` | VIX fresh、历史曲线和来源元数据 | UI验收夹具，非真实行情 |
| `indicator-loading.png` | VIX loading 状态 | UI验收夹具，非真实行情 |
| `indicator-stale.png` | VIX stale 与最后成功时间 | UI验收夹具，非真实行情 |
| `indicator-error.png` | VIX 无缓存失败状态 | UI验收夹具，非真实行情 |
| `indicator-demo.png` | 四张演示卡与 VIX/VXN unavailable | 正式运行配置 |
| `indicator-unavailable.png` | 正式来源暂不可用状态 | 正式运行配置 |
| `indicator-info-desktop.png` | VIX 指标说明弹窗与许可提示 | 正式运行配置 |
| `contact-sheet.png` | 上述关键画面缩略汇总 | 仅评审导航 |

## 说明

`fresh/stale/error/loading` 使用 `tests/review-server.js` 的只读本地响应生成。夹具来源在页面中明确显示为“UI验收夹具（非真实行情）”，不访问 Cboe、FRED、Invesco 或其他第三方，也不进入 `npm start` 的正式启动路径。

没有提交 `vxn-fresh.png` 或 `qqq-ttm-pe-fresh.png`：本轮审计没有确认满足再展示许可和数据口径门槛的正式来源，不能用测试值冒充正式接入。
