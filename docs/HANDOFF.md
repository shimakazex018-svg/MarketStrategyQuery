# 最新交接

## 当前状态

- 稳定版本仍为 `v0.4.0`；当前开发分支为 `feature/v0.5-public-web-data-providers`，开发版本 `0.5.0-dev`，未合并 main、未创建 v0.5 标签。
- `bf95e51`之后的6个本地未推送提交已从干净基线重建；替代链不含私人路径、固定家庭网络地址、真实WorldPEratio数值/日期/哈希或页面片段，仍未推送。
- v0.5 第一检查点只处理 WorldPEratio。审计确认 robots 未禁止目标路径、目标页无需登录/订阅且服务器 HTML 直接包含 QQQ/Nasdaq-100、当前 PE、日期及历史均值/标准差。
- sitemap、页脚和定向搜索未发现 Terms/Terms of Use；Privacy 也未授予自动读取、缓存或本人内部展示权。因此登记为 `pending_written_confirmation`、`candidate`、`enabled=false`。
- Provider 原型固定主机和可识别 User-Agent，连接10秒/总计20秒、750 KB响应上限；每天正常请求一次，仅网络类失败延迟重试一次，每日总计最多两次。403/429、登录、验证码、DOM/目标/日期/数值冲突立即停止。
- 真实运行不调度 WorldPEratio，不写入真实值，不进入正式首页。两个 GET 诊断 API 只读本地状态，不触发第三方请求。
- 普通 HTTP 已足够，浏览器 fetcher 明确保持禁用；没有安装 Playwright，没有读取用户 Chrome Profile、Cookie 或会话。
- `PE-HISTORY-TRIM10-v1` 已实现透明基础统计；A只Trim、B对数、C固定Winsorize仍是候选，尚未选定最终方案。

## 已验证

- 远程引用刷新后，当前分支、origin同名分支、main和`v0.4.0`标签均指向`bf95e51aa0411a4c2e8c3d24a328fc5f896aa5fb`；开始前工作树干净，`runtime-data/`继续被忽略。
- WorldPEratio 公开审计请求使用固定可识别 User-Agent；未遇到403、429、登录或验证码。没有把完整页面、Cookie、Token或真实提取值写入Git/runtime-data。
- 使用项目认可的 Node.js 运行时按完整 check 步骤执行95项测试，95通过、0失败；文档不记录本机运行时绝对路径。
- 独立测试端口：health为HTTP 200、`0.5.0-dev`；六指标仍为6项；WorldPEratio为`enabled=false`、`pending_written_confirmation`、`attemptsToday=0`、latest `unavailable/currentPE=null`。
- 未修改正式首页、六卡定义、九阶段、八期权、七范围、默认48101端口或Hash路由。

## 下一步

1. 如希望正式启用，先向 WorldPEratio 取得覆盖“每天一次自动读取、失败一次重试、只缓存最终字段/哈希、本人内部网页展示”的书面确认。
2. 获得确认后先更新 Provider 合规登记，再独立评审真实一次采集和诊断 API；不要直接接入首页。
3. 使用真实历史序列评估 A/B/C 候选后，由用户选择正式历史 PE 算法并新增版本；不得猜测 WorldPEratio 未公开公式。
4. 其他财经网站不在本检查点范围内，需另行逐来源授权与审计。

## 禁止边界

- 未获书面确认前不得设置 WorldPEratio `enabled=true`、加入调度、保存或展示真实值。
- 不读取用户私人 Cookie/Chrome 会话，不绕过403/429、验证码、登录或Cloudflare挑战，不切换身份重试。
- WorldPEratio 只能作为未来外部参考，不能覆盖或改名 `PE-Q1-RAW-v1`、`PE-Q1-ROBUST-WMAD4-v1`。
- 不合并main、不打标签、不提交/推送，除非用户另行明确要求。
