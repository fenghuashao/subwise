# HarmonyOS 独立跟踪

当前阶段：BLOCKED（未定位可执行的 DevEco/Hvigor/Harmony SDK），原生构建/安装/运行 NOT_RUN；不阻塞 Android 与 iOS 主线。

本轮只查 PATH，以及 C/D Program Files、AppData/Local 中与 Huawei/DevEco/Harmony 相关的标准目录，未全盘搜索，也未读取签名、账号、私有 SDK 配置。没有发现工具不等于证明整机绝无安装。

P03-B 原生候选位于 `mobile/p03-b/harmony`：Stage 工程，API 12，Hvigor modelVersion 5.0.0。modelVersion 不是实际已安装的 Hvigor/ArkTS 插件版本。未解析依赖，因此不能凭 JSON 合法断言编译可行。

关闭此跟踪项的最小步骤：

1. 在可用 DevEco 中打开候选工程，记录 DevEco、HarmonyOS SDK/API、ArkTS 编译器、Hvigor 与插件实际版本，解析并保留依赖锁文件。若需安装全局工具或授权签名，先由 FA 确认对应操作。
2. 无真实凭据地运行编译，记录完整错误。重点核对 `@kit.AssetStoreKit` 的 Tag/枚举及删除后查询无结果行为、RDB begin/commit/rollback、ArkUI 严格类型与通知授权签名。只针对编译问题做最小修复。
3. 使用合法签名在原生 HarmonyOS 设备或对应模拟器安装 HAP；记录包 SHA-256、设备系统/API。Android APK 兼容运行不计入本项。
4. 对同一模拟 fixture 验证适配器→RDB→UI、应用重启、安全标记写读删、无凭据 HTTPS、权限拒绝和通知送达。候选 RDB 与 RN 快照模型仍有差异，不在本次环境收口任务中重构。
5. 交付证据并等待复核。未通过前仅保持独立跟踪，不能宣称三端通过，也不自动引入 RN OpenHarmony 或 Flutter 替代。

官方入口： https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-software-install （本轮自动化抓取正文为空；应在 DevEco/官方站实际核对）。
