# Subwise 阶段收尾：P03-B1-Linux 原生解阻与验收

日期：2026-10-30（Asia/Shanghai）。执行环境：Ubuntu 24.04 / Linux 6.8.0-138-generic 云服务器，4 核 3.6GB RAM / 2GB swap，**无 `/dev/kvm`**。

本轮性质：把上一轮（P03-B1，Windows）标记为 BLOCKED 的 **Android 原生构建与验收门**在 Linux 上解开并实测通过。
本轮**不进入** P03-C / P04，**不改动**任何业务代码与已批准 UI。

## 结论

| 范围 | 状态 | 依据 |
|---|---|---|
| Android 原生构建 | **PASS** | `BUILD SUCCESSFUL in 5m 30s`，APK 已产出 |
| Android 安装与启动 | **PASS** | `pm install` Success；`mResumedActivity: dev.subwise.p03b/.MainActivity` |
| Android 原生能力门 | **PASS** | SQLite 写入 / 重启保留 / 离线冷启 / 安全存储 / HTTPS / 通知 六项实测通过 |
| Web 工作台 | **PASS** | 六视图切换、新增订阅弹窗、API 两条路径实测通过 |
| P03-B 探针 | **PASS** | 单测 8 passed；`tsc` exit 0；真实 SQLite WASM 全链路通过 |
| iOS | **NOT_RUN** | 本机为 Linux，无 Mac/Xcode/CocoaPods |
| HarmonyOS | **NOT_RUN** | 未定位到 DevEco/Hvigor 工具链 |
| 物理真机 | **NOT_RUN** | 模拟器结果不可替代真机结论 |
| 生产发布签名 | **NOT_RUN** | 本轮使用 Expo 模板 debug 证书 |

**PASS ＝该项在注明范围内实测满足；NOT_RUN ＝ 没有执行。**
模拟器证据不等于物理设备证据；Android 一端通过不等于三端完成。

## 上一轮 BLOCKED 的真实根因

上一轮记录为「官方 Gradle/Maven/Google 依赖下载反复 TLS 握手中断，3 次构建全部 FAIL，APK 未产出」。本轮定位到的具体原因：

1. **Gradle 发行版下载超时** —— 官方 `services.gradle.org` 在本网络返回 307 跳转，wrapper 默认 `networkTimeout=10000`，
   下载过程中直接抛 `SocketTimeoutException: Read timed out`。构建**从未进入编译阶段**，
   所以上一轮看到的「TLS 握手中断」是表象，真实卡点是发行版拉不下来。
2. **依赖仓库不可达** —— `repo.maven.apache.org` / `dl.google.com` 在本网络同样存在长连接读超时。
3. **内存与并发不匹配** —— 4 核 3.6GB 机器上默认 `org.gradle.parallel=true` + `-Xmx2048m` 会让
   Gradle 守护进程与多个 clang 同时把内存打满，swap 耗尽后 IO wait 达 93%，
   **构建卡在换页里零进展**（实测 60 秒内 `.o` 数量不变，进程仍在，表现为「像在跑其实没动」）。

前两项属网络通路问题，第三项属本机资源问题，两者叠加才导致上一轮的 BLOCKED。

## 本轮采取的措施

### 网络（TLS 校验全程保持开启，未使用任何非官方制品源）

| 项 | 措施 | 验证 |
|---|---|---|
| Gradle 发行版 | 从 `mirrors.cloud.tencent.com/gradle/` 下载 | 官方 `.sha256` 校验一致：`8fad3d78296ca518113f3d29016617c7f9367dc005f932bd9d93bf45ba46072b` |
| 依赖仓库 | `$GRADLE_USER_HOME/init.gradle` 用 `beforeSettings` 钩子改走 `maven.aliyun.com`（google / public / gradle-plugin） | 构建实际从镜像解析，137 个依赖模块全部到位 |
| HTTP 超时 | 连接 60s / 读 120s（init script 内设置） | — |
| npm | 本机已配腾讯云镜像 | `npm ping` → `mirrors.tencentyun.com/npm` |

### 工具链

`sdkmanager 19.0` 的参数与旧文档不同：`--sdk` 与 `--no-metrics` 已移除，改用 `--sdk_root`。
命令行工具下载后用官方元数据 SHA-1 核对一致（`5fdcc763663eefb86a5b8879697aa6088b041e70`）。

实际安装并逐个核对文件存在性：

| 包 | 核对点 |
|---|---|
| `platforms;android-36` | `android.jar` 存在 |
| `build-tools;36.0.0` | `aapt2` 存在 |
| `ndk;27.1.12297006` | `source.properties` 版本匹配 |
| `cmake;3.22.1` | `bin/cmake` 存在 |
| `platform-tools` | `adb` 存在 |
| `system-images;android-30;default;x86_64` | `system.img` 存在 |

### 内存与并发（防回归设计）

内存约束写在 **`$GRADLE_USER_HOME/init.gradle`**，而不是 `android/gradle.properties`：

```groovy
gradle.settingsEvaluated { settings ->
  settings.gradle.startParameter.maxWorkerCount = 1
}
gradle.projectsLoaded {
  rootProject { ext.set('org.gradle.parallel', 'false') }
}
```

原因：`expo prebuild` 会重新生成 `android/` 目录并把 `gradle.properties` 覆盖回
`parallel=true` + `-Xmx2048m`。约束若写在工程文件里，重跑 prebuild 后就会失效并重现假死。

**已做防回归验证**：手动把 `gradle.properties` 重置回默认值后重新构建，
仍 `BUILD SUCCESSFUL`（43s），内存峰值不涨、IO wait 0%、swap 未打满，APK 哈希不变。

> Gradle 9.0 移除了 `startParameter.setMaxParallelThreads()`（调用会报
> `No signature of method: org.gradle.api.internal.StartParameterInternal.setMaxParallelThreads()`），
> 改用 `settings.gradle.startParameter.maxWorkerCount = 1`。

## 实测证据

### 构建产物

| 项 | 值 |
|---|---|
| 路径 | `mobile/p03-b/rn/android/app/build/outputs/apk/release/app-release.apk` |
| 大小 | 27,560,663 bytes |
| SHA-256 | `52e9f1ded9a9cea9db0b0437c9616fd35be8744b0717454f3e188925d94c1531` |
| 包名 / 版本 | `dev.subwise.p03b` / `0.0.1` |
| SDK | minSdk 24 / targetSdk 36 / compileSdk 36 |
| 签名 | `apksigner verify` 通过（v2 scheme true）；签名者为 `CN=Android Debug`，**Expo 模板 debug 证书，仅测试用，非生产发布签名** |
| 内容 | `libexpo-sqlite.so` / `libexpo-modules-core.so` / `libhermesvm.so` / `libappmodules.so`（x86_64）；`assets/index.android.bundle` 1,150,164 bytes |
| 可复现性 | 清理 C++ 产物后重建，APK 哈希不变 |

### 原生运行（模拟器 `emulator-5554`，AVD `subwise_api30`，Android 11 / API 30，x86_64，TCG 软件模拟）

| 验收项 | 结果 | 实际观察 |
|---|---|---|
| 系统启动 | PASS | `sys.boot_completed=1`，耗时 412 秒 |
| App 安装 | PASS | `pm install -r -t` → Success；`pm list packages` → `package:dev.subwise.p03b` |
| App 启动 | PASS | `mResumedActivity: dev.subwise.p03b/.MainActivity`；logcat 无 FATAL / AndroidRuntime 异常；`ReactNativeJS: Running "main"` |
| SQLite 写入 | PASS | 点击「写入模拟数据并从 SQLite 读取」→ 状态变为「模拟适配器 → SQLite → UI 完成；非平台同步」，UI 显示 `CNY 110.00` / `USD 0.00` / `剩余 62 / 100` |
| 终止进程后重启保留 | PASS | `am force-stop` → 重新启动 → 快照仍在，状态「SQLite 已打开 · 已读取本地记录」 |
| 飞行模式冷启动 | PASS | `airplane-mode enable` + wifi/data disable → force-stop → 重启 → 仍打开 SQLite 并显示本地快照 |
| 系统安全存储 | PASS | 状态「安全存储写 / 读 / 删通过（仅测试标记）」；logcat 出现 Android Keystore 真实条目 `keystore: del USRPKEY_AES/GCM/NoPadding:key_v1:keystoreUnauthenticated` |
| 无凭据 HTTPS 探针 | PASS | 状态「HTTPS HTTP 401 · 符合预期 · 未认证」（固定官方 DeepSeek 地址，不带 Authorization） |
| 本地通知 | PASS | 系统 `NotificationRecord(pkg=dev.subwise.p03b, channel=p03b, importance=3)` 确认投递；取消后状态「已清理本轮通知请求」 |
| 四导航 | PASS | 总览 / 订阅 / 用量 / 我的 均可切换 |

### Web 侧

| 项 | 结果 |
|---|---|
| `npm run check` | exit 0 |
| 六视图切换 | 全部成功（overview / subscriptions / usage / calendar / analytics / settings） |
| 新增订阅弹窗 | 可打开，含 10 个输入项 |
| `GET /api/capabilities` | 正常返回两平台 `configured:false` |
| `POST /api/usage/minimax`（无密钥） | 返回 `not_configured`，提示文案正确 |
| `POST /api/usage/minimax`（伪密钥） | 成功抵达官方接口并回传真实上游报错「login fail」，说明代理链路与错误分类可用 |
| 探针单测 | `node --test` → 8 passed / 0 failed |
| 探针 `tsc --noEmit` | exit 0 |
| 探针 Web 版 | 真实 `expo-sqlite` WASM（非替身）：写入 → 损坏响应保留旧快照 → 重载后仍在 |
| 原生 bundle | `expo export android+ios` → `.hbc` 各 1.9MB 生成成功 |

## 本机环境限制（不是产品缺陷）

- **无 `/dev/kvm`** → 模拟器只能 TCG 软件模拟，API 30 启动约 412 秒。
- API 34 镜像的模拟器被 cgroup OOM kill（qemu 需约 1.7GB anon-rss），故改用 API 30 default 镜像。
- 模拟器进程本身也曾被 OOM kill（2 次）→ 跑模拟器前需关闭常驻服务释放内存。
- `adb install`（streamed）在慢链路会失败，需改用 `push` + `shell pm install`。

以上均为本机资源/网络条件所致，**不构成对 RN/Expo 路线的否定，也不构成对产品代码的缺陷判定**。

## 已知小问题

- `favicon.ico` 返回 404（浏览器控制台唯一报错）。`index.html` 无 `<link rel="icon">` 声明。
  属可修复的轻微项，本轮未改业务代码，故未修。

## 与上一轮的关系

上一轮的 `README.md`、`SUBWISE-P03-B1-REPORT.html`、`build-report.mjs`、`verify-report.mjs`
及其 `evidence/*.json` **一字未改**，作为历史证据保留。

上一轮的校验脚本 `verify-report.mjs` 第 13 行硬编码断言「APK 必须不存在」（固化旧轮次 BLOCKED 状态），
在本轮 APK 产出后该断言会失败。本轮按仓库「历史证据 scoped」纪律，
**未修改旧脚本**，改为新建独立校验脚本 `verify-report-linux.mjs` 断言新状态。
旧脚本的失败属于预期，它服务于旧轮次结论。

## 交付物

| 文件 | 用途 |
|---|---|
| `docs/mobile/p03-b1/P03-B1-LINUX-REPORT.md` | 本文档（阶段收尾报告） |
| `docs/mobile/p03-b1/LINUX-DEV-ENV.md` | 本机开发环境完整说明与可复现命令 |
| `docs/mobile/p03-b1/evidence/acceptance-linux-2026-10-30.json` | 本轮验收状态结构化证据 |
| `docs/mobile/p03-b1/evidence/android-screenshot.png` | 模拟器运行截图 |
| `docs/mobile/p03-b1/evidence/android-ui-final.xml` | 模拟器 UI 层级 dump |
| `docs/mobile/p03-b1/evidence/linux-baseline.json` | 本轮基线哈希 |
| `docs/mobile/p03-b1/verify-report-linux.mjs` | 本轮独立校验脚本 |
| `docs/mobile/p03-b1/build-report-linux.mjs` | 本轮报告生成脚本 |

## 下一步建议

1. **iOS** —— 在 Mac 上解压 `artifacts/subwise-p03-b1-mac-handoff.zip`，根目录执行
   `node mobile/p03-b1/mac-verify.mjs`。本轮未做 iOS 构建与运行，此端仍 NOT_RUN。
2. **HarmonyOS** —— 独立跟踪，见 `HARMONY-TRACK.md`。未通过前不宣称三端支持。
3. **物理真机** —— 模拟器结论不可替代真机验收。
4. **P03-C 授权** —— 本轮 Android 一端已过原生门，但**不等于**自动获得 P03-C 授权，
   仍需 FA 确认后再开始真实平台接口接入。
5. **P04** —— 本地领域与存储模型（订阅/账户/用量窗口模型、迁移、备份恢复）。

## 安全与范围声明

- 全程**未使用真实平台凭据**；密钥仅从环境变量读取，未落盘、未进代码、未写入报告。
- **未关闭** TLS 或证书校验，**未使用**私有/未经验证的制品源。
- 未修改全局 Java/Gradle/代理/网络配置，未修改全局 Android SDK。
- 未修改任何业务代码、已批准 UI 或旧轮次报告。
- 本轮 commit 并推送了本报告与本轮证据文件（FA 于 2026-10-30 明确授权）。
