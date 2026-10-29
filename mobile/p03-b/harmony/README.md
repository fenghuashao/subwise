# Native HarmonyOS probe — NOT_RUN

此目录是独立 ArkTS/ArkUI Stage 候选工程，不是 Android 兼容包。

候选 SDK：HarmonyOS 5.0.0(12)，Hvigor 工程模型 5.0.0；本机没有确认可用的 DevEco/hvigor/hdc，具体编译器及插件版本未解析、未锁定。没有 HAP、签名或运行证据。JSON 配置静态解析成功不等于 ArkTS 编译通过。

入口 `entry/src/main/ets/pages/Index.ets`；原生 API 探针在 `Probe.ets`，共享模拟向量位于 `resources/rawfile/fixtures.json`。无三方依赖、无真实密钥或登录界面。Asset Store 仅操作固定测试 alias；不枚举其他资产。HTTP 只发固定官方域名的无凭据 GET。

DevEco 中先做 ArkTS 编译与 API签名核对，尤其删除后 Asset 查询的无记录行为、关系库事务、通知授权返回。当前两端 SQL 模型不同：RN 保存不可变快照，Harmony 只保留当前探针行；历史、幂等语义一致性和跨端合同测试尚未通过。勿把此候选用于真实账户数据。

逐端验证步骤与停止条件见 `docs/mobile/p03-b/README.md` 和离线验收报告。原生包及工具版本补齐前不升级为支持承诺。
