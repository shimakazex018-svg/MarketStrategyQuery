# 最新交接

## 当前状态

- 稳定版本仍为 `v0.4.0`；当前开发分支为 `feature/v0.5-public-web-data-providers`，开发版本 `0.5.0-dev`，未合并 main、未创建 v0.5 标签。
- 清理后的第一检查点提交链已普通推送；第二检查点代码在当前分支继续开发，不修改main或标签。
- WorldPEratio已按项目所有者有限风险接受登记为`approved_with_conditions`、`selected`、`enabled=true`；该状态不代表来源方书面授权。
- 已实现采集前robots、每日一次目标请求、仅超时/5xx重试、标准化缓存、去重快照、history/statistics API和PE详情页外部参考分区。
- 条款复查日期缺失或达到30天时在任何第三方请求前返回`terms-review-due`；status API公开复查日期和到期状态。
- 第一检查点确认robots未禁止、页面无需登录且服务器HTML直接包含QQQ/Nasdaq-100目标字段；未发现Terms或明确授权。第二检查点由项目所有者在严格个人内部边界内接受有限剩余风险。
- Provider固定主机和可识别User-Agent，连接10秒/总计20秒、750 KB响应上限；每天正常目标请求一次，仅超时或5xx延迟重试一次。403/429、登录、验证码、Cloudflare、robots禁止和DOM/目标/日期/数值冲突立即停止。
- WorldPEratio不进入通用调度或正式首页；四个GET诊断API只读本地状态，不触发第三方请求。真实运行数据只保存在被Git忽略的运行目录。
- 普通 HTTP 已足够，浏览器 fetcher 明确保持禁用；没有安装 Playwright，没有读取用户 Chrome Profile、Cookie 或会话。
- `PE-HISTORY-TRIM10-v1` 已实现透明基础统计；A只Trim、B对数、C固定Winsorize仍是候选，尚未选定最终方案。

## 已验证

- 第一检查点清理链已普通fast-forward推送；未force push。main和`v0.4.0`标签未修改。
- 第二检查点受控采集完成一次robots和一次目标请求，未触发重试或访问控制熔断；完整页面未落盘。文档和提交不记录真实数值、数据日期、内容哈希或页面片段。
- 第二次同日调用在网络前被预算拦截；离线启动可从标准化缓存读取latest/history/statistics，API不返回内容哈希或本地路径。
- 合成UI评审确认PE详情页外部/自计算分区、1/5/10/20年区间条、单快照不画折线、手机/桌面无横向溢出；首页仍为6卡且没有外部PE区块。
- 未修改正式首页、六卡定义、九阶段、八期权、七范围、默认48101端口或Hash路由。

## 下一步

1. 后续每日快照按同一低频边界逐步积累；不重复同一来源日期或未变化数值。
2. 每30天复核robots、Terms链接、Privacy、About和页脚；出现禁止性变化时立即停用并保留stale缓存。
3. 不把WorldPEratio统计方法或外部值写入本站自计算算法；不得猜测其未公开公式。
4. 其他财经网站不在本检查点范围内，需另行逐来源授权与审计。

## 禁止边界

- `enabled=true`仅在项目所有者风险接受条件持续满足时有效；它不是来源方书面授权，且不得加入通用调度或公开部署。
- 不读取用户私人 Cookie/Chrome 会话，不绕过403/429、验证码、登录或Cloudflare挑战，不切换身份重试。
- WorldPEratio 只能作为未来外部参考，不能覆盖或改名 `PE-Q1-RAW-v1`、`PE-Q1-ROBUST-WMAD4-v1`。
- 不合并main、不打标签、不提交/推送，除非用户另行明确要求。
