// P03-B1-Linux 轮次独立校验。
// 刻意不复用 verify-report.mjs：那个脚本服务于上一轮 BLOCKED 结论，
// 其第 13 行硬编码断言「APK 必须不存在」，在本轮 APK 产出后必然失败。
// 本脚本改为断言本轮的真实状态，同时校验上一轮历史证据一字未改。
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const dir = fileURLToPath(new URL('.', import.meta.url)), root = resolve(dir, '../../..');
const read = p => readFileSync(resolve(dir, p), 'utf8').replace(/^\uFEFF/, '');
const json = p => JSON.parse(read(p));
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();

// ---- 本轮基线：上一轮历史证据必须一字未改 ----
const baseline = json('evidence/linux-baseline.json');
for (const file of baseline) {
  assert.ok(existsSync(resolve(root, file.path)), `missing: ${file.path}`);
  assert.equal(hash(resolve(root, file.path)), file.sha256, `changed: ${file.path}`);
}

// ---- 本轮验收状态 ----
const a = json('evidence/acceptance-linux-2026-10-30.json');
assert.equal(a.overall, 'ANDROID_GATE_PASSED');
assert.equal(a.android.gradle.status, 'PASS');
assert.equal(a.android.gradle.exitCode, 0);
assert.equal(a.android.runtimeGate.appLaunch, 'PASS');
assert.equal(a.android.runtimeGate.sqlite.status, 'PASS');
assert.equal(a.android.runtimeGate.appRestartPersistence.status, 'PASS');
assert.equal(a.android.runtimeGate.offlineColdStart.status, 'PASS');
assert.equal(a.android.runtimeGate.secureStore.status, 'PASS');
assert.equal(a.android.runtimeGate.httpsProbe.status, 'PASS');
assert.equal(a.android.runtimeGate.notifications.status, 'PASS');
assert.equal(a.android.runtimeGate.navigation.status, 'PASS');

// 未验证项必须保持 NOT_RUN / BLOCKED，不得被夸大为 PASS
assert.equal(a.android.runtimeGate.physicalDevice, 'NOT_RUN');
assert.equal(a.ios.build, 'NOT_RUN');
assert.equal(a.ios.runtime, 'NOT_RUN');
assert.equal(a.harmony.build, 'NOT_RUN');
assert.equal(a.harmony.runtime, 'NOT_RUN');
assert.ok(!/生产|publish/i.test(a.android.apk.signer) || /仅测试|非生产|debug/i.test(a.android.apk.signer));

// ---- APK 产物（本轮核心新增）----
const apkRel = 'mobile/p03-b/rn/android/app/build/outputs/apk/release/app-release.apk';
const apkPath = resolve(root, apkRel);
assert.ok(existsSync(apkPath), 'APK missing');
assert.equal(statSync(apkPath).size, a.android.apk.bytes);
assert.equal(createHash('sha256').update(readFileSync(apkPath)).digest('hex'), a.android.apk.sha256);

// ---- 报告文档 ----
const report = read('P03-B1-LINUX-REPORT.md');
assert.ok(report.includes('52e9f1ded9a9cea9db0b0437c9616fd35be8744b0717454f3e188925d94c1531'));
assert.ok(report.includes('NOT_RUN'), '报告必须保留未验证项标记');
assert.ok(report.includes('debug 证书') || report.includes('debug'), '报告必须说明签名非生产级');

// 报告不得内嵌可执行外部引用，保持离线可读
assert.ok(!/<script\b|<iframe\b|@import/i.test(report));

const result = {
  status: 'PASS',
  scope: 'P03-B1-Linux 轮次证据自检；不替代 iOS / HarmonyOS / 真机验收',
  at: new Date().toISOString(),
  baselineFilesVerified: baseline.length,
  apkHashVerified: true,
  androidGate: 'PASSED',
  iosGate: 'NOT_RUN',
  harmonyGate: 'NOT_RUN',
  physicalDevice: 'NOT_RUN'
};
writeFileSync(resolve(dir, 'evidence/report-validation-linux.json'), JSON.stringify(result, null, 2));
console.log(result);
