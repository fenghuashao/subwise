# Subwise P03-B · 最小技术验证

日期：2026-10-29（Asia/Shanghai）。结论 **PARTIAL / 原生验收门未通过**。

离线阅读 `SUBWISE-P03-B-REPORT.html`。正文、版本表、状态矩阵、截图、关键日志和 JSON 证据均内嵌；官方来源链接才需要联网。

本轮首选 React Native + Expo（iOS/Android）与独立 ArkTS/ArkUI（原生 HarmonyOS），只是有条件工程建议，不是三端已可交付的结论。没有 APK、IPA 或 HAP 启动证据。没有进入 P03-C/P04，没有 commit/push，也没有调用 Pi、读取真实凭据或修改全局配置。

## 工程

- `mobile/p03-b/rn`：React Native/Expo 技术探针，四导航；SQLite、模拟适配器与错误保留；原生 SecureStore 写读删、无凭据 HTTPS、本地通知按钮。Web 只用于辅助验证，安全存储/通知明确 NOT_RUN。
- `mobile/p03-b/harmony`：独立原生 ArkTS Stage 工程候选（API 12），RDB、Asset Store、HTTP、通知与页面源文件。**未编译，依赖未解析，不能视作可运行 HAP**。与 RN 共用 fixture 合同，但没有宣称两套解析器完全等价。
- 原批准 UI、现有产品代码、规划与整个 P03-A 保持原哈希。

## 复现（项目根目录，Windows / Node 24.21.0）

```powershell
npm ci --prefix mobile/p03-b/rn --no-audit --no-fund
node docs/mobile/p03-b/run-checks.mjs basic
node docs/mobile/p03-b/run-checks.mjs bundle
node docs/mobile/p03-b/run-checks.mjs prebuild
# 只影响本 PowerShell 进程；路径应与实际 JDK 17 安装一致
$env:JAVA_HOME='C:\Program Files\Java\jdk-17'
node docs/mobile/p03-b/run-checks.mjs android
node docs/mobile/p03-b/serve-web.mjs
```

Web 地址 `http://127.0.0.1:4175`。只访问探针导出目录，提供 SQLite WASM 必要的 COOP/COEP。启动服务后：首次空态 → 写入模拟数据 → 重载 → 损坏响应 → 导航切换。浏览器存储属于此端口的独立 origin；没有服务工作线程，**浏览器全断网冷启动未验证**。

测试目录使用 Node `node:sqlite`（宿主实现）执行相同 SQL 和 JS 适配器，不替代 `expo-sqlite` 原生模块。测试临时数据库会清理。Web 使用真实 `expo-sqlite` WASM，未用 localStorage 或内存替身；页面重载验证不等同手机杀进程/重启。

检查脚本会覆盖同名本轮证据文件，最长原生构建尝试 240 秒；它保存每个命令实际退出码，汇总报告读取该退出码，不以脚本最终退出码判断全部通过。`npm ci` 和导出/构建可能联网下载公开依赖；HTTPS 探针仅用户点击后发送一次无 Authorization GET 到固定官方 DeepSeek 余额地址，超时 8 秒。无任何密钥输入框。

## 三端补验步骤（本轮 NOT_RUN）

1. Android：当前编译目标需要 SDK 36、Build Tools 36.0.0、NDK 27.1.12297006；准备可访问的官方 Gradle/Maven 依赖，保留锁文件并在进程中使用 JDK 17。先构建 APK，再指定模拟器/设备安装启动；现有 AVD 没有启动或修改。
2. iOS：在 Mac/Xcode 和匹配 CocoaPods 环境 `npm ci`，`npx expo prebuild --platform ios` 后由 Xcode 构建。确认 RN/Expo 源码所示 iOS 15.1 下限是否满足全部插件与实际设备。本轮 iOS prebuild、Pods、Xcode、签名均 NOT_RUN。
3. HarmonyOS：用 DevEco 打开独立 harmony 目录，安装/选择 HarmonyOS SDK 5.0.0(12) 候选，解析 Hvigor 5.0.0 工程模型及实际插件版本，生成依赖锁文件。修正 ArkTS 编译器报错后构建 HAP，再原生设备安装运行；本轮没有猜填签名。`asset.query` 在删除后空查询的返回/错误码、API签名、RDB事务和布局需先复核。
4. 各端记录 OS、设备型号、工具/依赖版本、包哈希、命令退出码与截图：首次启动、写入模拟数据、杀进程重开、飞行模式重开、重新读取和损坏响应旧快照保留。
5. 只用 `PUBLIC_SYNTHETIC_NOT_A_KEY` 测试安全存储写读删、锁屏/解锁、卸载/重装、备份排除；不输入真实密钥。iOS Keychain 卸载持留行为不能由 Android 结果推断。
6. 无凭据固定 HTTPS 观察 401；TLS 失败、弱网/超时、拒绝重定向与认证失败分类另测，禁止关闭证书验证。Harmony HTTP 探针未携凭据，但其重定向策略尚未验证，P03-C 前必须 fail-closed。
7. 拒绝/允许通知各走一次，观察实际送达；RN 是 5 秒单次本地通知，Harmony 是即时发布，不代表同一调度合同已通过。取消通知后确认无残留；锁屏、重启、时区/月底续费提醒未实现也未验收。

## 收尾与回滚

`node docs/mobile/p03-b/build-report.mjs` 重建 HTML；`node docs/mobile/p03-b/verify-report.mjs` 核对证据与原基线。`evidence/source-manifest.json` 为交付源文件哈希，生成目录及依赖不入清单。

本轮所有新增源文件只在 `mobile/p03-b` 和 `docs/mobile/p03-b`。回滚可以在确认无后续工作后移除这两个目录；不要清理原来未跟踪的项目文件。生成的 android/iOS、node_modules、数据库和构建目录被局部 `.gitignore` 排除。没有改全局 Java/Android 配置、网络设置或签名；Gradle/npm 可能留下正常下载缓存。启动过 adb server 用于只读设备枚举，未连接设备；未停止共享 adb 服务以免影响其他任务。

P03-C 仅在另行授权后开始；先关闭原生启动与安全存储门、确认真实平台地区/产品/schema/授权合同及最小凭据处理方式。MiniMax 内部模拟字段不能直接成为真实接口解析器。
