# 最新交接

## 当前状态

- 稳定版本：`v0.4.0`；v0.4功能合并提交为`a0eb46ea612dbe37254acf886b4d6a56c1cf1c66`。
- 当前开发分支：`feature/v0.5-public-web-data-providers`，起点为v0.4发布后的最新main；尚未开始WorldPEratio或其他公开网页数据源开发。
- 检查点B代码已完成：正式六卡、SEC/CFTC受控来源、本地导入、派生协调器、前端状态、PE双口径详情和异常测试。
- `PE-Q1-RAW-v1`保留普通亏损公司；`PE-Q1-ROBUST-WMAD4-v1`在E/P层按加权中位数/MAD四倍稳健尺度Winsorize。内部市值聚合和排除亏损值不在正式页面展示。
- SEC Provider虽通过合规登记，但默认不请求；必须同时设置`SEC_BULK_UPDATE_ENABLED=true`、`SEC_USER_AGENT_APP`和有效`SEC_USER_AGENT_EMAIL`。
- CFTC正式使用TFF Futures Only `gpe5-46if`中的`209742`；周六Asia/Shanghai检查，`209747`仅作诊断。
- 本轮实际CFTC数据行请求在受限网络中返回`network/fetch failed`，提升权限重试又因工具额度限制未获批准；因此不能把CFTC卡报告为当前`fresh`，运行缓存仍为空。
- 用户尚未提供QQQ持仓/权重、QQQ与成分股复权价格、Forward PE本地CSV，因此正式进程六卡当前均可显示`unavailable`并离线启动。
- UI状态截图使用独立验收夹具，页面来源明确写明“UI验收合成夹具（非真实行情）”；不代表已取得真实市场数据。

## 已验证

- 按`package.json`完整check命令逐项执行：69项测试、0失败。
- 9个阶段、8种期权、6项新指标、7个范围不变。
- 独立端口48218的正式进程`/api/health`返回HTTP 200；无输入时六项独立`unavailable`。
- `runtime-data/`继续被Git忽略；没有生成`package-lock.json`。
- 应用内浏览器已验证首页、两类阶段详情、期权工具、阶段对比、指标说明和PE详情；375×812、768×1024、1024×1366、1440×900无页面级横向溢出。
- 深浅主题、指标弹窗Escape关闭和焦点返回正常；浏览器控制台0错误。
- `previews/review-v0.4-self-calculated-mvp/`包含正式首页与非真实行情状态夹具截图、manifest和contact sheet。

## 待办顺序

1. 用户按模板提供本地持仓、价格和Forward PE；不得将其提交Git。
2. 如用户决定启用SEC，在本机环境变量中配置应用名、联系邮箱和开关；不要在聊天或仓库中记录邮箱。
3. 在真实输入可用后复核覆盖率、日期差、质量标记和历史范围；不得把初步估算升级为fresh，除非全部门槛满足。
4. 开始任何公开网页数据源开发前，重新审计来源定义、机器可读性、稳定性、许可、缓存与内部展示边界。

## 禁止边界

不得恢复IBKR、Twelve Data或Alpha Vantage，不抓取财经网页，不新增自动阶段判断、仓位建议、数据库、登录、交易或第三方运行依赖。运行缓存、真实数据、联系邮箱和任何凭证不得提交。
