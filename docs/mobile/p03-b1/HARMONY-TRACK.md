# HarmonyOS 独立跟踪

当前阶段：**编译 BLOCKED 已解除（2026-10-30）**；安装与运行仍 NOT_RUN。不阻塞 Android 与 iOS 主线。

## 状态

| 项 | 状态 | 依据 |
|---|---|---|
| 可执行工具链 | ✅ 已定位 | 官方 HarmonyOS CLI Tools 5.1.0.840 (linux-x64) |
| ArkTS 编译 | ✅ **PASS** | ERROR 0 / WARN 2，产出未签名 HAP |
| HAP 签名 | ❌ NOT_RUN | 无 signingConfig / 无证书 |
| 设备安装与启动 | ❌ NOT_RUN | 无原生设备与模拟器 |
| 运行时行为核对 | ❌ NOT_RUN | 需真机执行 |

完整过程、工具链版本、改动与产物事实见 [P03-B1-HARMONY-LINUX-REPORT.md](P03-B1-HARMONY-LINUX-REPORT.md)，
机器可读证据见 `evidence/harmony-compile-linux-2026-10-30.json`。

## 本轮之前的状况

P03-B 期间只查了 Windows 主机 PATH 与 C/D Program Files、AppData/Local 等标准目录，未全盘搜索，
也未读取签名、账号、私有 SDK 配置。当时未发现工具，**不等于证明整机绝无安装**。

候选工程位于 `mobile/p03-b/harmony`：Stage 工程，`runtimeOS: HarmonyOS`。当时写的是
Hvigor modelVersion 5.0.0 / API 12 —— 那不是实际已安装的工具版本。当时未解析依赖，
因此不能凭 JSON 合法断言编译可行。这一点已被本轮证实：配置看似合法，源码里却有 15 个真编译错误。

本轮改用 Linux 命令行工具链替代 DevEco GUI，绕开了 IDE 依赖。

## 遗留待确认项

- **编译目标 API 被抬高**：`compileSdkVersion` 由 `5.0.0(12)` 改为 `5.1.0(18)`，因为可用工具链仅含 API 18。
  `compatibleSdkVersion` 保持 `5.0.0(12)`，设备最低要求未变。若需严格按 API 12 编译，须另取对应 SDK 重跑。
- **SemVer 告警未修**：entry 模块版本 `0.0.1` 不合规，hvigor 正则 `/^[1-9]\d?(\.([1-9]?\d)){2}$/` 要求首段非 0。
  这是产品版本号，属 FA 决定，本轮未擅改。
- **HAP sha256 不可复现**：zip 条目带构建时间戳，同源码两次构建摘要不同；sha256 只标识本次产物。

## 关闭此跟踪项的最小步骤

1. ~~在可用 DevEco 中打开候选工程，记录实际版本，解析并保留依赖锁文件。~~
   **已完成**：改用官方命令行工具链，版本已记录于 `evidence/*.json`。
2. ~~无真实凭据地运行编译，记录完整错误。~~
   **已完成**：首轮 15 个 ArkTS 错误已完整记录并逐条修复，现 ERROR 0。
   其中包含 README 点名的 `@kit.AssetStoreKit` API 签名核对 —— SDK 声明为
   `type AssetMap = Map<Tag, Value>`，探针原按对象字面量构造，已改为 `Map`。
3. 使用合法签名在原生 HarmonyOS 设备或对应模拟器安装 HAP；记录包 SHA-256、设备系统/API。
   Android APK 兼容运行不计入本项。 ← **下一步卡在这里**
4. 对同一模拟 fixture 验证适配器→RDB→UI、应用重启、安全标记写读删、无凭据 HTTPS、权限拒绝和通知送达。
   候选 RDB 与 RN 快照模型仍有差异，不在本次环境收口任务中重构。
5. 交付证据并等待复核。未通过前仅保持独立跟踪，不能宣称三端通过，也不自动引入 RN OpenHarmony 或 Flutter 替代。

## 复现

```bash
cd mobile/p03-b/harmony && bash scripts/build-harmony-linux.sh
```

## 入口

官方安装页： https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-software-install
（此前自动化抓取正文为空，本轮未再抓取；工具链改为直接取包并校验 sha256。）
本轮工具链包： https://repo.huaweicloud.com/harmonyos/ohpm/5.1.0/commandline-tools-linux-x64-5.1.0.840.zip
