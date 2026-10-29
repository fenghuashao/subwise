# P03-A 平台官方证据笔记

检索日：2026-10-29（Asia/Shanghai）。只读公开官方文档；未访问登录态、未读取任何本机凭据、未调用任何真实账户接口。本文件为独立调研输入，综合报告由主 Agent 复核。

状态：`DOC_SUPPORTED`=公开官方文档描述；`SOURCE_SUPPORTED`=指定版本源码支持，非官方稳定契约；`VERIFIED`=实际执行并核对对应行为；`NOT_RUN`=未执行。未找到公开接口不等于证明不存在接口。本文无真实账户 `VERIFIED`。`UNSUPPORTED` 只针对当前接入路线的已知限制，不用来概括整个平台。

## 能力矩阵

| 平台与产品 | 可用证据 / 鉴权 | 指标与语义 | 移动可行性与本轮状态 |
|---|---|---|---|
| DeepSeek API | 官方 `GET https://api.deepseek.com/user/balance`；Bearer API Key [D1] | `is_available`；`balance_infos[]` 每币种字符串金额，total / granted / topped_up；CNY / USD。不提供该响应之外的累计 Token 或消费明细 | 最适合首个只读适配器。原生 HTTPS 技术上可实施是架构推断；三端网络、安全存储、真实账户校准 `NOT_RUN`。`DOC_SUPPORTED` |
| Moonshot / Kimi 开放平台 | 官方国际 `GET https://api.moonshot.ai/v1/users/me/balance`；Bearer MOONSHOT_API_KEY [K1] | 当前官方国际 schema 为 `available_balance` / `voucher_balance` / `cash_balance`，单位 USD；现金可能负数。不能直接复用 DeepSeek schema | 国际文档明确 Key 与站点绑定。国内文档抓取超时，国内具体 schema、币种须单独验证。所有真实请求 `NOT_RUN`。`DOC_SUPPORTED`（国际） |
| Kimi / Kimi Code 会员 | 官方 CLI Server API `GET /api/v1/oauth/usage`；CLI 管理的 OAuth 账户 [K2]。CLI `/usage` 官方支持 [K3] | CLI 服务可返回 5h / 7d / monthTotal / monthCode 等实际存在窗口，以及额外用量钱包；新旧套餐规则可能不同 [K4] | 这是 CLI 本地服务 API，不能把路径当成公网移动 API。CC-Switch 公网实现另属源码证据；独立第三方移动 OAuth 授权路线 `NOT_RUN` |
| MiniMax M Plan / Token Plan | 官方可读 FAQ 提供 `GET https://www.minimax.io/v1/token_plan/remains` + Bearer Subscription Key [M1] | 官方说明非视频受 5h 和周窗口控制、视频仅周窗口；两窗口独立。套餐 Key 与普通按量 Key 分开。FAQ没有完整 response schema | 有可靠官方入口，应排首批候选；响应字段/单位、国内域名、旧套餐兼容均需 PoC，不能以 CC-Switch 旧接口替代当前官方接口证明。`DOC_SUPPORTED`，请求 `NOT_RUN` |
| MiniMax 按量 API | 官方账户 FAQ 说明余额控制台与余额提醒 [M2]；本轮未找到公开文档化余额查询 API | 账户现金余额与 M Plan/credit packs 不能混合。模型单次 usage 不是账户累计用量 | 先手动录入余额或跳转官方控制台；自动余额路线待查证。`NOT_RUN` |
| 智谱 GLM Coding Plan | 官方说明 5h 与周积分窗口，控制台查额度 [Z1][Z2]；本轮未在官方 API 索引找到公开额度查询契约 [Z3] | 积分不是原始 Token。当前套餐 5h 动态刷新、周从下单起计，重置卡还可能改周期；不得只按自然周计算 | CC-Switch quota/limit 属 `SOURCE_SUPPORTED`，官方域名不能自动升级为公开官方接口；独立移动调用权限与稳定性 `NOT_RUN` |
| 智谱标准 API 钱包 | 官方 Coding Plan FAQ 明确套餐不会在耗尽后继续消耗其他资源包/账户余额 [Z2]。本轮未发现公开钱包查询 API | 钱包、资源包、Coding Plan 必须独立数据源与指标 | 先手动记录。控制台接口如后续发现，也需标为非公开且另验权限，`NOT_RUN` |
| OpenAI API | 官方组织 usage `GET /v1/organization/usage/completions`、costs `GET /v1/organization/costs` 等 Admin API [O1][O2]；Admin Key / usage 读权限 | 按桶累计 Token、请求、费用；是组织/项目 API 账单数据，不是 ChatGPT/Codex 订阅额度或钱包余额 | 手机原生 HTTP并非主要障碍，组织管理权限过大是接入门槛；MVP建议不要求个人用户交付广权限管理 Key。真实 API 与最小授权验证 `NOT_RUN` |
| ChatGPT / Codex 订阅 | 官方 Codex app-server JSON-RPC `account/rateLimits/read`、`account/usage/read` [O3]；ChatGPT/Codex 服务认证 | usedPercent、windowDurationMins、resetsAt；多 limitId；token-activity summary。官方价格说明 dashboard / CLI `/status`，且不同计划窗口可不同 [O4] | `DOC_SUPPORTED`（Codex runtime），不是通用移动公网余额 API。手机集成 app-server 与合法独立 OAuth/发布资格 `NOT_RUN`；暂以手动快照回退。另有开放源码/本地托管 App 的 ChatGPT plan usage OAuth 预览 [O5]，主流程涉及推理权限，不能据此证明只读手机 quota 连接已受支持 |
| Claude Pro / Max | 官方 Settings > Usage 展示 5h 与周进度/重置 [C1]；本轮未找到面向个人订阅的公开 read-only quota REST 契约 | Claude与Claude Code共享订阅额度；API Console 账单另管 [C2] | 手动快照/官方页。消费 OAuth或网页私有接口不是 Admin API，移动可用与授权 `NOT_RUN` |
| Claude API Console | 官方 `/v1/organizations/usage_report/messages`、`/v1/organizations/cost_report`；Admin Key（x-api-key + anthropic-version）或官方允许的管理凭据 [C3] | 组织 Token、缓存分类、按日 USD 费用；不等于剩余 prepaid balance。Usage 可1m/1h/1d，cost每日桶 | `DOC_SUPPORTED`；普通workspace key不能用。管理权限敏感，推迟个人MVP；实时性/分页/最小权限/真实校准 `NOT_RUN` |
| Gemini Apps / Google AI会员 | 官方 Gemini 使用限制页说明窗口及应用内查询 [G1]；本轮未找到公开第三方会员 quota API | 动态额度；不要用 Gemini API速率限制替代 Gemini Apps会员余量 | 手动快照/官方页，自动移动查询 `NOT_RUN` |
| Gemini API / AI Studio | 官方 billing 文档有 AI Studio Usage/Billing；prepay balance须在 AI Studio 管理 [G2]。Cloud Billing可导出 BigQuery成本 [G3] | Cloud账单成本有延迟，BigQuery数据非实时；API Key不是账单 OAuth/IAM凭据 | 普通Gemini API Key没有证据可直接读预付余额。BigQuery需预先配置、IAM且可能收费，非个人MVP默认路径；所有真实验证 `NOT_RUN` |

## 刷新、失败与移动端判断

本轮文档没有为 DeepSeek余额、Moonshot余额、MiniMax余量给出可作为产品承诺的轮询QPS/账单更新时间 SLA。建议前台按需刷新、请求合并、短期缓存、429遵守 Retry-After、退避加抖动，是设计建议，不是供应商规定。不要把分钟/小时统计桶误当作实时更新保证。

原生 iOS/Android/HarmonyOS HTTP调用不受网页浏览器 CORS规则约束，是一般架构判断；不代表平台允许第三方App持有该Key，更不代表后台可任意定时运行。待下一阶段验证：官方授权/条款、独立凭据输入与撤销、系统安全存储、网络许可、后台调度、区域可达性、设备时间误差、实际 response schema。不要为刷新配额调用生成接口，从而产生费用或改变用量。

公共托管App的内置平台Key不可用；若支持用户自带Key，需按最小权限、安全存储、默认不备份、不日志/遥测上传处理。Moonshot官方将其API Key标为server-side secret [K1]，这意味着“用户自带Key直连手机”不能仅凭HTTP可达性视为官方批准，需单列发布与安全审查。

## 调研分工与统一排序

独立文档调研已由主 Agent 复核 DeepSeek、MiniMax、Moonshot、Codex App Server、OpenAI Usage、Anthropic Usage、GLM 套餐、Kimi CLI Server 及 Gemini billing 的关键官方页面，并对照固定 commit 源码。未执行 Pi 任务。本轮采用内部研究子代理，没有启动用户侧新聊天或付费模型推理验证。统一接入顺序以综合结论第 7 节为准：DeepSeek → MiniMax → Moonshot；余额接口存在不代表手机存储 Key 获得平台许可。

## 证据索引（均为官方一手来源）

- D1 https://api-docs.deepseek.com/api/get-user-balance/ （正文含GET、Bearer、完整字段；本轮已读）
- K1 https://platform.kimi.ai/docs/api/balance （由https://platform.moonshot.ai/docs/api/balance重定向；正文含Bearer、当前schema、USD与站点独立说明；国内https://platform.moonshot.cn/docs/api/balance本轮两次超时）
- K2 https://www.kimi.com/code/docs/en/kimi-code-cli/reference/server-api.html （官方CLI本地Server API；本轮搜索可读正文）
- K3 https://www.kimi.com/code/docs/en/kimi-code/faq.html （区分Coding会员与开放平台；/usage）
- K4 https://www.kimi.com/code/docs/en/kimi-code/error-reference.html （本轮可读，明确7d只适用旧计划、5h与月额度错误分别处理）；会员页 https://www.kimi.com/code/docs/en/kimi-code/membership.html 不同缓存摘录存在新旧规则差异，故不固定所有账户周窗口。
- M1 https://platform.minimax.io/docs/m-plan/faq （本轮可读正文137–163行为官方余量curl与窗口，220–252行为Key分类；旧/token-plan/faq重定向到此）
- M2 https://platform.minimax.io/docs/faq/about-account （本轮可读，余额控制台与提醒）
- M3 https://platform.minimaxi.com/subscribe/coding-plan （国内官方套餐页搜索索引含 https://www.minimaxi.com/v1/token_plan/remains；直接打开重定向platform.minimax.cn且正文0行，只作弱线索，不作为已读schema或国内验证证据）
- Z1 https://docs.bigmodel.cn/cn/coding-plan/overview （本轮可读，积分语义与窗口规则）
- Z2 https://docs.bigmodel.cn/cn/coding-plan/faq （本轮可读，控制台查看、适用范围与套餐/钱包隔离）
- Z3 https://docs.bigmodel.cn/llms.txt （本轮可读官方索引；未找到公开quota/limit不等于证明不存在）
- O1 https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/completions （本轮可读）
- O2 https://developers.openai.com/api/reference/python/resources/admin/subresources/organization/subresources/usage （本轮可读，含costs）；管理读权限示例 https://developers.openai.com/api/docs/guides/decisions （本轮搜索正文明确admin key + api.usage.read）
- O3 https://learn.chatgpt.com/docs/app-server （由https://developers.openai.com/codex/app-server重定向；本轮已读rateLimits/read与usage/read章节）
- O4 https://learn.chatgpt.com/docs/pricing （由https://developers.openai.com/codex/pricing重定向；本轮已读，dashboard、/status与API独立说明；限额不建议抄成固定计划表）
- O5 https://developers.openai.com/siwc/token-sharing-open-source （本轮可读，开源/本地App计划用量OAuth预览；这不是独立quota REST接口授权证明）
- C1 https://support.claude.com/en/articles/9797557-usage-limit-best-practices （本轮可读，Settings > Usage）
- C2 https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan （本轮可读，订阅与Console两套系统）
- C3 https://platform.claude.com/docs/en/manage-claude/usage-cost-api （本轮可读，端点、管理凭据、时间桶与费用单位）
- G1 https://support.google.com/gemini/answer/16275805?hl=en （本轮可读，应用限制与页面查看；限制可变）
- G2 https://ai.google.dev/gemini-api/docs/billing （本轮可读，AI Studio账单与预付体系；不同搜索缓存存在迁移措辞差异，故不承诺所有账户同一支付计划）
- G3 https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-setup （本轮可读，配置权限、成本与延迟）

## 主 Agent 源码复核边界

CC-Switch源码由主Agent锁定 ddcb111765be66ed9e7e43e240497fd2c9576688 并独立阅读。其 MiniMax `/v1/api/openplatform/coding_plan/remains`、Kimi `/coding/v1/usages`、GLM `/api/monitor/usage/quota/limit` 只是源码路线；本文没有将其升级为公开文档契约。PoC和最终报告证据以主Agent执行结果为准。
