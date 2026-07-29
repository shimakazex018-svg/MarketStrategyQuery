# 最新交接

## 当前状态

- 当前分支为 `main`；v0.5 正式首页仍为六项指标，SOXX仅用于回撤分析。
- 新增 `#/settings`：顶部齿轮入口、只读数据源与采集状态页、60秒仅内部 API 的状态轮询；无实时行情源。
- `GET /api/settings/data-acquisition` 聚合 FRED（4项）、WorldPEratio（2项）和 iShares 本地导入 SOXX NAV（1项）的现有运行状态，绝不触发刷新或外部请求。
- API 只返回中性凭据使用布尔状态，不返回Cookie或Token名称、内容或其他敏感凭据。
- 调度仍是 Asia/Shanghai 每日07:30；Windows 无感启动仅负责服务启动，不是采集任务。
- `runtime-data/system/data-acquisition-audit.json` 从本功能上线后开始记录，原子写入、损坏隔离，最多200条或90天；不含原始数据、HTML、路径、Cookie、Token或内容哈希。

## 验证边界

- `npm.cmd run check`：154项通过、0失败；数据检查、语法检查和完整自动测试均通过。
- 设置 API、审计边界与前端路由的新增合成测试已覆盖；真实市场数据和隔离实验文件未纳入测试输入或 Git。
- 后续视觉验收应检查 `#/settings` 的 1440×900、768×1024 和 390×844，并确认只存在本站内部 API 请求。

## 下一步

1. 不要为设置页增加立即抓取、Provider启停、调度修改、缓存删除或上传功能，除非用户单独授权。
2. 保持 FRED/WorldPEratio 既有合规与失败停机边界；SOXX继续仅允许人工下载后本地导入。
3. `tools/market-data-lab/` 的未跟踪实验文件继续保持未修改、未暂存、未接入正式服务。
