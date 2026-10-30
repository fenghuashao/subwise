# Subwise 本机开发环境（Linux 云服务器）

日期：2026-10-30。本文档描述在 Ubuntu 24.04 / 4 核 3.6GB 云服务器上把仓库跑起来的完整步骤与已验证结果。

> 这台机器**不是** FA 的开发机。FA 的 Windows 开发机用于 iOS / Android 正式验收与发布签名；本机用于日常开发、验证与自动化回归。
> 本机跑不了 iOS（无 Mac/Xcode），也跑不了 HarmonyOS（无 DevEco 工具链）。这两端一律标 NOT_RUN。

## 目录与状态

| 路径 | 说明 |
|---|---|
| `~/projects/subwise` | 仓库工作副本（SSH 克隆，main 分支） |
| `.local/p03-b1/sdk` | Android SDK（platforms/build-tools/NDK/CMake/system-images） |
| `.local/p03-b1/gradle` | Gradle 9.0.0 + 依赖缓存 + **镜像与内存配置 init.gradle** |
| `.local/p03-b1/env.sh` | 环境变量加载脚本 |

`.local/` 已被 `.gitignore` 忽略（`mobile/p03-b/.gitignore` 覆盖 `**/.local/`），所有构建产物都不入库。

### 已清理的无用文件（2026-10-30）

| 已删 | 大小 | 原因 |
|---|---|---|
| `sdk/system-images/android-34/` | 4.2G | 该镜像下的 AVD 被 cgroup OOM kill（qemu 需 ~1.7GB anon-rss，本机不够），从未真正跑起来；最终用的是 API 30 |
| `~/.android/avd/subwise_api34.avd` + `.ini` | 734M | 指向已删镜像，留着就是坏配置 |
| `.local/p03-b1/android-tools/` | 158M | 只剩一份已解压完的 cmdline-tools zip 残留；完整工具链已在 `sdk/cmdline-tools/latest/`（sdkmanager 19.0 可用） |

**清理后已验证**：sdkmanager / adb / emulator 均正常，`sdkmanager --list_installed` 显示
platform-tools、platforms;android-36、build-tools;35.0.0 + 36.0.0、ndk;27.1.12297006、
cmake;3.22.1、emulator、system-images;android-30;default;x86_64 全部在位；
`./gradlew assembleRelease` 仍然 `BUILD SUCCESSFUL in 27s`。

磁盘：59G 总量，清理后 **23G 可用**（清理前 18G）。`.local/` 整体约 9G。

## 一键加载环境

```bash
source ~/projects/subwise/.local/p03-b1/env.sh
```

设置：`JAVA_HOME`（JDK 17）、`ANDROID_HOME` / `ANDROID_SDK_ROOT`、`GRADLE_USER_HOME`、`EXPO_NO_TELEMETRY`，并把 `platform-tools` / `cmdline-tools` 加进 PATH。全部是进程级变量，不改全局配置。

## 跑 Web 前端（仓库根目录）

```bash
cd ~/projects/subwise
npm start           # → http://127.0.0.1:4173
npm run check       # node --check server.js && node --check app.js
```

零依赖（仅 Node 内置模块），要求 Node >= 22（本机 24.21.0）。

## 跑 P03-B 移动端探针

```bash
cd ~/projects/subwise/mobile/p03-b/rn
npm install
npm test            # node --test tests/*.test.mjs  → 8 passed
npm run check       # tsc --noEmit              → exit 0
npx expo export --platform web --output-dir dist-web

cd ~/projects/subwise
node docs/mobile/p03-b/serve-web.mjs   # → http://127.0.0.1:4175（带 COOP/COEP，SQLite WASM 需要）
```

## 构建 Android release APK

```bash
source ~/projects/subwise/.local/p03-b1/env.sh
cd ~/projects/subwise/mobile/p03-b/rn/android

echo "sdk.dir=$ANDROID_HOME" > local.properties

./gradlew -p . assembleRelease \
  -PreactNativeArchitectures=x86_64 \
  --no-daemon --console plain --max-workers=1
```

产物：`app/build/outputs/apk/release/app-release.apk`

**本机已实测**：`BUILD SUCCESSFUL in 5m 30s`，256 tasks，APK 27,560,663 bytes，sha256 `52e9f1de…c1531`，apksigner v2 验证通过。

### 本机构建参数与上游不同的地方

**内存约束放在 `init.gradle`，不是 `android/gradle.properties`。**

`expo prebuild` 会重新生成 `android/` 目录并把 `gradle.properties` 覆盖回
`org.gradle.parallel=true` + `-Xmx2048m`。本机 4 核 3.6GB 扛不住这个默认值：
Gradle 守护进程和多个 clang 一起把内存打满 → swap 耗尽 → IO wait 93% →
**构建卡在换页里零进展**（实测 60 秒内 .o 数量不变，看起来像在跑其实没动）。

所以约束写在 `$GRADLE_USER_HOME/init.gradle`（不在 prebuild 的重写范围内）：

```groovy
gradle.settingsEvaluated { settings ->
  settings.gradle.startParameter.maxWorkerCount = 1
}
gradle.projectsLoaded {
  rootProject { ext.set('org.gradle.parallel', 'false') }
}
```

**已实测验证**：把 `gradle.properties` 手动重置回 `parallel=true` + 2048m 后，
构建仍稳定通过（43 秒，内存峰值不涨，IO wait 0%，swap 未打满），APK 哈希不变。

> Gradle 9.0 移除了 `startParameter.setMaxParallelThreads()`，调用它会报
> `No signature of method: org.gradle.api.internal.StartParameterInternal.setMaxParallelThreads()`。
> 用 `settings.gradle.startParameter.maxWorkerCount = 1` 代替。

## 模拟器启动与安装

```bash
source ~/projects/subwise/.local/p03-b1/env.sh

# AVD（已创建）
emulator -avd subwise_api30 -no-window -no-audio -no-boot-anim -gpu off \
  -no-snapshot -accel off -memory 1024 -cores 2 -no-metrics -read-only &

adb wait-for-device
# 等 boot 完成（本机 TCG 软件模拟约 400 秒）
adb shell getprop sys.boot_completed    # → 1

adb push app/build/outputs/apk/release/app-release.apk /data/local/tmp/subwise.apk
adb shell pm install -r -t /data/local/tmp/subwise.apk    # → Success
adb shell monkey -p dev.subwise.p03b -c android.intent.category.LAUNCHER 1
```

### 模拟器的本机限制

- **无 `/dev/kvm`** → 只能 TCG 软件模拟，API 30 镜像 boot 约 400 秒。
- API 34 (google_apis) 镜像会直接被 cgroup OOM kill（qemu 需 ~1.7GB anon-rss，本机峰值不够）→ 改用 API 30 default 镜像 + `-memory 1024`。
- 模拟器进程本身也会被 OOM kill（实测 2 次）。**跑模拟器前先关掉常驻服务**（web 服务、mcp-server 等），否则内存不够。
- `adb install`（streamed）在慢链路上会失败；用 `push` + `shell pm install` 更稳。
- 模拟器仅代表模拟器环境。**物理真机仍为 NOT_RUN**。

## 本机验证过什么（2026-10-30）

| 项 | 结果 | 证据 |
|---|---|---|
| `npm run check` | exit 0 | server.js / app.js 语法通过 |
| Web 六视图切换 | PASS | Playwright + Chromium，逐视图点击 |
| 前端新增订阅弹窗 | PASS | 弹窗可见，含 10 个输入项 |
| `/api/capabilities` | PASS | 两个平台 `configured:false` |
| 用量接口无密钥 | PASS | 返回 `not_configured`，文案正确 |
| 用量接口伪密钥 | PASS | 抵达官方接口并回传真实上游报错「login fail」 |
| P03-B 探针 `npm test` | 8 passed | node --test |
| P03-B 探针 `tsc --noEmit` | exit 0 | — |
| P03-B Web 版 SQLite | PASS | 真实 WASM 写入 → 损坏响应保留旧快照 → 重载后仍在 |
| Android release 构建 | **PASS** | BUILD SUCCESSFUL，APK + apksigner v2 |
| Android 安装 | PASS | `pm install` Success，包名 `dev.subwise.p03b` |
| App 启动 | PASS | `mResumedActivity: dev.subwise.p03b/.MainActivity`，无崩溃 |
| 原生 SQLite 写入 | PASS | 模拟适配器 → SQLite → UI 全链路 |
| 杀进程重启后数据保留 | PASS | force-stop → 重启后快照仍在 |
| 飞行模式冷启动 | PASS | 断网启动仍读到本地快照 |
| 系统安全存储写/读/删 | PASS | logcat 出现 Android Keystore AES/GCM 条目 |
| 无凭据 HTTPS 探针 | PASS | HTTP 401，符合预期 |
| 本地通知投递与取消 | PASS | 系统 NotificationRecord 确认投递，取消后清理 |
| 四导航切换 | PASS | 总览/订阅/用量/我的 |

**未验证（NOT_RUN）**：iOS 构建与运行、HarmonyOS 构建与运行、物理真机、锁屏/卸载/备份下的通知行为、
时区与月底续费提醒、生产发布签名。

## 网络镜像（本机必需）

官方源在本网络下是 307 跳转 + 10 秒读超时，会让 Gradle wrapper 直接抛 `SocketTimeoutException`。
已做的处理：

1. **Gradle 发行版**：官方 `services.gradle.org` 下载慢 → 从 `https://mirrors.cloud.tencent.com/gradle/gradle-9.0.0-bin.zip` 下载，
   再用官方 `gradle-9.0.0-bin.zip.sha256` 校验一致
   （`8fad3d78296ca518113f3d29016617c7f9367dc005f932bd9d93bf45ba46072b`）。
   文件放在 `$GRADLE_USER_HOME/wrapper/dists/gradle-9.0.0-bin/<hash>/` 下，wrapper 会直接使用。
2. **依赖仓库**：`$GRADLE_USER_HOME/init.gradle` 用 `beforeSettings` 钩子把 `pluginManagement` 与 `allprojects`
   仓库改走 `maven.aliyun.com`（google / public / gradle-plugin 三个仓库），并把 HTTP 连接与读超时提到 60s / 120s。
3. **npm**：本机 npm 已配置腾讯云镜像（`npm ping` → `https://mirrors.tencentyun.com/npm`）。

TLS 校验全程保持开启，没有关闭证书验证，没有使用非官方制品源。

### init.gradle 的坑

init script 里**不能**写 `pluginManagement { }` 块 —— Gradle 报
`Only Settings scripts can contain a pluginManagement {} block`。必须用 `beforeSettings { settings -> ... }` 钩子。

### sdkmanager 19.0 的参数变化

`--sdk` 和 `--no-metrics` 都不再支持，会直接报 `Unknown argument`。
正确用法：`sdkmanager --install --sdk_root=<path> "<package>"`。

`yes | sdkmanager` 会因 SIGPIPE 让退出码变成 141；licenses 目录直接预置 license 文件更干净。

## 已知小问题

- `favicon.ico` 返回 404 —— 浏览器控制台唯一报错。`index.html` 没有 `<link rel="icon">`，修法是补一个内联 SVG favicon。
- 前端用 localStorage 存数据，**首次打开会载入 5 条演示订阅**（`createDemoSubscriptions()`）。清 localStorage 会重置。

## 回滚

- 删 `.local/p03-b1/` 即可移除全部本机工具链与缓存（约 7.4GB）。
- `mobile/p03-b/rn/android/`、`dist-web/`、`dist-native/`、`node_modules/` 均被 gitignore。
- `docs/mobile/p03-b1/evidence/acceptance-linux-2026-10-30.json` 与 `android-*.png/xml` 是本轮证据，入库与否由 FA 决定。
- 本轮**没有**修改任何业务代码、已批准 UI 或旧报告，**没有** commit / push。
