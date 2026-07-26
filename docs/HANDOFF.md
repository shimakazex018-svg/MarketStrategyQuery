# 最新交接

## 当前状态

- 当前开发分支为`main`，稳定标签仍为`v0.4.0`；本轮按用户要求直接在main接入SOXX回撤分析，不创建功能分支、worktree或标签。
- v0.5首页和公开摘要仍固定为`nasdaq100_pe`、`sp500_pe`、`vix`、`vxn`、`nasdaq100_index`、`sp500_index`六项；SOXX仅为隐藏分析指标。
- `#/drawdown-analysis`使用Nasdaq-100、S&P 500与可用SOXX完整日频历史，支持主/对比对象、七个快捷范围、自定义日期、阈值、排序、回撤事件、分布、年度收益和归一化对比。
- 回撤页两张SVG图使用共享`selectedChartDate`日期游标；日期只从完整有效交易日序列二分吸附，交互层只更新虚线、点标记和Tooltip，并在路由切换、重渲染、失焦和取消时清理监听器与待执行动画帧。
- 真实数据只位于被Git忽略的`runtime-data/`；源码、测试和文档不包含真实数值、真实序列、原始响应、内容哈希或机器信息。

## 正式数据流

- `tools/market-data/import-successful-data.js`离线读取六项已成功规范化数据并原子写入`runtime-data/market-data/production/`；不发网络请求，可重复执行且相同数据不重复写入。
- `FredProvider`和`WorldPERatioProductionProvider`通过现有`MarketDataService`生成六项模型；单项失败只把受影响指标标记为stale并保留最后成功缓存。
- `tools/market-data/import-soxx-history.js`把runtime-data内的官方SpreadsheetML或明确口径CSV原子导入`production/etf/soxx.json`；`EtfPriceProvider`只读取本地文件，不发网络请求。
- 每日更新保持Asia/Shanghai 07:30；六项既有来源规则不变，SOXX步骤只重载本地文件，不访问iShares/BlackRock。
- history API支持`range=ALL`完整已校验序列供回撤分析一次读取；其他页面仍使用既有有界历史响应。API不返回本地路径、哈希、原始正文或错误堆栈。

## 验证边界

- 完整检查为149项测试通过、0失败；数据、语法和diff检查通过。视觉验收使用工作树外的合成夹具截图，覆盖桌面、iPad、iPhone与SOXX不可用状态；真实iPad/iPhone硬件触摸仍待目标设备人工验收。
- 自动测试只使用合成fixture；常规测试不得运行隔离实验真实采集入口。
- 真实页面视觉验收截图不得进入Git，本轮截图位于Git工作树外。
- 27个`core-data-acquisition`与`eodhd`实验文件继续保持未跟踪、未修改、未暂存、未接入正式服务。
- 旧自计算模块只作历史兼容，不在首页、正常导航或正式六指标调度路径中出现。

## 下一步

1. SOXX官方来源采用iShares日频NAV，标记`provider_adjusted`；SOXX不是SOX，2024年3-for-1拆分不做二次调整。
2. BlackRock条款不授权自动监控或复制；后续更新必须由用户人工取得公开文件并运行离线导入，不能增加官网调度。
3. 48101应验证健康、六项首页摘要、SOXX详情/完整历史和回撤页；重启前必须确认监听进程属于本项目，不得误杀其他Node进程。
4. 27个`core-data-acquisition`与`eodhd`实验文件必须继续保持未跟踪、未修改；真实SOXX文件和标准化序列不得进入Git。
