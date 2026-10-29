# Subwise P03-B1：原生构建与验收收口

状态：**BLOCKED**。仅解除旧 Gradle 代理及 JDK 选择问题；原生构建仍被外部依赖下载中断阻塞。没有 APK/IPA/HAP，不能判定 RN/Expo 原生门通过。

打开 `SUBWISE-P03-B1-REPORT.html` 阅读简洁离线报告。没有重复 P03-B 已通过的研究/测试；没有修改业务代码、已批准 UI 或旧报告，没有 commit/push，没有进入 P03-C/P04。

## 实际进展

- PASS：通过独立 GRADLE_USER_HOME 和进程 JDK 17 启动 Gradle 9.0.0。此前全局 Gradle 属性指向 127.0.0.1:7890，而正在运行的代理监听7897；原配置未编辑。
- PASS：从官方元数据发现命令行工具，下载并验证官方 SHA-1；下载文件 SHA-256另存记录。新工具的 sdkmanager 已是 android CLI 包装器，需要 slash 包名，本轮修正了调用方式，没有升级 App 依赖。
- FAIL：3 次有实际 Gradle执行的原生构建。分别在 Google Maven JAR、经代理的 Maven依赖、限定直连仓库路径的依赖下载遇到 TLS handshake terminated。中间另有一次 Windows batch 参数管道字符转义失败，修正后才执行第3次 Gradle尝试，不计为编译结果。
- FAIL：Android SDK 36 包下载约69%后 closed，实际退出码为1；最初 sdkmanager 包装器对不兼容的分号包名报 not found 却返回0。外层PowerShell写证据成功也可能返回0，因此以保存的子命令退出码、日志及目标包文件共同判断。目标 platform/build-tools/NDK/CMake 实际未安装。
- PASS：任务独立 Subwise_P03B1 Android 14/API34 x86_64 模拟器系统启动，并有系统指纹与截图；App未安装，因此 App启动和全部服务验证 NOT_RUN。
- iOS：按 FA 确认，当前 Mac不可访问。交付可直接转移的源码ZIP与 `MAC-TASK.md`，不是执行结果。
- HarmonyOS：PATH及标准目录未定位到工具链，编译 BLOCKED，运行 NOT_RUN，见 `HARMONY-TRACK.md`。

## 安全和范围

全程没有真实平台凭据，没有新增认证请求。网络访问用于官方依赖下载。不关闭 TLS/证书检查，不使用私有接口或任意镜像，不改全局 Java/Gradle/代理配置。任务缓存、SDK和AVD放在 `.local/p03-b1`，已有SDK许可证记录复制到任务SDK以识别已接受许可，没有自动回答新的许可确认。官方CLI自身可能产生常规下载缓存。

生成的 Android `local.properties` 指向任务SDK；它属于原有忽略的生成目录。模板自带的 release 使用测试/debug签名，本轮没有改签名逻辑，且未产出APK；将来即使构建成功也仅可用于测试，不能当生产发布签名。构建限定x86_64，对应模拟器；ARM64真机仍需另建包并验证。

## 解阻后直接复现

需要稳定的官方HTTPS通路：services.gradle.org、downloads.gradle.org、plugins.gradle.org、repo.maven.apache.org、dl.google.com。检查当前代理端口及出口可达性；本轮不擅自更改用户网络/代理选择。

任务SDK还需完整安装：platforms/android-36、build-tools/36.0.0、ndk/27.1.12297006、cmake/3.22.1。可用本轮官方工具：

```powershell
# 仅对当前终端；端口须先核实仍在监听
$env:JAVA_TOOL_OPTIONS='-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897'
$env:HTTP_PROXY='http://127.0.0.1:7897'
$env:HTTPS_PROXY='http://127.0.0.1:7897'
& .local/p03-b1/android-tools/cmdline-tools/bin/android.exe --no-metrics --sdk=.local/p03-b1/sdk sdk install platforms/android-36 build-tools/36.0.0 ndk/27.1.12297006 cmake/3.22.1
# 确认实际包文件/版本存在，不能仅检查CLI退出码
& mobile/p03-b1/build-android.ps1 -ProxyPort 7897 -Architecture x86_64
```

`build-android.ps1`只修改本进程变量并在finally恢复，不改全局配置；`-ProxyPort 0`使用已验证可用的直连。不要在不可信网络下关闭TLS来排除错误。准备日志后停止，不自动重复不限次构建。

APK预期路径是 `mobile/p03-b/rn/android/app/build/outputs/apk/release/app-release.apk`；当前不存在，不能作为已交付产物链接。后续需用SDK apksigner验证签名、计算SHA-256，指定任务模拟器serial安装；不能把安装命令成功当作启动通过。

## 原生最低验收门

Android和iOS各自：原生构建/安装/页面启动；模拟适配器写入SQLite、损坏响应留存、终止进程/重启后旧数据保留；系统安全存储测试标记写读删；固定官方无凭据HTTPS观察；通知拒绝不阻塞本地功能、允许后实际送达和取消；四导航可用。每项必须有设备/OS/构建哈希及实际观察证据。模拟器与物理真机分列，锁屏、卸载、备份和后台送达不由基本探针PASS推断。

未满足该门前，不建议进入P03-C真实平台接入。现有失败是环境证据，不能据此证明RN/Expo框架不适合，也不足以批准正式开发；维持候选路线，等待补验。

## Mac交接

解压 `artifacts/subwise-p03-b1-mac-handoff.zip`，保持目录，在Mac根目录执行 `node mobile/p03-b1/mac-verify.mjs`。脚本已在Windows通过JavaScript语法检查，但Mac构建/模拟器步骤NOT_RUN。详见ZIP内 `docs/mobile/p03-b1/MAC-TASK.md`。

## 回滚

新文件在mobile/p03-b1、docs/mobile/p03-b1、.local/.gitignore及被忽略的.local/p03-b1。确认没有后续工作后可移除本轮目录；不要清理原来未跟踪的工作区。生成Android local.properties可在后续prebuild环境中重新指定SDK。只关闭本轮emulator-5580，不动既有AVD；没有修改全局代理和JDK，无需回滚这些全局配置。
