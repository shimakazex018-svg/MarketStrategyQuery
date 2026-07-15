# HANDOFF

## Last Completed Task

完成v0.4第一检查点：固化个人内部市场数据使用边界，建立Provider合规硬门禁，并完成IBKR非敏感本机与官方资料预检查。由于本机缺少IBKR组件且许可需要书面确认，已按瀑布规则停止，未进入Twelve Data。

## Current State

- 当前分支：`feature/v0.4-compliant-market-data-waterfall`。
- v0.4起点与稳定基线：`main@e8290d89416cd2f7915ed648f15f08d9fa71117c`，标签`v0.3.0`。
- Provider注册表当前包含Cboe与IBKR，两者均为`pending_written_confirmation`、`enabled=false`。
- 本机未发现TWS、IB Gateway或Client Portal Gateway；没有登录、2FA、订阅、合约或行情请求。
- VIX/VXN 当前 unavailable；QQQ组合TTM PE、Forward PE、恐慌贪婪指数、基金经理仓位指数当前 demo。

## Recently Changed Files

- `docs/MARKET_DATA_USAGE_BOUNDARY.md`
- `docs/PROVIDER_COMPLIANCE_REGISTER.md`
- `config/market-data-providers.json`
- `server/market-data/provider-compliance.js`
- `docs/IBKR_DATA_SOURCE_EVALUATION.md`
- `docs/IBKR_SUPPORT_INQUIRY.md`
- 市场数据配置、服务门禁、测试和长期维护文档

## Validation

- `npm.cmd run check`：22项通过、0失败；9阶段、8期权、6指标、7范围及引用有效。
- 未批准Provider不能被旧环境变量启用；`approved_with_conditions`必须明确满足全部条件。
- 没有UI变化，v0.3截图、manifest和contact sheet未修改。
- 48101现有服务未终止、未重启、未修改。

## Known Issues

- IBKR内部显示、LAN/私人ZeroTier访问、本地缓存与历史保存：待书面确认。
- 本机需要用户确认后安装官方TWS，并由用户本人完成登录和2FA。
- VIX/VXN具体合约、历史日线、数据模式和账户订阅：未技术验证。
- Cboe自动缓存与再展示许可、QQQ组合TTM PE正式来源和完整口径：待确认。
- 真实 iPad/iPhone、目标局域网、ZeroTier 和 Windows 防火墙跨设备验收：待确认。
- 金融策略内容仍需用户或合格专业人士最终审定。

## Risks

- 默认监听 `0.0.0.0` 且没有登录鉴权，只应在可信局域网或 ZeroTier 网络使用。
- GitHub仓库当前为PUBLIC；建议改为private，但不得以private替代数据许可和运行数据隔离。
- 当前实际运行数据目录 `runtime-data/` 已被忽略；未来可能出现的通用 `data/`、`cache/`、缩略图、HLS 和 SQLite 文件尚无预防性忽略规则。它们当前不存在，不应在本任务修改 `.gitignore`。
- 测试夹具和演示数据不得描述为真实行情。

## Recommended Next Task

等待用户决定是否继续IBKR：

1. 是否授权安装IBKR官方TWS；
2. 用户本人是否能完成登录并保持Read-Only API；
3. 是否先向IBKR客服发送`docs/IBKR_SUPPORT_INQUIRY.md`并等待书面答复；
4. 是否确认现有账户类型和订阅状态，但不要提供账户ID或凭据。

在上述事项完成前不要运行IBKR行情探测，也不要进入Twelve Data。

## Notes for Next Codex Session

1. 严格按`AGENTS.md`顺序读取长期文档，再读用途边界、Provider登记和IBKR评估。
2. 开始前检查分支、HEAD、上游和工作树，保留用户未提交改动。
3. 登录、2FA、协议接受和订阅购买只能由用户本人执行。
4. 后续探测脚本只能写入`scripts/data-source-probes/ibkr/`，输出写入`runtime-data/`或TEMP。
5. 不得读取账户、持仓、余额、订单或任何凭据；运行数据不得删除、移动或提交。
