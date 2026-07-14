# 项目交接

## 当前状态

- 版本：v0.2 信息架构评审候选 / `package.json` 仍为 0.1.0（未发布、未合并）。
- 形态：可本地运行、内容结构完整且完成核心页面可读性优化的静态策略网站。
- 技术栈：原生 HTML/CSS/JavaScript、JSON、Node.js 原生 HTTP。
- 默认地址：`0.0.0.0:48101`；从本机使用 `http://127.0.0.1:48101`。
- 持久化与外部服务：无。
- Git：稳定基线 `main@c5c02fce4329793609dc175c5b5f3104ab6ffc14`；当前开发分支 `feature/v0.2-information-architecture`，不得在用户确认前合并。

## 最近验证

日期：2026-07-14。

已完成语法、完整数据契约、HTTP、真实浏览器路由与交互、标签和折叠键盘操作、期权浏览器历史、指标弹窗焦点返回、深浅主题及四种视口长内容溢出检查。实际 iPad/iPhone 设备和目标 ZeroTier 网络仍需用户验收，详见 `TESTING.md`。

## 已知问题

- 阶段和期权字段已覆盖冻结内容范围；具体仓位边界、期权参数逻辑和金融文案仍需用户或合格专业人士审定。
- 当前系统命令行环境可能没有 Node/npm；部署机需要安装 Node.js 18+。Codex 本轮使用随附 Node 进行等价检查。
- 主题只跟随系统初始偏好并在当前页面会话切换，刷新后不持久化；v0.1 未要求保存偏好。
- 识别图片字段已预留但全部为 `null`；周期波形是手工静态示意，不代表真实QQQ行情。

## 下一步

1. 用户查看 `previews/review-v0.2-information-architecture/` 与本地网站，确认信息层级后再决定是否合并。
2. 后续独立批次再处理阶段对比页，不与本分支混合。
3. 逐阶段审定金融内容，并在真实设备及目标局域网/ZeroTier 环境执行人工验收。

## 重要文件

- 产品边界：`AGENTS.md`、`PROJECT_CONTEXT.md`、`DECISIONS.md`。
- 业务数据：`public/data/stages.json`、`options.json`、`indicators.json`；静态周期形态：`cycle-shape.json`。
- 页面逻辑与样式：`public/app.js`、`public/styles.css`。
- 服务：`server.js`。
- 验证：`scripts/check-data.js`、`TESTING.md`。
- 未完成项：`TODO.md`。

## 部署注意事项

- 启动前确认 48101 未被未知进程占用。
- 保持 `0.0.0.0` 监听以支持局域网和 ZeroTier，但不要配置公网穿透。
- Windows 防火墙只开放 TCP 48101 的 Private 入站规则，不关闭防火墙。
- 该版本没有登录鉴权，必须限定在可信局域网或 ZeroTier 网络中使用。
