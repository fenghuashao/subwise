# Native HarmonyOS probe

独立于 Android/iOS 的 ArkTS/ArkUI Stage 候选工程，不是 Android 兼容包，也不是 RN OpenHarmony 方案。

**状态（2026-10-30 更新）**：ArkTS **编译已通过**（ERROR 0 / WARN 2），产出未签名 HAP。
**签名、安装、运行、Asset/RDB/通知的运行时行为仍全部 NOT_RUN** —— 编译时类型正确不等于运行时可用。
详见 [`docs/mobile/p03-b1/P03-B1-HARMONY-LINUX-REPORT.md`](../../../docs/mobile/p03-b1/P03-B1-HARMONY-LINUX-REPORT.md)
与 [`docs/mobile/p03-b1/HARMONY-TRACK.md`](../../../docs/mobile/p03-b1/HARMONY-TRACK.md)。

## 编译环境

使用官方 HarmonyOS 命令行工具链（非 DevEco GUI）：CLI Tools 5.1.0.840 / SDK 5.1.0 Release (API 18) /
hvigor 5.18.5 / ohpm 5.1.3。`@kit.AssetStoreKit` 等 Kit 在 SDK 中均在位。

构建配置：`compileSdkVersion 5.1.0(18)`、`compatibleSdkVersion 5.0.0(12)`、`runtimeOS: HarmonyOS`。
前者因可用工具链只带 API 18 而抬高；后者保持原值，设备最低要求未变。

原先写的候选 SDK 是 HarmonyOS 5.0.0(12) / Hvigor modelVersion 5.0.0，那并非实际可用工具版本。
原 README 那句"JSON 配置静态解析成功不等于 ArkTS 编译通过"已被本轮实证 —— 配置一路放行，
15 个真实错误全落在源码里。

## 编译

```bash
bash scripts/build-harmony-linux.sh
```

脚本自助下载并校验工具链（默认 `/opt/ohos-clt`），清理历史产物后跑 `--no-daemon` 干净构建，
输出 `harmony-build.json` 证据。已有工具链时加 `SKIP_DOWNLOAD=1`。

## 已修复的编译问题（留档）

| 问题 | 根因 |
|---|---|
| `00303024` 工程需升级 | 根 `oh-package.json5` 缺 `modelVersion`，须与 `hvigor-config.json5` 一致 |
| `00303168` SDK 组件缺失 | `compileSdkVersion` 指向本机没有的 API 12 |
| `10605087 arkts-limited-throw` | `throw error` 不允许抛任意类型，需包成 `Error` |
| `10605001 arkts-identifiers-as-prop-names` | 对象字面量不得用 `[asset.Tag.X]` 计算属性名 |
| `10505001` AssetMap 类型不符 | SDK 声明 `type AssetMap = Map<Tag, Value>`，非普通对象 |
| `decodeWithStream` deprecated | since 12 弃用，改用 `decodeToString` |

## 待处理

SemVer 告警：entry 模块版本 `0.0.1` 不合规（hvigor 要求版本号首段非 0）。属产品版本号，待 FA 决定是否改为 `1.0.0`。

## 运行时待验证项

勿将此候选用于真实账户数据。以下从未在真实设备上执行过：

- `@kit.AssetStoreKit` 删除后查询返回无记录的实际行为
- 关系库 `begin/commit/rollback` 事务语义
- 通知授权返回值
- 无凭据 HTTPS、UI、安全区、大字体、明暗主题

当前两端 SQL 模型不同：RN 保存不可变快照，Harmony 只保留当前探针行；
历史、幂等语义一致性和跨端合同测试尚未通过。

入口 `entry/src/main/ets/pages/Index.ets`；原生 API 探针在 `Probe.ets`，
共享模拟向量位于 `resources/rawfile/fixtures.json`。无三方依赖、无真实密钥或登录界面。
Asset Store 仅操作固定测试 alias；不枚举其他资产。HTTP 只发固定官方域名的无凭据 GET。

原生包及工具版本补齐前不升级为支持承诺。
