# Mac mini M4 原生验证任务（未执行）

FA 已确认当前无法连接 Mac。本文件是待执行任务，不是 iOS 运行证据。

目标：使用 P03-B 锁定的 Expo 55.0.32 / RN 0.83.10，在 Apple Silicon 原生 arm64 环境构建并运行，验证真实 iOS 系统服务。只用模拟数据，禁止真实平台凭据；不改已批准 UI，不进行发布或上传。

## 环境和传输

1. 将 `mobile/p03-b/rn` 的源文件、package.json、package-lock.json 与 `mobile/p03-b1/mac-verify.mjs`、本任务文档放到相同相对目录。不要复制 Windows 的 node_modules、android、ios、.expo 或构建目录。不要带入任何 .env、签名文件或真实密钥。
2. Mac 安装已获授权的 Xcode、匹配 macOS 与 iOS Simulator runtime、Node 24 和 CocoaPods。Xcode 的许可/首次启动由本人完成；脚本不会接受许可或修改全局 xcode-select。若有多个 Xcode，可为当前进程设置 `DEVELOPER_DIR`。
3. 在项目根执行：`node mobile/p03-b1/mac-verify.mjs`。脚本要求 macOS arm64，记录 Xcode/Node/CocoaPods 版本，按锁文件安装 JS 依赖，生成 iOS 工程，pod install，选择已有 iOS runtime，创建独立 Subwise-P03B1 模拟器，构建自带 JS 的 Release 模拟器 app 并校验其签名，再安装启动。没有关闭签名/TLS、没有云构建、没有 Apple 账户登录。
4. 多 scheme 时脚本会停止；查看 schemes.log 后指定 `SUBWISE_SCHEME`。没有 runtime 时先用 Xcode 安装，不用任意镜像。编译失败按原日志修复最小环境问题，不升级依赖以掩盖失败。

## 原生验收门（每项需截图或可复核系统输出）

| 检查 | 操作与通过条件 |
|---|---|
| 启动 | 模拟器中实际看到 Subwise 技术探针，SQLite 打开完成；没有 Metro 服务也能启动。仅 launch 命令返回 PID 不算 UI PASS。|
| SQLite | 点击写入模拟数据，显示 CNY 110.00、USD 0.00、MiniMax 62/100、未知周窗口；点击损坏响应，旧记录保留。|
| 应用重启 | 记录 simulator.json 的 UDID；`xcrun simctl terminate <UDID> dev.subwise.p03b`，然后 `xcrun simctl launch <UDID> dev.subwise.p03b`；不再次写入，应仍显示原数据。|
| 系统重启 | `xcrun simctl shutdown <UDID>`，再 boot / bootstatus / launch；记录旧数据仍存在。不能把 reload 替代重启。|
| 安全存储 | 我的 → 测试标记写/读/删，页面显示通过；测试标记只能是 PUBLIC_SYNTHETIC_NOT_A_KEY。不能仅以包中存在 SecureStore 模块判定通过。|
| HTTPS | 点击固定官方无凭据探针，观察 HTTP 401；网络失败记 FAIL 或 BLOCKED 并保留错误证据，不关闭 ATS/TLS、不信任自签证书。|
| 通知拒绝 | 首次拒绝通知权限，页面明确未获授权，仍能读取本地数据。|
| 通知允许/送达 | 在该模拟器设置中授权本测试 App 通知，回到 App 点击测试；实际观察 5 秒通知，记录时间和截图，随后取消本轮通知。只有调度 API 返回不算送达 PASS。|
| 基础交互 | 四导航能切换，数据和来源可见；这是探针验收，不替代正式 UI 的读屏/大字体验收。|

截图：`xcrun simctl io <UDID> screenshot <证据目录>/sqlite-after-relaunch.png`。每个截图应在手动确认页面稳定后采集。保留模拟器机型、iOS 版本、构建日志、Podfile.lock、app产物、签名校验及验收记录。命令示例中的 `<UDID>` 必须替换为脚本创建的实际值。

脚本生成的 acceptance.json 默认所有服务能力为 NOT_RUN，不自动升级；执行者逐项填写实际观察、时间、证据文件和 PASS/FAIL/BLOCKED/NOT_RUN。通知锁屏/设备重启交付、Keychain 卸载持留/锁屏/备份行为、物理 iPhone 都单独标记，不能用模拟器结果概括。

## 物理 iPhone 与签名边界

如果追加物理设备，使用本人合法开发团队和 provisioning，由本人在 Xcode 选择 Team、设备并处理信任/签名。禁止关闭签名或复用未知证书。模拟器 `.app` 不是可分发 IPA；物理机未执行时保持 NOT_RUN，不对 Mac mini 运行结果作真机声明。

## 停止与交付

交回 evidence/mac、Podfile.lock、构建产物路径/哈希和逐项结果；不要发送签名秘密、真实 Key 或环境变量全集。记录所有失败，完成后停止。没有 P03-C、商店上传、commit/push 授权。清理时只关闭本任务独立模拟器；不自动删除别人的模拟器或 Keychain 项。
