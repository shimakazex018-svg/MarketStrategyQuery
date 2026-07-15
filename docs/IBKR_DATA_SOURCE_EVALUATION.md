# IBKR个人内部市场数据预检查

检查日期：2026-07-15（Asia/Hong_Kong）  
检查范围：非敏感本机能力、IBKR官方API资料和本人内部使用许可边界。  
结论性质：工程与合规预检查，不是法律意见。

## 当前结论

- 本机没有发现TWS、IB Gateway或Client Portal Gateway，也没有对应进程、服务、快捷方式、典型安装目录或API监听端口。
- 当前项目没有IBKR连接、账户、合约搜索、行情请求或探测脚本。
- 没有执行登录、2FA、合约搜索、历史请求、订阅检查或任何市场数据请求。
- IBKR技术接入在当前主机上不可立即执行；继续需要用户明确选择并安装官方组件。
- IBKR与Cboe的现有公开资料不足以明确批准“本人LAN/私人ZeroTier网页展示、每日缓存和长期历史保存”。
- `complianceStatus`保持`pending_written_confirmation`，`enabled=false`。

## 本机非敏感检查

| 检查项 | 结果 |
| --- | --- |
| TWS | 未发现 |
| IB Gateway | 未发现 |
| Client Portal Gateway | 未发现 |
| IBKR相关进程/服务/快捷方式 | 未发现 |
| 常见Socket API端口7496/7497/4001/4002 | 无监听 |
| Client Portal Gateway典型端口5000 | 无监听 |
| 当前项目IBKR实现 | 不存在 |
| 敏感配置读取 | 未执行 |

检查只判断存在性和版本元数据；没有读取配置正文、账户ID、用户名、密码、Cookie、Token或验证码。

## 接入方式比较

### TWS API协议 + Trader Workstation

- 本地程序通过TCP Socket连接TWS。
- 适合首次人工验证：可在界面中观察合约、行情权限和错误提示。
- 对本项目必须保持“Read-Only API”，不需要订单信息，也不得启用交易能力。
- TWS必须运行并由用户在GUI中登录；官方不支持无界面登录。

### TWS API协议 + IB Gateway

- 对API客户端与TWS基本等价，使用同一套Socket协议。
- 官方资料称IB Gateway资源占用约低40%，适合通过许可后的每日定时读取。
- 仍需GUI人工登录；可配置工作日自动重启，但周末服务器重置后通常需要重新认证。
- 推荐作为未来生产方式，但应先用TWS完成可见的只读验证。

### Client Portal API

- 个人账户需要运行Client Portal Gateway并通过与Client Portal相同的2FA登录。
- 市场数据和历史接口位于需要brokerage session的`/iserver`路径。
- brokerage session空闲约5分钟会失效，需要频繁调用`/tickle`；同一用户名通常只能有一个活动brokerage session。
- 为每天一次数据增加持续会话、2FA和会话冲突成本，不推荐作为本项目首选。

## 推荐路径

1. 用户确认后安装IBKR官方TWS，先进行可见、只读的本机验证。
2. 在TWS的Global Configuration → API → Settings中：
   - 启用Socket客户端访问；
   - 保持Read-Only API；
   - 只允许本机可信连接；
   - 记录非敏感Socket端口，不提供任何凭据给Codex。
3. 用户本人完成官方登录和2FA后，再运行隔离探测脚本。
4. 合约、历史数据模式、订阅和许可全部确认后，才评估迁移到更轻量的IB Gateway。

Codex不得代替用户登录、读取密码管理器、保存2FA、接受协议或购买订阅。

## 尚未执行的技术验证

以下项目因组件缺失和人工登录边界而未测试：

- VIX指数合约搜索与唯一识别；
- VXN指数合约搜索与唯一识别；
- VIX/VXN日线历史请求；
- 实际返回的`realtime`、`frozen`、`delayed`、`frozen delayed`或`not subscribed`状态；
- 账户现有市场数据权限；
- 具体历史覆盖和数据日期；
- 实际API pacing错误。

官方TWS API支持Live(1)、Frozen(2)、Delayed(3)和Delayed-Frozen(4)数据模式。历史日线接口在技术上存在，但官方说明实时和历史数据通常受市场数据订阅约束。小周期历史请求还受重复请求、同合约短时请求和十分钟总量限制；本项目即使获批也只计划每个指标每天一次，仍必须保留现有限流。

## 订阅与许可判断

- IBKR官方API资料说明，多数API市场数据需要已开立并入金的IBKR Pro账户和对应市场数据订阅。
- 官方订阅资料列出“CBOE Streaming Market Indexes”，但现有公开资料不能确认用户账户下VIX与VXN的精确权限、延迟/冻结日线可用性或费用。
- Client Portal API资料要求用户检查并接受Market Data API Agreement；订阅界面可能把用途区分为TWS、Alternative Display和Non-Display(API)。
- IBKR市场数据协议禁止向第三方再分发；公开资料没有明确说明本项目的本人LAN/私人ZeroTier网页是否属于允许的单用户显示，也没有明确授权每日缓存和长期历史序列保存。
- VIX/VXN是Cboe指数，可能同时受IBKR订阅条款与Cboe指数权利限制。

因此不能从“个人非专业账户”“付费订阅”或“API成功返回”推导出内部网页展示和缓存许可。必须取得IBKR书面答复。

## 停止原因

第一检查点在以下条件处停止：

1. 当前主机需要安装新的IBKR官方软件；
2. 后续技术验证需要用户人工登录和2FA；
3. 精确市场数据订阅尚未确认；
4. 内部展示、LAN/ZeroTier访问、本地缓存与历史保存条款不明确，需要书面确认。

未进入Twelve Data阶段。

## 官方参考

- IBKR TWS API：<https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/>
- TWS API初始设置：<https://interactivebrokers.github.io/tws-api/initial_setup.html>
- IBKR Web API：<https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/>
- Client Portal API v1.0：<https://ibkrcampus.com/campus/ibkr-api-page/cpapi-v1/>
- API市场数据订阅：<https://ibkrcampus.com/campus/ibkr-api-page/market-data-subscriptions/>
- 市场数据订阅设置：<https://www.ibkrguides.com/clientportal/usersettings/marketdatasubscriptions.htm>
- IBKR市场数据定价：<https://www.interactivebrokers.com/en/pricing/market-data-pricing.php>
- IBKR市场数据协议样本：<https://investors.interactivebrokers.com/en/accounts/forms-and-disclosures-market-data.php>

