# P03-B1 索引：原生构建与验收

本目录有两个独立轮次的证据，**各自独立、互不覆盖**。

## 轮次一：Windows（2026-10-29）· 结论 BLOCKED

| 文件 | 说明 |
|---|---|
| `README.md` | 该轮完整范围、进展与复现说明 |
| `SUBWISE-P03-B1-REPORT.html` | 该轮离线报告（整体 BLOCKED） |
| `build-report.mjs` | 该轮报告生成脚本 |
| `verify-report.mjs` | 该轮校验脚本（断言 APK **不存在**，服务于 BLOCKED 结论） |
| `evidence/acceptance.json` | 该轮验收状态：build=FAIL，apk=NOT_PRODUCED，其余 NOT_RUN |
| `evidence/report-validation.json` | 该轮校验结果 |
| `HARMONY-TRACK.md` | HarmonyOS 独立跟踪（跨轮次持续） |
| `MAC-TASK.md` | Mac/iOS 交接执行任务（跨轮次持续） |
| `artifacts/` | Mac 源码交接 ZIP（跨轮次持续） |

**该轮文件已冻结，一字未改。** 其 `verify-report.mjs` 第 13 行硬编码断言「APK 必须不存在」，
在第二轮 APK 产出后该断言必然失败 —— 这是**预期行为**，它服务于该轮的结论。
本目录的基线校验会逐个核对这些文件的 SHA-256，确认未被改动。

## 轮次二：Linux 云服务器（2026-10-30）· Android 原生门 PASSED

| 文件 | 说明 |
|---|---|
| **`P03-B1-LINUX-REPORT.md`** | **本轮阶段收尾报告（建议从这里开始读）** |
| `SUBWISE-P03-B1-LINUX-REPORT.html` | 本轮离线 HTML 报告（截图内嵌，无外部引用） |
| `LINUX-DEV-ENV.md` | 本机开发环境说明与可复现命令 |
| `build-report-linux.mjs` | 本轮报告生成脚本 |
| `verify-report-linux.mjs` | 本轮校验脚本（断言 APK 存在且哈希匹配） |
| `evidence/acceptance-linux-2026-10-30.json` | 本轮验收状态（结构化） |
| `evidence/linux-baseline.json` | 基线哈希（23 个历史文件，用于证明未改动） |
| `evidence/report-validation-linux.json` | 本轮校验结果 |
| `evidence/android-screenshot.png` | 模拟器运行截图 |
| `evidence/android-ui-final.xml` | 模拟器 UI 层级 dump |

## 本轮结论摘要

Android 原生构建、安装、启动与六项原生能力（SQLite 写入 / 重启保留 / 离线冷启 / 系统安全存储 /
无凭据 HTTPS / 本地通知）实测通过。

**iOS、HarmonyOS、物理真机、生产发布签名本轮均为 NOT_RUN。**
Android 一端通过不等于三端完成，也不等于自动获得 P03-C 授权。

## 复现校验

```bash
node docs/mobile/p03-b1/build-report-linux.mjs   # 重新生成本轮 HTML 报告
node docs/mobile/p03-b1/verify-report-linux.mjs   # 校验本轮证据 + 历史文件未改动
```

两个脚本都只读工程文件，不修改业务代码。
