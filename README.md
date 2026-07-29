# Market Cycle Strategy v0.1

一个用于测试市场周期、仓位管理、期权策略与响应式UI的信息型网站原型。

## 第一版包含

- 9种市场形态横向周期图；
- 点击阶段进入策略详情页；
- QQQ、SOXX、SOXL、现金/SGOV独立仓位区间；
- 8类期权工具及最大收益、最大亏损、盈亏平衡公式；
- 6张模拟指标卡片，每张独立切换1个月至10年时间范围；
- 深色/浅色主题；
- Windows、iPad、iPhone响应式布局；
- 原生Node.js静态服务器，无第三方依赖。

## 当前明确不包含

- 真实市场数据；
- 网页自动判断市场阶段；
- 用户确认保存；
- 用户登录；
- IBKR连接与持仓读取；
- 自动交易。

## 启动

要求 Node.js 18 或更高版本。

首次启动前可执行基线检查：

```powershell
npm run check
```

```powershell
cd <项目目录>
npm start
```

默认监听：

```text
0.0.0.0:48101
```

局域网访问示例（`192.0.2.10` 为 RFC 5737 文档保留地址，请替换为实际地址且不要写回仓库）：

```text
http://192.0.2.10:48101
```

ZeroTier访问：

```text
http://<服务器ZeroTier-IP>:48101
```

监听 `0.0.0.0` 能同时接受局域网网卡和ZeroTier虚拟网卡的访问。不要仅监听 `127.0.0.1`。

## Windows防火墙

以管理员身份运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\open-firewall.ps1
```

## 内容维护

- 市场阶段：`public/data/stages.json`
- 期权工具：`public/data/options.json`
- 指标卡片：`public/data/indicators.json`
- 页面逻辑：`public/app.js`
- 视觉样式：`public/styles.css`

策略内容使用JSON配置，便于后续Codex修改，不需要开发后台编辑器。

长期维护与验收说明见 `docs/ARCHITECTURE.md`、`docs/TESTING.md` 和 `docs/HANDOFF.md`。

## Latest Visual Review

最新可提交的网页内容区快照、隐私检查结果和审阅说明见 [previews/current/manifest.md](previews/current/manifest.md)。UI 改动完成后执行 `npm.cmd run visual:current` 刷新；该工具只访问本机 `127.0.0.1:48101`。

## NAAIM local workbook import (checkpoint A)

The NAAIM Exposure Index is not enabled in the product until an owner-supplied official workbook passes local validation. Place an officially downloaded `.xlsx` file under `runtime-data/imports/naaim/`, then run:

```powershell
npm.cmd run data:import:naaim -- runtime-data/imports/naaim/naaim-exposure-index.xlsx
```

The command is local-only: it neither contacts NAAIM nor MacroMicro, accepts no path outside that ignored import directory, and writes normalized data only below ignored `runtime-data/`. NAAIM has announced that non-member access changes to subscription access on 2026-08-01; local import does not imply continuing access, API permission, or redistribution permission.
