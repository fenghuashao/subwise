# Subwise P03-A 综合结论与架构建议

检索及执行日期：2026-10-29（Asia/Shanghai）。阶段：预研完成后停止，框架和平台开发均等待 FA 确认。本文的设计项均为建议，不代表已实现。

## 1. 决策摘要

建议先做「本地订阅管理 + DeepSeek API 余额 + MiniMax 订阅窗口」这一小闭环；Moonshot API 余额在地区接口合同核对后加入。OpenAI 和 Anthropic 的组织用量接口应作为高级账户能力，不能替代个人订阅额度，也不应要求普通用户提供组织管理密钥。Gemini 的云账单与手机端 Google AI 订阅同样分开。证据和各平台限制见后附平台矩阵。

Moonshot 余额文档明确把 API Key 定义为 server-side secret，因此手机用户自带 Key 的发布路线仍需核对官方允许范围；不能从有余额 REST 接口直接推导成手机直连已获支持。当前不建议因此新增托管后端。[Moonshot 认证说明](https://platform.kimi.ai/docs/api/balance)

建议以 React Native（iOS/Android）+ ArkTS/ArkUI（原生 HarmonyOS）作为下一轮验证主方案，以 React Native OpenHarmony 共享 UI 作为挑战方案；Flutter 为备选。选择依据是当前项目只有原生 HTML/JavaScript 与 Node 原型，JavaScript 逻辑可作为语义参考，没有现成 React/Flutter 组件可直接迁移。三端同时共享 UI 的收益必须由真实插件与启动包证明，不能由框架宣传推断。相关官方支持边界见第 5 节。

「所有订阅都能自动查询」目前不成立。公开官方接口、官方 CLI 运行时接口、开源项目调用的未公开 Web 接口是三种不同证据。手机独立登录、三端构建、真实账号查询均未执行，统一标记 NOT_RUN。没有新增本地 Agent 日志采集、桌面伴侣、代理、云同步或后台服务器。

## 2. 项目基线与原型审阅

本地依据：docs/mobile/PLAN.md、docs/mobile/ui-preview.html、package.json、server.js、app.js。已批准 UI V1 保留四导航（总览 / 订阅 / 用量 / 我的）；不改导航、页面和示例数据。项目无初始 HEAD、现有文件为未跟踪状态，不能以空 Git diff 宣称未修改；执行前建立 evidence/baseline.json，并在完成时核对哈希。

server.js 已含 DeepSeek /user/balance 与 MiniMax /v1/token_plan/remains 的代理原型。它读取服务端环境变量、监听本机 HTTP，并不是可发布的手机网络层。本轮只阅读代码，没有启动这个服务，没有读取其环境变量或凭据。以下为源码可见的后续风险，未在本轮修复：

- normalizeDeepSeek 将未知币种默认为 CNY、将缺失赠金/充值额设为零，金额转换为 Number；建议保留币种和十进制字符串，缺失值为 null，解析错误可观察。
- normalizeMiniMax 对模型行取最小剩余百分比或求和，且把 usage_count 回退为 remaining，尚无充分字段合同证明；同一共享额度在多个模型行重复出现会造成误算。应按官方 pool/window 标识分组，未知语义不汇总。
- UI 中 MiniMax 的 5 小时/每周条属于固定示例；正式产品必须从响应与套餐版本判断窗口存在性，不能硬编码所有套餐必有周窗口。
- 现有原型没有证明三端的数据库、安全存储、通知和后台刷新能力。保留原规划，不把原型可点击当作移动端验收。

## 3. CC-Switch：能借鉴什么

本轮固定参考 commit：ddcb111765be66ed9e7e43e240497fd2c9576688；GitHub 返回提交时间 2026-10-29T08:40:02Z。路径、blob SHA 和带行号摘录保存在 evidence/cc-switch.json。该 commit 的 LICENSE 为 MIT，版权 Jason Young；本轮只研究设计与摘录，没有复制实现代码。未来实质复用代码需随附版权与许可，并另查依赖许可证。[许可证](https://github.com/farion1231/cc-switch/blob/ddcb111765be66ed9e7e43e240497fd2c9576688/LICENSE)

| 源码 / 证据 | 实际实现（SOURCE_SUPPORTED，未运行 CC-Switch） | Subwise 取舍 |
| --- | --- | --- |
| [balance.rs](https://github.com/farion1231/cc-switch/blob/ddcb111765be66ed9e7e43e240497fd2c9576688/src-tauri/src/services/balance.rs#L71) | DeepSeek 原生 GET /user/balance，按币种解析；余额不足与凭据无效分开 | 借鉴分平台解析器与状态区分；本项目保留所有币种，包括零余额，不照搬隐藏空钱包策略 |
| [coding_plan.rs](https://github.com/farion1231/cc-switch/blob/ddcb111765be66ed9e7e43e240497fd2c9576688/src-tauri/src/services/coding_plan.rs#L154) | Kimi /coding/v1/usages、智谱 /api/monitor/usage/quota/limit、MiniMax 旧 coding_plan/remains 路径，各有鉴权与解析逻辑 | 平台预设只是入口；每个查询能力单独注册文档、区域、产品类型、schema 版本 |
| [subscription.rs](https://github.com/farion1231/cc-switch/blob/ddcb111765be66ed9e7e43e240497fd2c9576688/src-tauri/src/services/subscription.rs#L30) | QuotaTier 与 CredentialStatus 分离；Claude OAuth usage、Codex wham/usage、Gemini v1internal quota，读取桌面 CLI 凭据 | 可借鉴多窗口结构；移动端不能继承桌面文件/Keychain，也不能把这些 endpoint 当公开第三方 API |
| [provider/usage.rs](https://github.com/farion1231/cc-switch/blob/ddcb111765be66ed9e7e43e240497fd2c9576688/src-tauri/src/services/provider/usage.rs#L12) | 请求/提取分层，支持单项和多项返回；部分传输错误可保留上次成功数据 | 借鉴 adapter → normalize → validate → persist 分层；业务失败也应保留旧快照 |
| [usage_script.rs](https://github.com/farion1231/cc-switch/blob/ddcb111765be66ed9e7e43e240497fd2c9576688/src-tauri/src/usage_script.rs#L1) | QuickJS 自定义 request/extractor；有 URL 检查与 CPU/内存限制 | MVP 采用编译进 App 的固定适配器，不引入任意脚本/自定义请求，减少凭据外传与审核复杂度 |
| [使用手册](https://github.com/farion1231/cc-switch/blob/ddcb111765be66ed9e7e43e240497fd2c9576688/docs/user-manual/zh/2-providers/2.5-usage-query.md) | 卡片额度、代理请求统计、会话日志统计分别实现；存在手动启用机制 | 只研究平台额度，桌面代理和日志导入均不纳入本产品 |

具体接口差异值得保留为证据：MiniMax 当前官方 FAQ 记载 www.minimax.io/v1/token_plan/remains，而 CC-Switch 该版本使用 api.minimax.io 或 api.minimaxi.com/v1/api/openplatform/coding_plan/remains。两者不能在没有真实验证时宣称等价；手机应先按当前官方文档实现单一路由，区域差异另行验证，禁止携凭据自动遍历域名。[MiniMax 官方 FAQ](https://platform.minimax.io/docs/m-plan/faq)

桌面适配器可访问 CLI OAuth 文件、系统钥匙串、CLI 子进程或 CLI 缓存；原生手机 App 处在自己的沙箱内。即使 HTTP 层能够发出请求，也仍需平台允许的客户端身份、授权流程和可持续接口合同。CC-Switch 的接口调用只是 SOURCE_SUPPORTED，不证明手机集成获得支持。Codex 另有公开 App Server 额度方法，详见平台调研，不应将其与 wham Web endpoint 混为一谈。

## 4. 推荐数据架构（设计建议，NOT_RUN）

采用本机单用户、数据库先行、凭据分离的架构。普通管理操作不依赖联网。适配器只接收所需凭据句柄的短期解析结果，不参与订阅编辑，不直接控制 UI。

```text
批准 UI V1：总览 / 订阅 / 用量 / 我的
                    ↓
订阅领域服务       查询协调器（按账户合并请求、超时、退避）
    ↓                         ↓
本地数据库 ← 校验/事务 ← 固定 ProviderAdapter ← 原生 HTTPS
    ↓                         ↑
快照与趋势              CredentialStore（系统安全存储）
    ↓
到期提醒规划 → 平台通知调度（与查询额度重置分开）
```

| 实体 | 主要字段 | 关系与约束 |
| --- | --- | --- |
| Platform | id, displayName, products[], regions[], adapterVersion, evidenceUrl, evidenceLevel, verifiedAt | 一个平台可有多个产品与区域；能力按 product+region+auth+metric 声明 |
| Account | id, platformId, productKind, region, label, externalSubjectRef?, organizationRef?, credentialRef? | productKind 区分 consumer_subscription / coding_plan / api / cloud_billing；组织/项目范围不能遗漏；不保存登录邮箱作为必要标识 |
| Subscription | id, accountId?, planLabel, priceDecimal, currency, cycle, anchorLocalDate, renewalTimeZone, nextRenewalDate?, autoRenewStatus, reminderPolicy, archivedAt | 可无连接账户，仅手动管理；价格由用户录入，官方查询结果不覆盖；续费日期不是额度重置时间 |
| QuotaWindow | id, accountId, poolKey, metricKey, modelScope?, windowKind, durationSec?, startAt?, resetAt?, limit?, used?, remaining?, unit, direction, resetRule, rawWindowId? | windowKind 为 anchored/rolling/calendar/unknown；保留官方语义；不同池/单位/周期禁止合并；缺失 resetAt 不自行推算 |
| Balance | snapshotId, accountId, currency, availableDecimal, grantedDecimal?, toppedUpDecimal?, frozenDecimal?, creditsUnit? | 多币种分别一行；Credits 单位不自动映射 USD；负余额可显示；账户余额与本 Key 限额分开 |
| UsageSnapshot | id, accountId, observedAt, providerAsOf?, receivedAt, source, adapterVersion, schemaVersion, scopeKey, windowKey, completeness, quality, supersedesId?, dedupeKey | source 为 official_api / official_runtime / manual；不可变观测记录，存余额/窗口/用量明细；同一次查询在事务中写入；去重键覆盖账户+请求观测而非只按金额 |
| UsageMeasure | snapshotId, metricKey, valueDecimal?, unit, modelScope?, aggregateStart?, aggregateEnd?, granularity?, tokenSemantics?, billingBasis? | 输入/输出/cache read/cache write 分列，是否包含缓存须声明；聚合费用不是余额；不从余额差直接推断消费（可能有充值/赠金/冻结） |
| ConnectionState | accountId, capability, status, lastAttemptAt?, lastSuccessAt?, retryAfter?, sanitizedError?, credentialState | status 含 disconnected / connecting / ready / offline / rate_limited / forbidden / reauth_required / unsupported / schema_error；缓存陈旧独立计算 |
| CredentialRef | id, accountId, authKind, secureStoreAlias, scopeSummary?, createdAt, expiresAt? | 数据库和备份只存引用；秘密在 Keychain / Android 安全密钥封装 / HarmonyOS Asset Store；各端实现仍 NOT_RUN |

金额使用十进制字符串和明确币种；Token/请求数用整数语义，超大整数在跨语言 JSON 中也用字符串。比例保留明确方向 used / remaining，只有同一个窗口已知 limit>0 才派生比例；比例越界保留异常信息，不悄悄钳制成正常状态。未知、不适用、无上限、部分数据分别表示，不用 0 代替。

示例为设计数据，非真实账户：

```json
{
  "accountId": "demo-deepseek-api-cn",
  "source": "official_api",
  "observedAt": "2026-10-29T12:00:00Z",
  "quality": "complete",
  "balances": [{ "currency": "CNY", "availableDecimal": "110.00", "grantedDecimal": "10.00", "toppedUpDecimal": "100.00" }],
  "quotaWindows": [],
  "usageMeasures": [],
  "unavailableCapabilities": ["account_token_history", "subscription_reset"]
}
```

趋势仅比较同账户、同 scope/pool、同指标单位及同窗口实例；窗口重置应断线并注明，不能连出负消耗。手动与自动快照分别标注来源，可在同图显示但不能无提示互相覆盖。服务端不提供历史时，趋势从首次采集开始，不承诺补回过去记录。数据库候选为 SQLite 类关系存储，迁移版本化；HarmonyOS 使用 relationalStore 的封装是否与共享层一致，留待启动包验证。[HarmonyOS 数据 FAQ](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/data-faq)

### 查询、缓存与安全边界

- 默认用户触发刷新；前台陈旧查询可采用 15 分钟缓存作为产品初值（非平台承诺），同账户 single-flight。适配器可有更长最小间隔；未查到官方查询频率上限时明确 unknown。429 尊重 Retry-After，网络/5xx 有界退避与抖动，401 停止自动重试，403 与过期分开。
- 单平台失败不影响其他账户，所有失败保留 lastSuccess 快照；清晰展示观测时间及陈旧状态。超过 resetAt 仅显示「预计已重置，待刷新」，不能将缓存百分比自动归零。
- 原生 HTTP 不受浏览器 CORS 机制限制这一点不等于完成移动验证；DNS/TLS、网络地域、代理、权限、服务端客户端限制、IPv6、弱网及真机仍需分别验证。WebView/浏览器的 CORS 结果也不能替代原生验证。
- 不嵌入开发者共享密钥；用户自行配置的 API Key 往往同时有推理消费权限，并非只读。不得为余额查询自动请求推理。组织管理 Key 不作为普通消费者默认路径，未来如支持必须清楚标示范围，单独授权。
- 凭据不写日志、分析事件、备份和错误原文；固定 HTTPS host 与 path，禁止跨域重定向携带认证；退出连接时删除安全存储项。备份按现有规划默认无凭据；恢复先预览和校验，取消不落库。
- iOS 后台任务不保证按指定时间启动，Android WorkManager 周期最小 15 分钟且可能延迟；因此不承诺后台实时额度。续费提醒从本机日历规则预排，与网络刷新分离。HarmonyOS 提醒与后台能力仍需 API 版本及授权验证。[Apple](https://developer.apple.com/documentation/backgroundtasks/bgtaskrequest/earliestbegindate)、[Android](https://developer.android.com/reference/androidx/work/PeriodicWorkRequest)、[Huawei 通知](https://developer.huawei.com/consumer/cn/doc/doccenter-dev-faq/notification-kit-faq-0002)

## 5. Flutter / React Native / HarmonyOS 选型

| 方案 | 官方支持与复用边界 | 对本项目的收益 / 代价 | 本轮结论 |
| --- | --- | --- | --- |
| Flutter iOS/Android + 鸿蒙社区适配 | Flutter 上游支持平台列表含 iOS/Android，未列 HarmonyOS；华为提供三方框架接入路径，但不代表全部 Flutter 插件均已适配 | UI 一致性较好；现有 JS 业务需迁移 Dart，鸿蒙 fork/toolchain 与插件须单独验证 | 备选；三端构建、存储/通知/凭据插件 NOT_RUN |
| React Native iOS/Android + React Native OpenHarmony | RN 官方将 OpenHarmony 列为伙伴维护的 out-of-tree 平台；不等于 Meta 核心与 Expo 所有模块覆盖鸿蒙 | 可复用 JS/TS 领域代码；当前 DOM/CSS 不能直接作为 RN 组件；需锁定 RN/RNOH 兼容组合 | 共享 UI 挑战方案；鸿蒙库覆盖与升级成本 NOT_RUN |
| React Native iOS/Android + ArkTS/ArkUI 鸿蒙 | iOS/Android 共用 UI，鸿蒙独立原生界面及平台服务；跨端共享 JSON 合同与测试向量 | 比三套原生少一套 UI；鸿蒙桥接风险可控，但有两套 UI，TS 与 ArkTS 不是任意源码互通 | 推荐作为下一轮技术验证主方案，非已批准实施 |
| SwiftUI / Kotlin Compose / ArkTS 全原生 | 各端原生开发路径，三套 UI 与领域实现 | 原生 API 边界直接；维护与一致性验收成本最高 | 仅作风险回退，MVP 不优先 |

证据：[Flutter 支持列表](https://docs.flutter.dev/reference/supported-platforms)、[RN out-of-tree](https://reactnative.dev/docs/out-of-tree-platforms)、[RN 官方入门](https://reactnative.dev/docs/environment-setup)、[Huawei 框架环境配置](https://developer.huawei.com/consumer/cn/doc/start/hosdevassistant-config-0000002588511280)、[Huawei 原生开发规划](https://developer.huawei.com.cn/consumer/cn/app/planning)。选择依据为工程判断，不声称做过性能或人天测量。最低系统版本、具体框架版本与插件版本均待下一阶段锁定；文档在线版本会变，不应在未构建时承诺一组可工作的版本。

建议平台服务接口：SecureCredentialStore、LocalDatabase、NotificationScheduler、HttpTransport、Clock/TimeZone、BackupFileAccess。HarmonyOS 的 Asset Store 提供短敏感数据存储能力；Android 可用 Keystore 管理加密密钥、秘密本体以受保护密文保存；iOS 用 Keychain。它们只作为候选机制，三端实现、卸载/备份/设备锁定行为尚未验证。[Huawei Asset Store](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-v5/asset-store-kit-V5)、[Android Keystore](https://developer.android.com/privacy-and-security/keystore)、[Apple Keychain](https://developer.apple.com/documentation/security/keychain-services)

下一轮最小技术决策门槛：每端启动包；断网增改重启保持；安全存储写读删及备份排除；通知拒绝/允许、月底/时区场景；固定官方 GET 网络、超时/401/429；大字体与读屏。没有 Mac/Xcode/签名/真机的端标 NOT_RUN；APK 能运行不等于原生 HarmonyOS HAP 通过。本轮命令发现仅确认 Node 可用，flutter/adb/hdc/hvigor 未在 PATH 检出，不据此断言整机没有对应 SDK。

## 6. DeepSeek 最小验证结果

范围为独立 Node PoC，位于 poc/deepseek-poc.mjs；未接入产品、未安装依赖、未读取环境变量或凭据。按官方余额示例构造 fixture，不是账户实测数据。执行凭据安全约束优先于真实账户验证，故认证查询未执行。[余额合同](https://api-docs.deepseek.com/api/get-user-balance/)、[认证示例](https://api-docs.deepseek.com/)

| 检查项 | 结果 | 能证明 / 不能证明 |
| --- | --- | --- |
| 余额解析、十进制字符串、多币种、缺失字段、不可用状态等 | VERIFIED：11 项通过 | 本地合同处理；不证明真实响应完整性 |
| 本地 HTTP 成功、401/403/429/500、非 JSON、重定向、超时及 Retry-After | VERIFIED：9 项通过；8 次 loopback 请求 | 隔离传输与错误分类；无真实 Key，合成认证标记仅发往 127.0.0.1 |
| 不带 Authorization 的官方 GET /user/balance | VERIFIED：一次请求观察到 HTTP 401；未保留响应正文 | 当前执行环境可访问该端点；不证明认证成功或手机网络可达 |
| 真实 Key 认证与余额查询 | NOT_RUN | 用户禁止读取真实密钥，本轮未申请或使用 |
| iOS / Android / 原生 HarmonyOS 构建及真机网络、安全存储、通知 | NOT_RUN | 不能用 Node 测试替代 |
| 本地快照持久化、趋势去重、续费日期算法、迁移与恢复 | NOT_RUN | 本轮只提出模型，没有实现产品存储 |
| 报告静态结构、内部目录、离线资源依赖及原文件哈希 | VERIFIED：见 evidence/report-validation.json | 只验证 HTML 结构与内容；浏览器工具安全策略禁止 file://，视觉检查 NOT_RUN，未尝试绕过 |

离线重跑命令：node docs/mobile/p03-a/poc/deepseek-poc.mjs。加 --probe-public 才额外执行一次无凭据的官方 GET；不要添加真实 Key。evidence/poc-results.json 保存当次结果；重跑会更新此文件。公开请求接到代理/网关错误时也只能记录观察，不扩大为账户验证。

## 7. 建议接入顺序与停止点

| 顺序 | 平台 / 能力 | 理由及进入下一步的条件 |
| --- | --- | --- |
| 0 | 手动订阅、窗口记录与本地快照 | 对齐已批准 UI；无公开接口的平台仍能使用；正式实现等待确认 |
| 1 | DeepSeek API 余额 | 官方合同清晰且已完成隔离 PoC；后续须由 FA 另行授权真实连接验证，不能声称有 Token 历史 |
| 2 | MiniMax M Plan 窗口 | 有公开官方端点；先验证国际文档路径、地区、Key 类型、窗口/共享池/新旧套餐语义，再开放自动连接 |
| 3 | Moonshot/Kimi API 余额 | 有官方余额文档；CN/global endpoint、字段与币种逐一验证；与 Kimi Code 产品分开 |
| 4 | Kimi Code / 智谱 Coding Plan | CC-Switch 有实现线索，需官方合同和合法移动客户端授权/可用性验证；不满足时手动回退 |
| 5 | OpenAI / Anthropic 组织 API 用量和费用 | 管理权限与组织范围需单独设计；面向有资格的高级用户，不混作 Pro/Plus 订阅额度 |
| 6 | Codex / Claude / Gemini 消费订阅自动额度、Gemini 云账单 | 先验证公开授权与运行时依赖；手机独立能力不足则保持手动，不引入桌面桥接或云后端扩大范围 |

下一阶段建议拆成 P03-B 三端技术决策验证和 P03-C 首个平台真实连接验收；这只是建议，尚未启动。框架主方案、原生鸿蒙最低版本、第一批地区/产品以及真实凭据验证方式由 FA 确认后确定。新增服务端、桌面伴侣、任何公开 Web 接口凭据逆向与本地 Agent Token 日志采集均不在本轮范围。

本轮完成标准为：有来源的能力矩阵、固定 commit 的源码分析、可讨论的数据模型、带限制的选型建议、可重跑且不含秘密的隔离验证、离线 HTML。真实账户与三端就绪仍未通过，不能将 P03-A 预研完成升级为 P03 移动端技术验证全部完成。
