# 最新交接

## 当前状态

- 当前开发分支为`main`，稳定标签仍为`v0.4.0`；本轮按用户要求直接在main新增回撤分析，不创建功能分支、worktree或标签。
- v0.5正式范围固定为`nasdaq100_pe`、`sp500_pe`、`vix`、`vxn`、`nasdaq100_index`、`sp500_index`六项，不补采或展示Forward PE、ETF价格与机构仓位代理。
- 首页只显示六张真实数据卡；`#/drawdown-analysis`只使用Nasdaq-100与S&P 500指数完整日频历史，支持七个快捷范围、自定义日期、阈值、排序、回撤事件、分布、年度收益和归一化对比。
- 真实数据只位于被Git忽略的`runtime-data/`；源码、测试和文档不包含真实数值、真实序列、原始响应、内容哈希或机器信息。

## 正式数据流

- `tools/market-data/import-successful-data.js`离线读取六项已成功规范化数据并原子写入`runtime-data/market-data/production/`；不发网络请求，可重复执行且相同数据不重复写入。
- `FredProvider`和`WorldPERatioProductionProvider`通过现有`MarketDataService`生成六项模型；单项失败只把受影响指标标记为stale并保留最后成功缓存。
- 每日更新保持Asia/Shanghai 07:30；同一来源当日成功后不重复请求，只有超时或5xx允许一次延迟重试。
- history API支持`range=ALL`完整已校验序列供回撤分析一次读取；其他页面仍使用既有有界历史响应。API不返回本地路径、哈希、原始正文或错误堆栈。

## 验证边界

- 自动测试只使用合成fixture；常规测试不得运行隔离实验真实采集入口。
- 真实页面视觉验收截图不得进入Git，本轮截图位于Git工作树外。
- 27个`core-data-acquisition`与`eodhd`实验文件继续保持未跟踪、未修改、未暂存、未接入正式服务。
- 旧自计算模块只作历史兼容，不在首页、正常导航或正式六指标调度路径中出现。

## 下一步

1. 回撤分析已完成133项自动测试与1440×900、768×1024、390×844浏览器验收；真实iPad/iPhone硬件触摸仍需用户在目标设备确认。
2. 48101使用当前项目`server.js`并已验证健康检查、两条指数完整历史和主要页面；不要无理由重启或误杀其他Node进程。
3. 本轮未访问Invesco、Yahoo、Stooq、Twelve Data、EODHD、CFTC或其他外部来源。
4. 未经新授权，不恢复Forward PE、QQQ/SPY/SOXX价格、机构仓位代理或其他指标工作；下一轮若接入真实ETF价格必须重新完成来源、许可、字段和访问门槛评审。
