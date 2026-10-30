// P03-B1-Linux 轮次报告生成脚本（离线 HTML）。
// 沿用仓库既有风格：证据 JSON → 自包含 HTML，无外部脚本/样式引用。
// 与旧轮次 build-report.mjs 的关系：独立脚本、独立产物，不覆盖旧报告。
import {readFileSync, writeFileSync, existsSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const dir = fileURLToPath(new URL('.', import.meta.url)), root = resolve(dir, '../../..');
const read = p => readFileSync(resolve(dir, p), 'utf8').replace(/^\uFEFF/, '');
const json = p => JSON.parse(read(p));
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// 基线完整性：上一轮历史证据必须一字未改
const baseline = json('evidence/linux-baseline.json');
const preserved = baseline.map(x => ({...x, currentSha256: hash(resolve(root, x.path)), unchanged: hash(resolve(root, x.path)) === x.sha256}));
if (!preserved.every(x => x.unchanged)) throw Error('Existing baseline changed');

// 本轮状态
const acceptance = json('evidence/acceptance-linux-2026-10-30.json');
const apkRel = 'mobile/p03-b/rn/android/app/build/outputs/apk/release/app-release.apk';
const apkPath = resolve(root, apkRel);
if (!existsSync(apkPath)) throw Error('APK missing; report would state a false claim');
const apkSha = hash(apkPath);
if (apkSha !== acceptance.android.apk.sha256.toUpperCase()) throw Error('APK hash mismatch with evidence');

// 本轮截图
const shot = readFileSync(resolve(dir, 'evidence/android-screenshot.png')).toString('base64');

const table = (heads, rows) => `<div class="scroll"><table><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

const rt = acceptance.android.runtimeGate;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Subwise P03-B1-Linux 阶段收尾</title><style>body{margin:0;background:#f6f8fc;color:#182640;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1040px;margin:auto;padding:36px 24px 72px}header{border-top:5px solid #315dcc;padding:18px 0}h1{font-size:32px}h2{font-size:23px;margin-top:32px}.status{background:#eaf6ec;border-left:5px solid #1f7a44;padding:20px;border-radius:8px}.warn{background:#fff1d9;border-left:5px solid #986017;padding:20px;border-radius:8px}a{color:#315dcc}table{border-collapse:collapse;width:100%;background:white;font-size:14px}th,td{border:1px solid #dce3ef;padding:12px;text-align:left;vertical-align:top}th{background:#e8eefc}.scroll{overflow:auto}.muted,figcaption{color:#58657b;font-size:14px}pre{white-space:pre-wrap;word-break:break-word;font-size:12px;max-height:420px;overflow:auto;background:white;border:1px solid #dce3ef;border-radius:8px;padding:12px}img{max-width:100%;width:290px;border-radius:10px}li{margin:8px 0}code{font-family:Consolas,monospace}figure{margin:20px 0}.mono{font-family:Consolas,monospace;font-size:13px}@media print{pre{max-height:none}}</style></head><body><main>
<header><p class="muted">SUBWISE · FX · 2026-10-30 · Asia/Shanghai · Ubuntu 24.04 / 4 核 3.6GB / 无 KVM</p><h1>P03-B1-Linux 原生解阻与阶段收尾</h1></header>

<div class="status"><strong>Android 原生门已通过：APK 构建、安装、启动与六项原生能力实测通过。</strong><p>上一轮（Windows）标记为 BLOCKED 的根因是 Gradle 发行版与依赖仓库在本网络不可达，加上默认并行度打满本机内存导致构建假死。本轮改用镜像通路并把并发约束移入 init.gradle，构建稳定通过。</p></div>

<div class="warn"><strong>iOS / HarmonyOS / 物理真机 / 生产签名本轮均未执行，一律 NOT_RUN。</strong><p>Android 一端通过不等于三端完成，也不等于自动获得 P03-C 授权。</p></div>

<h2>结果总览</h2>${table(['范围','状态','依据'],[
['Android 原生构建','PASS','BUILD SUCCESSFUL in 5m 30s，APK 已产出'],
['Android 安装与启动','PASS','pm install Success；mResumedActivity: dev.subwise.p03b/.MainActivity'],
['Android 原生能力门','PASS','SQLite 写入 / 重启保留 / 离线冷启 / 安全存储 / HTTPS / 通知 六项通过'],
['Web 工作台','PASS','六视图切换、新增订阅弹窗、API 两条路径通过'],
['P03-B 探针','PASS','单测 8 passed；tsc exit 0；真实 SQLite WASM 全链路'],
['iOS','NOT_RUN','本机为 Linux，无 Mac/Xcode/CocoaPods'],
['HarmonyOS','NOT_RUN','未定位到 DevEco/Hvigor 工具链'],
['物理真机','NOT_RUN','模拟器结论不可替代真机'],
['生产发布签名','NOT_RUN','本轮为 Expo 模板 debug 证书，仅测试用']])}

<p class="muted">PASS ＝该项在注明范围内实测满足；NOT_RUN ＝ 没有执行。失败构建不等于已发现产品代码缺陷。</p>

<h2>上一轮 BLOCKED 的真实根因</h2>
<ol>
<li><strong>Gradle 发行版下载超时</strong>：官方 <code>services.gradle.org</code> 返回 307 跳转，wrapper 默认 <code>networkTimeout=10000</code>，下载中直接抛 <code>SocketTimeoutException</code>。构建<strong>从未进入编译阶段</strong>，上一轮看到的「TLS 握手中断」是表象。</li>
<li><strong>依赖仓库不可达</strong>：<code>repo.maven.apache.org</code> / <code>dl.google.com</code> 同样存在长连接读超时。</li>
<li><strong>内存与并发不匹配</strong>：4 核 3.6GB 上默认 <code>parallel=true</code> + <code>-Xmx2048m</code>，Gradle 守护进程与多个 clang 同时打满内存，swap 耗尽后 IO wait 达 93%，<strong>构建卡在换页里零进展</strong>（60 秒内 .o 数量不变，进程仍在，表现为「像在跑其实没动」）。</li>
</ol>

<h2>措施与验证</h2>${table(['项','措施','验证'],[
['Gradle 发行版','腾讯云镜像下载','官方 .sha256 校验一致：8fad3d78…ba46072b'],
['依赖仓库','init.gradle 用 beforeSettings 改走 maven.aliyun.com','137 个依赖模块全部到位'],
['HTTP 超时','连接 60s / 读 120s','—'],
['命令行工具','官方元数据 SHA-1 核对','5fdcc763663eefb86a5b8879697aa6088b041e70 一致'],
['SDK 包','逐个核对文件存在性','android.jar / aapt2 / NDK / cmake / adb / system.img 均在'],
['内存并发','约束写入 init.gradle（不受 prebuild 重写影响）','手动重置 gradle.properties 后仍 BUILD SUCCESSFUL，APK 哈希不变']])}

<p class="muted">TLS 校验全程保持开启，未使用任何非官方制品源，未关闭证书验证。</p>

<h2>APK 产物</h2>${table(['项','值'],[
['路径', apkRel],
['大小', acceptance.android.apk.bytes.toLocaleString('en-US') + ' bytes'],
['SHA-256', apkSha],
['包名 / 版本', acceptance.android.apk.packageName + ' / ' + acceptance.android.apk.versionName],
['SDK', 'minSdk ' + acceptance.android.apk.minSdk + ' / targetSdk ' + acceptance.android.apk.targetSdk],
['签名', acceptance.android.apk.signer + '；' + acceptance.android.apk.apksigner],
['内容', acceptance.android.apk.nativeLibs]])}
<p class="muted">可复现性：清理 C++ 产物后重建，APK 哈希不变。</p>

<h2>原生运行实测</h2>
<p class="muted">模拟器 emulator-5554 · AVD subwise_api30 · Android 11 / API 30 · x86_64 · TCG 软件模拟 · boot 412 秒</p>
${table(['验收项','结果','实际观察'],[
['系统启动','PASS','sys.boot_completed=1'],
['App 安装','PASS','pm install -r -t → Success；package:dev.subwise.p03b'],
['App 启动','PASS','mResumedActivity: dev.subwise.p03b/.MainActivity；logcat 无 FATAL'],
['SQLite 写入','PASS', rt.sqlite.evidence],
['重启后保留','PASS', rt.appRestartPersistence.evidence],
['离线冷启动','PASS', rt.offlineColdStart.evidence],
['系统安全存储','PASS', rt.secureStore.evidence],
['无凭据 HTTPS','PASS', rt.httpsProbe.evidence],
['本地通知','PASS', rt.notifications.evidence],
['四导航','PASS', rt.navigation.evidence]])}

<figure><img src="data:image/png;base64,${shot}" alt="Android 模拟器上运行的 Subwise P03-B 探针"><figcaption>模拟器运行截图。不是物理设备证据；真机仍 NOT_RUN。</figcaption></figure>

<h2>本机环境限制（非产品缺陷）</h2>
<ul>
<li>无 <code>/dev/kvm</code> → 只能 TCG 软件模拟，API 30 启动约 412 秒。</li>
<li>API 34 镜像的模拟器被 cgroup OOM kill（qemu 需约 1.7GB anon-rss），故改用 API 30 default 镜像。</li>
<li>模拟器进程本身曾被 OOM kill 2 次 → 跑模拟器前需关闭常驻服务释放内存。</li>
<li><code>adb install</code>（streamed）慢链路会失败，需改用 <code>push</code> + <code>shell pm install</code>。</li>
</ul>
<p class="muted">以上均为本机资源/网络条件所致，不构成对 RN/Expo 路线的否定，也不构成对产品代码的缺陷判定。</p>

<h2>与上一轮的关系</h2>
<p>上一轮的 <code>README.md</code>、<code>SUBWISE-P03-B1-REPORT.html</code>、<code>build-report.mjs</code>、<code>verify-report.mjs</code> 及其 <code>evidence/*.json</code> <strong>一字未改</strong>，作为历史证据保留。${preserved.length} 个基线文件 SHA-256 全部一致。</p>
<p>上一轮校验脚本第 13 行硬编码断言「APK 必须不存在」（固化旧轮次 BLOCKED 状态），本轮 APK 产出后该断言会失败。按「历史证据 scoped」纪律<strong>未修改旧脚本</strong>，改为新建独立校验脚本 <code>verify-report-linux.mjs</code> 断言新状态。</p>

<h2>交付物</h2>${table(['文件','用途'],[
['P03-B1-LINUX-REPORT.md','本轮阶段收尾报告（可读版）'],
['LINUX-DEV-ENV.md','本机开发环境说明与可复现命令'],
['evidence/acceptance-linux-2026-10-30.json','本轮验收状态结构化证据'],
['evidence/android-screenshot.png','模拟器运行截图'],
['evidence/android-ui-final.xml','模拟器 UI 层级 dump'],
['evidence/linux-baseline.json','基线哈希（' + baseline.length + ' 个文件）'],
['verify-report-linux.mjs','本轮独立校验脚本'],
['build-report-linux.mjs','本轮报告生成脚本']])}

<h2>下一步</h2>
<ol>
<li><strong>iOS</strong>：Mac 上解压 <code>artifacts/subwise-p03-b1-mac-handoff.zip</code>，根目录执行 <code>node mobile/p03-b1/mac-verify.mjs</code>。</li>
<li><strong>HarmonyOS</strong>：独立跟踪，见 <a href="HARMONY-TRACK.md">HARMONY-TRACK.md</a>。</li>
<li><strong>物理真机</strong>：模拟器结论不可替代真机验收。</li>
<li><strong>P03-C</strong>：本轮 Android 一端已过原生门，但不等于自动获授权，仍需 FA 确认。</li>
<li><strong>P04</strong>：本地领域与存储模型。</li>
</ol>

<h2>安全与范围</h2>
<p>全程未使用真实平台凭据；密钥仅从环境变量读取，未落盘、未进代码、未写入报告。未关闭 TLS 或证书校验，未使用私有/未经验证的制品源。未修改全局 Java/Gradle/代理/网络配置，未修改全局 Android SDK。未修改任何业务代码、已批准 UI 或旧轮次报告。本轮 commit 并推送了本报告与本轮证据文件（FA 于 2026-10-30 明确授权）。</p>

<h2>原始证据</h2>
<pre>${esc(JSON.stringify(acceptance, null, 2))}</pre>
</main></body></html>`;

writeFileSync(resolve(dir, 'SUBWISE-P03-B1-LINUX-REPORT.html'), html);
console.log(JSON.stringify({
  report: 'SUBWISE-P03-B1-LINUX-REPORT.html',
  status: acceptance.overall,
  preserved: preserved.length,
  apkSha256: apkSha
}));
