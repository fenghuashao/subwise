# P03-B1 HarmonyOS 独立跟踪 —— Linux 编译验证报告

日期：2026-10-30
结论先行：**HarmonyOS 原生探针已通过真实 ArkTS 编译**，`HARMONY-TRACK.md` 的 BLOCKED 状态可以关闭（仅针对"编译"这一项）。**安装、运行、签名、通知送达仍全部 NOT_RUN。**

## 一、结论

| 项 | 之前 | 本次 |
|---|---|---|
| 可执行工具链 | 未定位 | ✅ 官方 HarmonyOS CLI Tools 5.1.0.840 (linux-x64) |
| ArkTS 编译 | NOT_RUN | ✅ **PASS**（ERROR 0 / WARN 2） |
| HAP 产物 | 无 | ✅ `entry-default-unsigned.hap`（50,768 字节，未签名） |
| HAP 签名 | — | ❌ NOT_RUN（无 signingConfig，未用真实证书） |
| 设备安装 / 启动 | NOT_RUN | ❌ NOT_RUN（无设备与模拟器） |
| AssetStoreKit 运行时行为 | NOT_RUN | ❌ NOT_RUN |
| RDB 事务语义 | NOT_RUN | ❌ NOT_RUN |
| 通知送达 | NOT_RUN | ❌ NOT_RUN |

本次只推进了"能不能编译"这一件事。**不要据此声称鸿蒙端可用。**

## 二、待办的、本次未解决的事

1. **编译目标 API 被抬高**：`compileSdkVersion` 由 `5.0.0(12)` 改为 `5.1.0(18)`，因为获取到的工具链只带 API 18 SDK。注意 **`compatibleSdkVersion` 保持 `5.0.0(12)` 未动**，对设备的最低要求因此不变。若 FA 要求严格按 API 12 编译，需另行获取对应 SDK 版本并重跑。
2. **SemVer 告警未修**：entry 模块版本号 `0.0.1` 不合规。hvigor 的判定正则是 `/^[1-9]\d?(\.([1-9]?\d)){2}$/`，首段不允许为 `0`，改成 `1.0.0` 类即可消除。这是产品版本号，属 FA 决定，本次未擅改。
3. **HAP sha256 不可复现**：包内 zip 条目带构建时间戳，同源码两次构建摘要不同。记录的 sha256 只标识本次产物，不是内容寻址，别拿它做"源码未变"的证明。

## 三、工具链

来源为华为官方镜像 `repo.huaweicloud.com`，包体 sha256 在使用前已比对：

| 组件 | 版本 |
|---|---|
| Command Line Tools (linux-x64) | 5.1.0.840 |
| codelinter | 5.1.140 |
| HarmonyOS SDK | 5.1.0 Release（Ohos_sdk_public 5.1.0.125 / API 18 Release） |
| ohpm | 5.1.3 |
| hstack | 5.1.0 |
| hvigor | 5.18.5 |
| Java | OpenJDK 20 (Zulu 20.28+85-CA) |
| 内置 Node | v18.20.1 |

包 `commandline-tools-linux-x64-5.1.0.840.zip`：2,153,496,473 字节，sha256 `1dcefa47…478f1`。

SDK 内含 `@kit.AssetStoreKit.d.ts`，探针使用的全部 Kit 均在位。**这是官方 HarmonyOS SDK，不是 Android 兼容层，也不是 RN OpenHarmony 替代方案。**

## 四、编译前失败到通过的过程

### 第 1 轮：配置模型过期

```
00303024 Configuration Error
The project structure and configuration need to be upgraded before use.
```

根因定位到 `hvigor-ohos-plugin/src/utils/validate/validate-util.js` 的 `modelVersionCheck()`：**根 `oh-package.json5` 缺少 `modelVersion` 字段**。该校验要求 `hvigor/hvigor-config.json5` 与根 `oh-package.json5` 的 `modelVersion` 同时存在且一致，缺任一即报此错。

修复：两处 `modelVersion` 统一为 `5.1.0`。

### 第 2 轮：SDK 组件缺失

```
00303168 Configuration Error: SDK component missing.
```

`compileSdkVersion` 写的是 `5.0.0(12)`，本机只有 API 18。改为 `5.1.0(18)`。

### 第 3 轮：真实 ArkTS 错误（15 个）

全部集中在 `entry/src/main/ets/Probe.ets`，三类：

| 数量 | 错误 | 说明 |
|---|---|---|
| 1 | `10605087 arkts-limited-throw` | `throw error` 抛出任意类型不被允许 |
| 9 | `10605001 arkts-identifiers-as-prop-names` | 对象字面量使用 `[asset.Tag.X]` 计算属性名 |
| 4 | `10505001` AssetMap 类型不匹配 | `AssetMap` 实际是 `Map<Tag, Value>`，不是普通对象 |

第三条最有价值，也正是 `HARMONY-TRACK.md` 要求重点核对的 API 签名项。查 SDK 声明确认：

```
@ohos.security.asset.d.ts:628    type AssetMap = Map<Tag, Value>;
```

`probe` 原本按对象字面量构造的属性容器早已不成立。据此改写为 `new Map<asset.Tag, asset.Value>([...])`，返回值访问同步改为 `.get(asset.Tag.SECRET)` 并补 `instanceof Uint8Array` 收窄。

另修一处弃用：`TextDecoder.decodeWithStream`（since 12 deprecated）→ `decodeToString`。

> 值得记录的旁证：`harmony/README.md` 里写"JSON 配置静态解析成功不等于 ArkTS 编译通过"——这句话被本次验证了，配置改动一路绿灯，真正的失败全在源码里。

### 第 4 轮：通过

```
COMPILE RESULT: ERROR:0
> hvigor BUILD SUCCESSFUL in 5 s
```

产物事实：

- `entry-default-unsigned.hap`，50,768 字节，sha256 `5de5742f…93e0`
- `bundleName: dev.subwise.p03b`
- `ets/modules.abc` 34,444 字节，魔数 `PANDA` —— 真实编译出的 ArkTS 字节码，不是空壳
- 包内 8 个条目，**0 个签名条目**；构建日志明确 `No signingConfig found for product default`

## 五、复现方式

```bash
cd mobile/p03-b/harmony
bash scripts/build-harmony-linux.sh
```

脚本会自助下载并校验工具链（默认装到 `/opt/ohos-clt`），随后清理历史产物、执行 `--no-daemon` 干净构建、计算产物摘要，并输出 `harmony-build.json`。已有工具链时用 `SKIP_DOWNLOAD=1` 跳过下载。

机器可读证据：

- `docs/mobile/p03-b1/evidence/harmony-build.json` —— 脚本直接产出
- `docs/mobile/p03-b1/evidence/harmony-compile-linux-2026-10-30.json` —— 本轮汇总（工具链版本、改动前后、产物事实、残留 NOT_RUN 清单）

## 六、下一步

按 `HARMONY-TRACK.md` 关闭条件还剩三项卡住原地，都依赖外部条件而非代码：

1. **签名 HAP**：需要合法证书。`@kit.AssetStoreKit` 等能力在未经签名安装的情况下大概率不可用。
2. **安装到原生 HarmonyOS 设备或模拟器**：沙箱与 CI 均无可用设备。Android APK 兼容运行不计入此项。
3. **运行时逐项核对**：重点仍是 README 点名的三处 —— Asset 删除后查询的无记录行为、RDB begin/commit/rollback、通知授权返回值。这三处目前的证据只到"类型层面可通过编译"，没有任何一行在真实运行时执行过。

建议下一步优先解决设备问题，否则编译通过只能一直停留在纸面。
