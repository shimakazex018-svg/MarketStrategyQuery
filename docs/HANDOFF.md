# 项目交接

## 当前状态

- 版本：Market Cycle Strategy v0.1 / `package.json` 0.1.0。
- 形态：可本地运行、内容结构完整的静态策略网站。
- 技术栈：原生 HTML/CSS/JavaScript、JSON、Node.js 原生 HTTP。
- 默认地址：`0.0.0.0:48101`；从本机使用 `http://127.0.0.1:48101`。
- 持久化与外部服务：无。
- Git：基线分支为 `main`，远程仓库为 `https://github.com/shimakazex018-svg/MarketStrategyQuery.git`；首个基线提交已建立并推送。

## 最近验证

日期：2026-07-13。

已完成语法、完整数据契约、HTTP、真实浏览器路由与交互、折叠键盘操作、深浅主题及四种视口长内容溢出检查。实际 Windows/iPad/iPhone 设备和目标 ZeroTier 网络仍需人工验收，详见 `TESTING.md`。

## 已知问题

- 阶段和期权字段已覆盖冻结内容范围；具体仓位边界、期权参数逻辑和金融文案仍需用户或合格专业人士审定。
- 当前系统命令行环境可能没有 Node/npm；部署机需要安装 Node.js 18+。Codex 本轮使用随附 Node 进行等价检查。
- 主题只跟随系统初始偏好并在当前页面会话切换，刷新后不持久化；v0.1 未要求保存偏好。

## 下一步

1. 逐阶段审定仓位、增减配、禁止条件和最大不利情景。
2. 审定八种期权策略的 DTE、行权价、退出、到期和公式口径。
3. 在真实设备及目标局域网/ZeroTier 环境执行人工验收。

## 重要文件

- 产品边界：`AGENTS.md`、`PROJECT_CONTEXT.md`、`DECISIONS.md`。
- 业务数据：`public/data/*.json`。
- 页面逻辑与样式：`public/app.js`、`public/styles.css`。
- 服务：`server.js`。
- 验证：`scripts/check-data.js`、`TESTING.md`。
- 未完成项：`TODO.md`。

## 部署注意事项

- 启动前确认 48101 未被未知进程占用。
- 保持 `0.0.0.0` 监听以支持局域网和 ZeroTier，但不要配置公网穿透。
- Windows 防火墙只开放 TCP 48101 的 Private 入站规则，不关闭防火墙。
- 该版本没有登录鉴权，必须限定在可信局域网或 ZeroTier 网络中使用。
