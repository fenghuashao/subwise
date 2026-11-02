#!/usr/bin/env node
// P03-B1 复核轮（2026-11-02）自检脚本
//
// 作用：断言「本轮」的新状态，防止后续轮次把结论写宽。
// 独立于旧轮次的 verify-report.mjs / verify-report-linux.mjs ——
// 那些脚本服务于各自轮次的历史结论，状态变化后失败属预期，不要去修它们。
//
// 用法：node docs/mobile/p03-b1/verify-recheck-2026-11-02.mjs
//
// 断言分三类：
//   PASSED  —— 本轮实测成立的事实
//   NOT_RUN —— 必须仍是 NOT_RUN 的项（防止被写宽成 PASS）
//   GUARD   —— 结构纪律（离线可读、文件存在、旧轮次文件未被改动）

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const p = (rel) => join(REPO, rel);

let failed = 0;
let passed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------- 证据存在
section("证据文件");
const EVID_JSON = p("docs/mobile/p03-b1/evidence/recheck-2026-11-02.json");
const REPORT_MD = p("docs/mobile/p03-b1/P03-B1-RECHECK-2026-11-02.md");
const REPORT_HTML = p("docs/mobile/p03-b1/SUBWISE-P03-B1-RECHECK-2026-11-02.html");
const PLAN = p("docs/mobile/PLAN.md");

check("机器可读证据存在", existsSync(EVID_JSON));
check("Markdown 报告存在", existsSync(REPORT_MD));
check("离线 HTML 报告存在", existsSync(REPORT_HTML));
check("PLAN.md 存在", existsSync(PLAN));

if (!existsSync(EVID_JSON)) {
  console.error("\n缺少证据文件，后续断言无法执行。");
  process.exit(1);
}
const ev = JSON.parse(readFileSync(EVID_JSON, "utf8"));

// ------------------------------------------------------------ 本轮实测事实
section("本轮实测成立的事实（PASSED）");
check("HEAD 已拉到 6a8b94f", ev.repository.head.startsWith("6a8b94f"), ev.repository.head);
check("本地与 origin/main 一致", ev.repository.inSync === true);
check("拉取了 2 个提交", ev.repository.pulledCommits.length === 2);

const h = ev.harmonyCompilation;
check("本机鸿蒙编译 status=COMPILE_OK", h.localRun.status === "COMPILE_OK", h.localRun.status);
check("本机鸿蒙编译 ERROR=0", h.localRun.errors === 0);
check("本机鸿蒙编译 WARN=2", h.localRun.warnings === 2);
check("CI 鸿蒙编译 status=COMPILE_OK", h.ciRun.status === "COMPILE_OK", h.ciRun.status);
check("CI 鸿蒙编译 ERROR=0", h.ciRun.errors === 0);
check("本机与 CI HAP 字节数相同", h.crossCheck.byteCountEqual === true);
check("HAP 条目名一致", h.crossCheck.entryNamesEqual === true);
check("HAP 逐条目内容摘要一致", h.crossCheck.perEntryContentDigestEqual === true);
check("HAP 签名条目数为 0", h.crossCheck.signatureEntryCount === 0);
check("ets/modules.abc 是真实字节码(PANDA)", h.crossCheck.etsByteCode.magic === "PANDA");
check("本机 HAP 未签名", h.localRun.signed === false);
check("CI HAP 未签名", h.ciRun.signed === false);
check("工具链包 sha256 已校验", h.toolchain.sha256Verified === true);
check("整包 sha256 不同属预期(时间戳)", h.crossCheck.wholePackageSha256Equal === false);

const ios = ev.iosSimulatorRun;
check("iOS 实跑 status=RUN", ios.run.status === "RUN", ios.run.status);
check("iOS 实跑有 launchPid", Number.isInteger(ios.run.launchPid) && ios.run.launchPid > 0);
check("iOS 实跑截图已产出", ios.run.screenshot === true);
check("iOS 截图已人工查看", ios.screenshotReviewed === true);
check("iOS 静态核验 bundleId 正确", ios.static.bundleIdentifier === "dev.subwise.p03b");
check("iOS 静态核验 codesign 校验无错误", ios.static.codesignVerifyError === null);
check("iOS 静态核验含 arm64+simulator 架构", ios.static.architectures.includes("arm64") && ios.static.architectures.includes("x86_64"));

const apk = ev.androidApk;
check("三次 CI 的 APK 字节数一致", apk.byteCountStableAcrossRuns === true);
check("三次 CI 的 APK sha256 各不相同", apk.sha256VariesAcrossRuns === true);
check("本机 x86_64 APK 与 CI 产物不同", apk.localX86OnlyApkBytes !== apk.ciRuns["41400104979"].bytes);

check("本地回归：web check 通过", ev.localRegression.webCheck === "pass");
check("本地回归：探针 tsc exit 0", ev.localRegression.probeTsc === "exit 0");
check("本地回归：单测 8 passed", ev.localRegression.probeUnitTests.includes("8 passed"));

// ------------------------------------------------------------ 必须仍是 NOT_RUN
section("必须仍是 NOT_RUN 的项（防止结论写宽）");
const harmonyNotRun = h.still_NOT_RUN;
const iosNotRun = ios.still_NOT_RUN;
check("鸿蒙签名仍 NOT_RUN", harmonyNotRun.some((x) => x.includes("签名")));
check("鸿蒙设备安装仍 NOT_RUN", harmonyNotRun.some((x) => x.includes("安装")));
check("鸿蒙 AssetStoreKit 运行时仍 NOT_RUN", harmonyNotRun.some((x) => x.includes("AssetStoreKit")));
check("鸿蒙 RDB 事务仍 NOT_RUN", harmonyNotRun.some((x) => x.includes("RDB")));
check("鸿蒙通知送达仍 NOT_RUN", harmonyNotRun.some((x) => x.includes("通知")));
check("鸿蒙无凭据 HTTPS 仍 NOT_RUN", harmonyNotRun.some((x) => x.includes("HTTPS")));
check("鸿蒙 UI/安全区等仍 NOT_RUN", harmonyNotRun.some((x) => x.includes("UI")));
check("iOS 真机仍 NOT_RUN", iosNotRun.some((x) => x.includes("真机")));
check("iOS UI 自动化仍 NOT_RUN", iosNotRun.some((x) => x.includes("UI 自动化")));
check("iOS 功能断言仍 NOT_RUN", iosNotRun.some((x) => x.includes("功能断言")));
check("iOS 生产签名仍 NOT_RUN", iosNotRun.some((x) => x.includes("生产签名")));
check("共 7 项鸿蒙 NOT_RUN", harmonyNotRun.length === 7, String(harmonyNotRun.length));
check("共 4 项 iOS NOT_RUN", iosNotRun.length === 4, String(iosNotRun.length));

// ------------------------------------------------------------ 文档纠错已落地
section("文档纠错已落地");
const plan = readFileSync(PLAN, "utf8");
check("PLAN.md 不再出现 19.62 MB", !plan.includes("19.62"));
check("PLAN.md 含正确的 APK 字节数", plan.includes("37,854,296"));
check("PLAN.md iOS 行已标进程启动已验证", plan.includes("进程启动已验证"));
check("PLAN.md iOS 行仍标功能断言 NOT_RUN", plan.includes("功能断言 NOT_RUN"));
check("PLAN.md 说明 CI 绿色不等于实测通过", plan.includes("CI 步骤绿色 ≠ 该项实测通过"));
check("PLAN.md 说明必须读 JSON status", plan.includes("COMPILE_OK") && plan.includes("NOT_RUN"));

// ------------------------------------------------------------ 报告结构纪律
section("报告结构纪律");
const html = readFileSync(REPORT_HTML, "utf8");
check("HTML 无 <script>", !html.toLowerCase().includes("<script"));
check("HTML 无 <iframe", !html.toLowerCase().includes("<iframe"));
check("HTML 无 @import", !html.toLowerCase().includes("@import"));
check("HTML 无 url(", !html.toLowerCase().includes("url("));
const srcs = [...html.matchAll(/src\s*=\s*["']([^"']{0,60})/gi)].map((m) => m[1]);
check("HTML 全部图片为 data URI", srcs.length > 0 && srcs.every((s) => s.startsWith("data:image/")));
const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
const localHrefs = hrefs.filter((h) => !h.startsWith("http"));
check(
  "HTML 本地 href 全部指向真实文件",
  localHrefs.every((h) => existsSync(resolve(HERE, h))),
  localHrefs.filter((h) => !existsSync(resolve(HERE, h))).join(", ")
);

const md = readFileSync(REPORT_MD, "utf8");
check("MD 报告写明本轮未获得的项", md.includes("未获得") || md.includes("NOT_RUN"));
check("MD 报告写明 F3 未修", md.includes("F3") && md.includes("未修"));
check("MD 报告写明未提交未推送", md.includes("没有提交、没有推送"));

// ------------------------------------------------------------ 旧轮次文件未被动
section("旧轮次文件未被本轮改动");
const UNTOUCHED = [
  "docs/mobile/p03-b1/SUBWISE-P03-B1-REPORT.html",
  "docs/mobile/p03-b1/SUBWISE-P03-B1-LINUX-REPORT.html",
  "docs/mobile/p03-b1/P03-B1-LINUX-REPORT.md",
  "docs/mobile/p03-b1/P03-B1-HARMONY-LINUX-REPORT.md",
  "docs/mobile/p03-b1/HARMONY-TRACK.md",
  "docs/mobile/p03-b1/verify-report.mjs",
  "docs/mobile/p03-b1/verify-report-linux.mjs",
  "docs/mobile/p03-b1/build-report.mjs",
  "docs/mobile/p03-b1/build-report-linux.mjs",
  "docs/mobile/p03-b1/evidence/harmony-build.json",
  "docs/mobile/p03-b1/evidence/harmony-compile-linux-2026-10-30.json",
];
// 这些文件的 sha256 记录在基线里；本轮只允许新增，不允许修改。
const BASELINE = p("docs/mobile/p03-b1/evidence/recheck-2026-11-02.json");
const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const guarded = baseline.preservedFiles || {};
for (const rel of UNTOUCHED) {
  const f = p(rel);
  if (!existsSync(f)) {
    check(`${rel} 存在`, false, "文件不存在");
    continue;
  }
  const digest = createHash("sha256").update(readFileSync(f)).digest("hex");
  const want = guarded[rel];
  if (!want) {
    check(`${rel} 存在（无基线哈希，仅确认存在）`, true);
    continue;
  }
  check(`${rel} 未被改动`, digest === want, `期望 ${want} 实际 ${digest}`);
}

// ------------------------------------------------- F3 修复：证据缺失不留空白
section("F3 修复：脚本崩溃也会留下 status=ERROR 的证据");
const IOS_SCRIPT = p("mobile/p03-b/rn/scripts/verify-ios-simulator.sh");
const HARMONY_SCRIPT = p("mobile/p03-b/harmony/scripts/build-harmony-linux.sh");
const CHECKER = p("mobile/p03-b/scripts/check-evidence-status.py");
const IOS_WF = p(".github/workflows/build-mobile.yml");
const HARMONY_WF = p(".github/workflows/build-harmony.yml");

check("iOS 脚本存在", existsSync(IOS_SCRIPT));
check("鸿蒙脚本存在", existsSync(HARMONY_SCRIPT));
check("status 判定脚本存在", existsSync(CHECKER));

const iosSh = readFileSync(IOS_SCRIPT, "utf8");
const harSh = readFileSync(HARMONY_SCRIPT, "utf8");
check("iOS 脚本装有 EXIT trap", /trap on_exit EXIT/.test(iosSh));
check("iOS 脚本有 FINAL_RECORDED 标记", iosSh.includes("FINAL_RECORDED"));
check("iOS 脚本能写 status=ERROR", iosSh.includes('"status": "ERROR"'));
check("iOS 脚本的 ERROR 区分于 NOT_RUN", iosSh.includes("不等于环境不具备"));
check("鸿蒙脚本装有 EXIT trap", /trap on_exit EXIT/.test(harSh));
check("鸿蒙脚本有 EVIDENCE_WRITTEN 标记", harSh.includes("EVIDENCE_WRITTEN"));
check("鸿蒙脚本能写 status=ERROR", harSh.includes('"status": env("STATUS")'));
check("鸿蒙脚本的 ERROR 区分于 NOT_RUN", harSh.includes("不等于环境不具备"));

// EXIT trap 必须装在任何 write_evidence/record 调用之前
check("iOS 脚本的 trap 早于第一次 record 调用", iosSh.indexOf("trap on_exit EXIT") < iosSh.indexOf('record "NOT_RUN"'));
check("鸿蒙脚本的 trap 早于第一次 write_evidence 调用", harSh.indexOf("trap on_exit EXIT") < harSh.indexOf('write_evidence "NOT_RUN"'));

// 每个脚本只能有一个 EXIT trap（多个会互相覆盖）
check("iOS 脚本只有一个 EXIT trap", (iosSh.match(/trap .*EXIT/g) || []).length === 1);
check("鸿蒙脚本只有一个 EXIT trap", (harSh.match(/trap .*EXIT/g) || []).length === 1);

section("F3 修复：CI 显式判定证据状态");
const iosWf = readFileSync(IOS_WF, "utf8");
const harWf = readFileSync(HARMONY_WF, "utf8");
check("iOS workflow 调用判定脚本", iosWf.includes("check-evidence-status.py"));
check("iOS workflow 期望 status=RUN", iosWf.includes('"RUN" "iOS 模拟器实跑"') || iosWf.includes("RUN \"iOS 模拟器实跑\""));
check("鸿蒙 workflow 调用判定脚本", harWf.includes("check-evidence-status.py"));
check("鸿蒙 workflow 期望 status=COMPILE_OK", harWf.includes("COMPILE_OK \"HarmonyOS ArkTS 编译\""));
// 判定步骤必须排在所有上传之后，避免判红时把产物丢掉
const iosSteps = [...iosWf.matchAll(/^      - (?:name|uses):/gm)].map((m) => m.index);
check("iOS workflow 的判定步骤存在", iosWf.includes("判定 iOS 实跑结果"));
check("鸿蒙 workflow 的判定步骤存在", harWf.includes("判定编译结果"));

// 判定脚本本身的行为：缺文件 / 坏 JSON / 无 status 都必须 exit 1
const { execFileSync } = await import("node:child_process");
const tmp = join(REPO, ".local", "tmp-verify-recheck");
mkdirSync(tmp, { recursive: true });
function runChecker(jsonBody, want) {
  const f = join(tmp, "case.json");
  if (jsonBody !== null) writeFileSync(f, jsonBody, "utf8");
  else rmSync(f, { force: true });
  try {
    execFileSync("python3", [CHECKER, f, want, "测试"], { stdio: "pipe" });
    return 0;
  } catch (e) {
    return e.status ?? -1;
  }
}
check("判定脚本：status 匹配 → exit 0", runChecker('{"status":"RUN"}', "RUN") === 0);
check("判定脚本：status 不匹配 → exit 1", runChecker('{"status":"NOT_RUN"}', "RUN") === 1);
check("判定脚本：status=ERROR → exit 1", runChecker('{"status":"ERROR"}', "RUN") === 1);
check("判定脚本：文件缺失 → exit 1", runChecker(null, "RUN") === 1);
check("判定脚本：非法 JSON → exit 1", runChecker("not json", "RUN") === 1);
check("判定脚本：无 status 字段 → exit 1", runChecker('{"x":1}', "RUN") === 1);
rmSync(tmp, { recursive: true, force: true });

// 失败可见性：判定步骤必须不会被前一步失败跳过，
// 否则「上传失败」会把真正的失败原因盖住，或者 ERROR 证据直接丢失。
section("F3 修复：失败必须可见，且不丢证据");
function wfSteps(file, job) {
  const yml = readFileSync(p(`.github/workflows/${file}`), "utf8");
  const lines = yml.split("\n");
  const steps = [];
  let inJob = false;
  for (const line of lines) {
    if (/^\s{2}\w[\w-]*:\s*$/.test(line)) inJob = line.trim() === `${job}:`;
    if (!inJob) continue;
    const m = line.match(/^      - (?:name|uses):\s*(.+)$/);
    if (m) {
      steps.push({ name: m[1].trim(), if: null, continueOnError: null, noFilesFound: null });
      continue;
    }
    if (!steps.length) continue;
    const s = steps[steps.length - 1];
    if (/^\s{8}if:\s*(.+)$/.test(line)) s.if = line.trim().slice(4).trim();
    if (/^\s{8}continue-on-error:\s*(.+)$/.test(line)) s.continueOnError = line.trim().slice(18).trim();
    if (/^\s{12}if-no-files-found:\s*(.+)$/.test(line)) s.noFilesFound = line.trim().slice(18).trim();
  }
  return steps;
}

const iosWfSteps = wfSteps("build-mobile.yml", "ios");
const harWfSteps = wfSteps("build-harmony.yml", "harmony");
const iosJudge = iosWfSteps.find((s) => s.name === "判定 iOS 实跑结果");
const harJudge = harWfSteps.find((s) => s.name === "判定编译结果");

check("iOS workflow 有判定步骤", !!iosJudge);
check("鸿蒙 workflow 有判定步骤", !!harJudge);
check("iOS 判定步骤带 if: always()", iosJudge?.if === "always()", iosJudge?.if);
check("鸿蒙判定步骤带 if: always()", harJudge?.if === "always()", harJudge?.if);

// 判定必须排在所有上传之后（判红时不丢产物）
const iosUpIdx = iosWfSteps.findIndex((s) => s.name.includes("upload-artifact") || s.name === "上传 iOS 实跑证据");
const iosJudgeIdx = iosWfSteps.findIndex((s) => s.name === "判定 iOS 实跑结果");
const harUpIdx = harWfSteps.findIndex((s) => s.name === "上传 HAP 与证据");
const harJudgeIdx = harWfSteps.findIndex((s) => s.name === "判定编译结果");
check("iOS 判定排在上传之后", iosUpIdx >= 0 && iosJudgeIdx > iosUpIdx, `上传=${iosUpIdx} 判定=${iosJudgeIdx}`);
check("鸿蒙判定排在上传之后", harUpIdx >= 0 && harJudgeIdx > harUpIdx, `上传=${harUpIdx} 判定=${harJudgeIdx}`);

// 每个上传步骤都要带 if: always()，否则上传失败会跳过后续判定
check("iOS 所有上传步骤带 if: always()", iosWfSteps.filter((s) => s.name.includes("upload-artifact") || s.name === "上传 iOS 实跑证据").every((s) => s.if === "always()"));
check("鸿蒙上传步骤带 if: always()", harWfSteps.find((s) => s.name === "上传 HAP 与证据")?.if === "always()");

// 编译/实跑步骤本身必须不阻断后续
check("iOS 实跑步骤带 continue-on-error", iosWfSteps.find((s) => s.name === "iOS 模拟器实跑校验")?.continueOnError === "true");
check("鸿蒙编译步骤带 if: always()", harWfSteps.find((s) => s.name === "编译并产出证据")?.if === "always()");

// 不能再有 if-no-files-found: error —— 它会让上传失败直接终止 job
check("iOS 无 if-no-files-found: error", !iosWfSteps.some((s) => s.noFilesFound === "error"));
check("鸿蒙无 if-no-files-found: error", !harWfSteps.some((s) => s.noFilesFound === "error"));

// ------------------------------------------------- 设备端测试脚本包（自测交付物）
section("设备端测试脚本包：三端可在自己设备上跑");
const DT = "mobile/p03-b/device-test/";
const dtFiles = [
  "verify-android-device.sh",
  "verify-ios-device.sh",
  "verify-harmony-device.sh",
  "collect-device-evidence.sh",
];
for (const f of dtFiles) check(`设备端脚本存在：${f}`, existsSync(p(DT + f)));
check("设备端说明文档存在", existsSync(p("docs/mobile/p03-b1/DEVICE-TEST-GUIDE.md")));

const dtScripts = {};
for (const f of dtFiles) dtScripts[f] = readFileSync(p(DT + f), "utf8");

// 每个脚本都必须有 EXIT 兜底 + ERROR/NOT_RUN 区分（沿用本轮修的教训）
for (const f of dtFiles.slice(0, 3)) {
  const s2 = dtScripts[f];
  check(`${f}: 有 EXIT 兜底`, /trap on_exit EXIT/.test(s2));
  check(`${f}: 有 FINAL_RECORDED 标记`, s2.includes("FINAL_RECORDED"));
  check(`${f}: 产出证据 JSON`, /-evidence\.json/.test(s2));
  check(`${f}: 区分 ERROR 与 NOT_RUN`, s2.includes("不等于环境不具备"));
  check(`${f}: note 里说明 PARTIAL`, s2.includes("PARTIAL"));
}

// Android：必须真的做交互与落盘断言
const andSrc = dtScripts["verify-android-device.sh"];
check("Android: 点写入模拟数据", andSrc.includes("写入模拟数据"));
check("Android: 点重新读取本地 SQLite", andSrc.includes("重新读取本地 SQLite"));
check("Android: 点模拟响应损坏", andSrc.includes("模拟响应损坏"));
check("Android: 点安全存储", andSrc.includes("安全存储"));
check("Android: 点 HTTPS 探针", andSrc.includes("HTTPS 无凭据探针"));
check("Android: 点通知", andSrc.includes("请求通知权限"));
check("Android: 断言落盘（重新读取后卡片仍在）", andSrc.includes("dataPersistedAfterReread"));
check("Android: 断言损坏后不丢数据", andSrc.includes("snapshotSurvivesCorrupt"));
check("Android: 断言无崩溃", andSrc.includes("noFatalException"));
check("Android: adb 路径可由 ADB 环境变量指定", andSrc.includes('ADB_BIN="$ADB"'));
check("Android: logcat 带超时（本机 adb logcat -d 会阻塞）", /timeout \d+ "\$ADB_BIN" logcat/.test(andSrc));

// iOS：必须读沙盒 SQLite，并如实标注交互来源
const iosSrc = dtScripts["verify-ios-device.sh"];
check("iOS: 读 app 沙盒 SQLite", iosSrc.includes("get_app_container"));
check("iOS: 查 snapshots 表", iosSrc.includes("FROM snapshots"));
check("iOS: 断言两个 provider 都落盘", iosSrc.includes("bothProvidersStored"));
check("iOS: 如实标注交互方式", iosSrc.includes("interaction"));
check("iOS: 交互未自动化时判 PARTIAL 而非 FAIL", iosSrc.includes('STATUS="PARTIAL"'));
check("iOS: 支持 idb 自动化", iosSrc.includes("idb"));

// HarmonyOS：必须读 RDB
const harSrc = dtScripts["verify-harmony-device.sh"];
check("Harmony: 查 probe_rows 表", harSrc.includes("probe_rows"));
check("Harmony: 断言两个 provider 都落盘", harSrc.includes("bothProvidersStored"));
check("Harmony: hdc 路径可由 HDC 环境变量指定", harSrc.includes("HDC"));
check("Harmony: 提示人工确认项", harSrc.includes("人工确认"));

// 收集器：只有 PASS 算通过
const colSrc = dtScripts["collect-device-evidence.sh"];
check("收集器: 只有 PASS 算通过", colSrc.includes('PASSING = {"PASS"}'));
check("收集器: PARTIAL 不算通过", colSrc.includes("PARTIAL"));
check("收集器: NOT_RUN 不算通过", colSrc.includes("NOT_RUN"));
check("收集器: ERROR 不算通过", colSrc.includes("ERROR"));
check("收集器: MISSING 不算通过", colSrc.includes("MISSING"));
check("收集器: 非全 PASS 时 overall=INCOMPLETE", colSrc.includes('"INCOMPLETE"'));

// 说明文档必须写清三端的产物来源与人工确认项
const guide = readFileSync(p("docs/mobile/p03-b1/DEVICE-TEST-GUIDE.md"), "utf8");
check("说明文档: 覆盖 Android", guide.includes("Android"));
check("说明文档: 覆盖 iOS", guide.includes("iOS"));
check("说明文档: 覆盖 HarmonyOS", guide.includes("HarmonyOS"));
check("说明文档: 写明鸿蒙 HAP 必须自己签名", guide.includes("签名"));
check("说明文档: 写明人工确认项", guide.includes("人工确认"));
check("说明文档: 写明交回证据的方式", guide.includes("evidence"));

// ------------------------------------------------------------------- 汇总
console.log(`\n${"-".repeat(52)}`);
console.log(`PASS ${passed}  FAIL ${failed}`);
if (failed > 0) {
  console.log("存在未通过的断言 —— 本轮结论尚不成立。");
  process.exit(1);
}
console.log("本轮全部断言通过。");
