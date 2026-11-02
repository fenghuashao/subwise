# P03-B 三端设备验证说明（2026-11-02）

给老哥：在你自己的设备上跑一轮，把产出的证据交回来，我做统一复核与归档。

---

## 0. 你需要准备什么

| 端 | 设备 | 必需工具 | 产物 |
|---|---|---|---|
| Android | 安卓手机（或虚拟机） | Android SDK Platform-Tools（adb） | APK |
| iOS | Mac mini M4 | Xcode + iOS 模拟器 runtime | .app |
| HarmonyOS | 荣耀鸿蒙手机 | DevEco Studio 的 hdc | 签名 HAP |

**APK / .app / HAP 从哪来**：
- Android：CI 的 `subwise-p03b-android-apk` artifact（37,854,296 字节，release 版，含 arm64-v8a + armeabi-v7a，真机能装）。
  本地自己构建也行，见文末。
- iOS：CI 的 `subwise-p03b-ios-simulator-app` artifact 里是 `.app`（模拟器专用，不能装真机）。
  要装真机需要你自己在 Mac 上用开发者证书重新签。
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

脚本会：装 APK → 启动 → 关掉可能的系统弹窗 → 点「写入模拟数据」→ 点「重新读取本地 SQLite」→ 点「模拟响应损坏」→ 切「我的」页 → 点安全存储 → 点 HTTPS 探针 → 点通知 → 收 logcat → 出断言。

产出 `evidence-android/android-device-evidence.json`（外加截图、UI 层级、logcat）。

**你还要人工确认 2 件事**（脚本查不到）：
1. 通知栏里有没有真的收到「Subwise P03-B」通知。
2. 屏幕上「安全存储写 / 读 / 删通过」这句话有没有出现。

---

## 2. iOS（Mac mini M4）

```bash
cd <subwise 仓库>
# 模拟器
bash mobile/p03-b/device-test/verify-ios-device.sh \
  --app .local/p03-b1/ios-derived/Build/Products/Release-iphonesimulator/SubwiseP03B.app \
  --out ./evidence-ios
```

`.app` 怎么来（Mac 上）：

```bash
cd mobile/p03-b/rn
npx expo prebuild --platform ios
cd ios
pod install
xcodebuild -workspace SubwiseP03B.xcworkspace \
  -scheme SubwiseP03B \
  -configuration Release \
  -sdk iphonesimulator \
  -derivedDataPath ../../.local/p03-b1/ios-derived \
  CODE_SIGNING_ALLOWED=NO
```

要装**真机**的话，把 `--sdk iphonesimulator` 换成真机配置，并在 Xcode 里配好你的开发者证书（Bundle ID 要改成你自己的，避免撞 `dev.subwise.p03b`）。

脚本会：boot 模拟器 → 装 .app → 启动 → 截图 → **直接读 app 沙盒里的 SQLite**，确认 deepseek 和 minimax 两个 provider 的快照都真的写进了数据库。

产出 `evidence-ios/ios-device-evidence.json`。

**你还要人工确认**：点开 App，看「总览」页是不是出现了 DeepSeek 余额卡片和 MiniMax 窗口卡片。

> 注：脚本目前只验「启动 + 落盘」这一层硬证据。iOS 上**没有** uiautomator 那样的通用 UI dump，
> 脚本没法替你断言按钮点击后的文案，所以交互那部分需要你肉眼确认。

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

脚本会：装 HAP → 启动 → 截图 → **读 app 沙盒里的 RDB**，确认 probe_rows 表里 deepseek 和 minimax 的行都写进去了 → 收 hilog。

产出 `evidence-harmony/harmony-device-evidence.json`。

**你还要人工确认 3 件事**：
1. 通知栏有没有收到「Subwise P03-B」通知。
2. 「我的」页点安全存储按钮后有没有显示「测试标记写读删完成」。
3. 「我的」页点 HTTPS 按钮后有没有显示「无凭据 HTTPS 状态 401」。

> 读沙盒数据库这一步可能因为权限拿不到（脚本会提示需要 root/调试权限）。
> 如果读不到，**别硬凑** —— 脚本会把 `rdbFound` 标成 false，状态是 FAIL。
> 这时候退化成人工确认：点「写入模拟数据并重新读取」，看卡片出不出来；再点「离线重新读取」，看卡片还在不在。

---

## 4. 汇总

三端都跑完后：

```bash
bash mobile/p03-b/device-test/collect-device-evidence.sh \
  ./evidence-device-summary.json \
  ./evidence-android ./evidence-ios ./evidence-harmony
```

它会输出每端的状态和断言通过数，并给出总判定。
**只有三端全是 PASS 才是 PASS**，NOT_RUN / ERROR / FAIL / 缺证据一律是 INCOMPLETE。

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
