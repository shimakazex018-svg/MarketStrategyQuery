# HANDOFF

## Last Completed Task

建立并规范 Codex 长期上下文管理文档体系。八份文档现在分别承担工作规则、当前事实、当前架构、长期决策、任务状态、当前验证、历史记录和最新交接职责。

## Current State

- 当前分支：`feature/v0.3-live-market-data`。
- 当前代码 HEAD：`1cb21a654baedcc4d1c5ccefe90d8fa043d9a110`。
- 稳定基线：`main@160345eeeefca763b05233fdae76a43025a85516`，标签 `v0.2.0`。
- v0.3 数据源审计、市场数据基础设施、六状态 UI、17 项自动测试和评审截图已完成并推送开发分支，尚未合并 main。
- 本次只修改八份 Markdown；业务代码、配置、脚本、接口和运行数据未修改。
- VIX/VXN 当前 unavailable；QQQ组合TTM PE、Forward PE、恐慌贪婪指数、基金经理仓位指数当前 demo。

## Recently Changed Files

- `AGENTS.md`
- `docs/PROJECT_CONTEXT.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/TODO.md`
- `docs/TESTING.md`
- `docs/CHANGELOG.md`
- `docs/HANDOFF.md`

## Validation

- 八份目标文档存在且边界清晰。
- `git diff --check`：通过。
- `npm.cmd run check`：17 项通过、0 失败；9阶段、8期权、6指标、7范围及引用有效。
- Git 差异应只包含上述八份文档。

## Known Issues

- Cboe 自动缓存与再展示许可：待确认。
- QQQ组合TTM PE 正式机器来源和完整口径：待确认。
- 真实 iPad/iPhone、目标局域网、ZeroTier 和 Windows 防火墙跨设备验收：待确认。
- 金融策略内容仍需用户或合格专业人士最终审定。

## Risks

- 默认监听 `0.0.0.0` 且没有登录鉴权，只应在可信局域网或 ZeroTier 网络使用。
- 当前实际运行数据目录 `runtime-data/` 已被忽略；未来可能出现的通用 `data/`、`cache/`、缩略图、HLS 和 SQLite 文件尚无预防性忽略规则。它们当前不存在，不应在本任务修改 `.gitignore`。
- 测试夹具和演示数据不得描述为真实行情。

## Recommended Next Task

先由用户审阅本次文档体系和 v0.3 评审截图，再决定是否：

1. 提交本次文档改动；
2. 合并 `feature/v0.3-live-market-data` 到 `main`；
3. 继续处理外部数据许可或金融内容审定。

未经用户明确批准，不要自行合并 main、创建 `v0.3.0` 标签或启用真实数据抓取。

## Notes for Next Codex Session

1. 严格按 `AGENTS.md` 的顺序读取七份上下文文档。
2. 再读取新任务涉及的源码和专项市场数据文档，不能只凭本交接文件修改代码。
3. 开始前检查分支、HEAD、上游和工作树，保留用户未提交改动。
4. 若本次文档改动仍未提交，不要覆盖；先向用户确认提交要求。
5. 运行数据不得删除、移动或提交。
