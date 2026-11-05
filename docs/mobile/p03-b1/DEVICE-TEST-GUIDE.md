# P03-B1 三端设备验证说明（2026-11-05）

每次验证使用本轮专用的输出目录。完成后先看各端 JSON 的 `status` 和失败断言，再汇总。

---

## 0. 你需要准备什么

| 端 | 设备 | 必需工具 | 产物 |
|---|---|---|---|
| Android | 安卓手机（或虚拟机） | adb、Bash、Python 3、GNU timeout | APK |
| iOS 模拟器 | Mac | Xcode、iOS 模拟器 runtime，自动点击可用 idb | iphonesimulator .app |
| iPhone 真机 | Mac 和已配对的 iPhone | Xcode、devicectl | iphoneos 开发签名 .app |
| HarmonyOS | 荣耀鸿蒙手机 | DevEco Studio 的 hdc | 签名 HAP |

**APK / .app / HAP 从哪来**：
- Android：CI 的 `subwise-p03b-android-apk` artifact（37,854,296 字节，release 版，含 arm64-v8a + armeabi-v7a，真机能装）。
  本地自己构建也行，见文末。
- iOS 模拟器使用 CI 的 `subwise-p03b-ios-simulator-app`。iPhone 真机须在 Xcode 中选择真机目标、配置开发签名并重新构建设备包。
- HarmonyOS：**CI 的 HAP 是未签名的，装不上真机**。必须你在 DevEco Studio 里配好签名（自动签名最省事）重新构建。

---

## 1. Android

```bash
# 手机：设置 → 关于手机 → 连点"版本号"7 次 → 开发者选项 → 开启 USB 调试
# 电脑上：
adb devices                      # 确认能看到你的设备，状态是 device 不是 unauthorized
```

跑：

```bash
cd <subwise 仓库>
APK_PATH=/path/to/app-release.apk \
EVIDENCE_DIR=./evidence-android \
  bash mobile/p03-b/device-test/verify-android-device.sh
```

脚本保留已有数据，依次执行写入、重新读取、模拟响应损坏、安全存储、无凭据 HTTPS 和通知调度。它核对点击及操作后的状态文案。出现系统权限弹窗时在设备上操作；通知调度成功后，实际送达仍需人工确认。

产出 `evidence-android/android-device-evidence.json`（外加截图、UI 层级、logcat）。

**你还要人工确认 2 件事**（脚本查不到）：
1. 通知栏里有没有真的收到「Subwise P03-B」通知。
2. 屏幕上「安全存储写 / 读 / 删通过」这句话有没有出现。

---

## 2. iOS 模拟器与 iPhone

```bash
cd <subwise 仓库>
# 模拟器
bash mobile/p03-b/device-test/verify-ios-device.sh \
  --kind simulator \
  --app .local/p03-b1/ios-derived/Build/Products/Release-iphonesimulator/SubwiseP03B.app \
  --out ./evidence-ios
```

`.app` 怎么来（Mac 上）：

```bash
cd mobile/p03-b/rn
npx expo prebuild --platform ios
cd ios
pod install
REPO_ROOT=$(git rev-parse --show-toplevel)
xcodebuild -workspace SubwiseP03B.xcworkspace \
  -scheme SubwiseP03B \
  -configuration Release \
  -sdk iphonesimulator \
  -derivedDataPath "$REPO_ROOT/.local/p03-b1/ios-derived" \
  CODE_SIGNING_ALLOWED=NO
```

模拟器通过 `simctl` 安装和启动。脚本先读 SQLite 基线，再尝试用绑定目标的 idb 点击，并检查本轮写入、两类快照及截图。已有固定快照时，还会核对本轮操作的完成文案。交互需要人工接手时会记录 `PARTIAL`。结果为 `ios-simulator-evidence.json`。

真机另跑一次。把下列参数换成已配对 iPhone 的标识和已签名的设备包路径：

```bash
xcrun devicectl list devices
bash mobile/p03-b/device-test/verify-ios-device.sh \
  --kind physical --device "<iPhone 标识>" \
  --app "/path/to/Release-iphoneos/SubwiseP03B.app" --out ./evidence-ios
```

真机脚本通过 `devicectl` 安装、启动。两步成功记 `PARTIAL`；当前尚未自动验证真机数据库与其他功能。结果为 `ios-physical-device-evidence.json`。两种证据可以放在同一目录。核对 JSON 中的 `targetKind`（请求目标）与 `deviceKind`（实际识别）；未识别到目标时后者为 `null`。

---

## 3. HarmonyOS（荣耀手机）

前置（一次性）：
1. DevEco Studio 里配好**签名**（工具 → 项目结构 → Signing Configs → 勾"自动签名"）。
2. Build → Build Hap(s)/APP(s) → Build Hap(s)，选 `entry`，产出 `entry-default-signed.hap`。
3. 手机开启「开发者选项 → USB 调试」，`hdc list targets` 能看到设备。

跑：

```bash
cd <subwise 仓库>
HAP_PATH=/path/to/entry-default-signed.hap \
EVIDENCE_DIR=./evidence-harmony \
  bash mobile/p03-b/device-test/verify-harmony-device.sh
```

脚本保留已有数据。它先读取 RDB 基线，点击「写入模拟数据并重新读取」，检查完成文案及两类数据的新行，再重启应用进程，核对落盘的行与本轮写入一致。已有安装可省略 `HAP_PATH`；连接多台时用 `HDC_TARGET` 指定目标。

产出 `evidence-harmony/harmony-device-evidence.json`。

**你还要人工确认 3 件事**：
1. 通知栏有没有收到「Subwise P03-B」通知。
2. 「我的」页点安全存储按钮后有没有显示「测试标记写读删完成」。
3. 「我的」页点 HTTPS 按钮后有没有显示「无凭据 HTTPS 状态 401」。

如调试沙盒和设备已有的只读查询方式均无法读取 RDB，脚本记录 `PARTIAL`。请核对调试签名以及设备和 hdc 对包级沙盒访问的支持。界面观察可随证据附上。[OpenHarmony hdc 使用指南](https://gitee.com/openharmony/docs/blob/master/zh-cn/device-dev/subsystems/subsys-toolchain-hdc-guide.md)

---

## 4. 汇总

三端都跑完后：

```bash
bash mobile/p03-b/device-test/collect-device-evidence.sh \
  ./evidence-device-summary.json \
  ./evidence-android ./evidence-ios ./evidence-harmony
```

输出 JSON 固定包含 `platforms.android`、`platforms.ios`、`platforms.harmony`，各自记录目标类型、断言和结果。选择本次要验收的证据目录；重复传入同一目录，或在多个目录放入同一平台同一目标的证据，会标为 `DUPLICATE`。

- `summary.overall` 统计三端脚本覆盖的功能，可计入模拟器。每个端都要有有效的功能 `PASS`，任一目标明确记录 `FAIL` 或 `ERROR` 都会阻断此项。
- `summary.physicalOverall` 只计明确识别为物理设备的功能 `PASS`。单端模拟器通过可与该端真机 `PARTIAL` 同时显示。
- 缺端、重复、非法或矛盾的证据均会阻断总判定。具体原因见 `inputIssues` 和每端明细。汇总命令正常退出表示已生成报告，验收结论以 JSON 字段为准。
- 旧设备脚本产出的可识别 `PASS` 保存在 `reportedStatus`；汇总按 `PARTIAL` 计入，需用新版脚本补验。历史阶段报告可独立查阅。

在仓库根目录的 Bash 中运行脚本回归（Windows 可使用 Git Bash，需有 Python 3）：

```bash
python3 -m unittest discover -s mobile/p03-b/device-test/tests -v
```

这组测试使用临时目录、合成证据和设备工具替身，可在连接设备前运行。

---

## 5. 把结果给我

把下面这些打包发我：

```bash
tar czf subwise-device-evidence.tar.gz \
  evidence-android evidence-ios evidence-harmony evidence-device-summary.json
```

或者直接把这几个 JSON 的内容贴给我也行。

---

## 附：本地自己构建产物

**Android APK**（在 Linux 上）：

```bash
cd ~/projects/subwise && source .local/p03-b1/env.sh
cd mobile/p03-b/rn/android
./gradlew -p . assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a \
  --no-daemon --console plain --max-workers=1
# → app/build/outputs/apk/release/app-release.apk
```

（注意：`gradle.properties` 会被 `expo prebuild` 重置，内存约束要写在 `$GRADLE_USER_HOME/init.gradle`。）

**HarmonyOS HAP**（在 Linux 上，编译用）：

```bash
cd ~/projects/subwise/mobile/p03-b/harmony
OHOS_CLT_HOME=~/projects/subwise/.local/ohos-clt SKIP_DOWNLOAD=1 \
EVIDENCE_DIR=/tmp/harmony-evidence \
  bash scripts/build-harmony-linux.sh
```

但**这个 HAP 是未签名的，装不上真机** —— 真机签名必须在 DevEco Studio 里做。
