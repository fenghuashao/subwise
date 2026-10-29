import {readFileSync,writeFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';
const dir=fileURLToPath(new URL('.',import.meta.url)),root=resolve(dir,'../../..');
const read=p=>readFileSync(resolve(dir,p),'utf8').replace(/^\uFEFF/,'');
const json=p=>JSON.parse(read(p));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const baseline=json('evidence/baseline.json');
const preserved=baseline.map(x=>({...x,currentSha256:hash(resolve(root,x.path)),unchanged:hash(resolve(root,x.path))===x.sha256}));
if(!preserved.every(x=>x.unchanged))throw Error('Existing baseline changed');
writeFileSync(resolve(dir,'evidence/preservation.json'),JSON.stringify(preserved,null,2));
const apkPath=resolve(root,'mobile/p03-b/rn/android/app/build/outputs/apk/release/app-release.apk');
if(existsSync(apkPath))throw Error('APK now exists: reassess report rather than keeping a stale BLOCKED verdict');
const builds=[1,2,3].map(n=>({attempt:n,exitCode:Number(read(`evidence/android-build-${n}.exit`).trim()),status:'FAIL',log:`android-build-${n}.log`}));
if(builds.some(b=>b.exitCode===0))throw Error('Native build changed: reassess');
const zip='artifacts/subwise-p03-b1-mac-handoff.zip';
const artifacts=[{path:zip,kind:'Mac source handoff; NOT IPA or .app',sha256:hash(resolve(dir,zip)),bytes:statSync(resolve(dir,zip)).size}];
const acceptance={phase:'P03-B1',date:'2026-10-29',timezone:'Asia/Shanghai',overall:'BLOCKED',android:{gradleBootstrap:'PASS',emulatorOsBoot:'PASS',build:'FAIL',buildGate:'BLOCKED',apk:'NOT_PRODUCED',appLaunch:'NOT_RUN',sqlite:'NOT_RUN',secureStore:'NOT_RUN',https:'NOT_RUN',notifications:'NOT_RUN',appRestartPersistence:'NOT_RUN',physicalDevice:'NOT_RUN'},ios:{access:'BLOCKED',reason:'FA confirmed Mac mini M4 unavailable this turn',handoff:'PASS',build:'NOT_RUN',runtime:'NOT_RUN'},harmony:{toolchain:'BLOCKED',build:'NOT_RUN',runtime:'NOT_RUN'},frameworkDecision:'Retain RN/Expo candidate; native evidence insufficient to approve formal development or P03-C',nextPhaseStarted:false,committedOrPushed:false,baselinePreserved:preserved.length,builds,artifacts};
writeFileSync(resolve(dir,'evidence/acceptance.json'),JSON.stringify(acceptance,null,2));
const env={jdk:{before:'JAVA_HOME=JDK8 vs PATH Java17',used:'Oracle JDK17.0.9, process-only'},gradle:{version:'9.0.0',oldProxyPort:7890,observedRunningProxyPort:7897,globalConfigEdited:false,isolatedHome:'.local/p03-b1/gradle'},sdk:{root:'.local/p03-b1/sdk',required:['platforms/android-36','build-tools/36.0.0','ndk/27.1.12297006','cmake/3.22.1'],installedRequiredPackages:[],officialCommandTools:{file:'commandlinetools-win-16111833_latest.zip',verifiedSha1:'57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d',sha256:'e5885e2e59038c0778a85fc19f01de7ce7c567c105553f7617b936b1e0e87b2b'}},tlsValidationDisabled:false,privateMirrors:false,realPlatformCredentialsUsed:false,harmonySearch:'PATH; C/D Program Files and AppData/Local standard locations only; not a whole-disk proof of absence'};
writeFileSync(resolve(dir,'evidence/environment-summary.json'),JSON.stringify(env,null,2));
const table=(heads,rows)=>`<div class="scroll"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const logExcerpt=name=>read('evidence/'+name).replace(/[.#]{15,}/g,'…').slice(-6500);
const image=readFileSync(resolve(dir,'evidence/emulator-boot.png')).toString('base64');
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Subwise P03-B1 原生构建验收</title><style>body{margin:0;background:#f6f8fc;color:#182640;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1040px;margin:auto;padding:36px 24px 72px}header{border-top:5px solid #315dcc;padding:18px 0}h1{font-size:32px}h2{font-size:23px;margin-top:32px}.status{background:#fff1d9;border-left:5px solid #986017;padding:20px;border-radius:8px}a{color:#315dcc}table{border-collapse:collapse;width:100%;background:white;font-size:14px}th,td{border:1px solid #dce3ef;padding:12px;text-align:left;vertical-align:top}th{background:#e8eefc}.scroll{overflow:auto}.muted,figcaption{color:#58657b;font-size:14px}details{background:white;border:1px solid #dce3ef;border-radius:8px;padding:12px;margin:12px 0}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;word-break:break-word;font-size:12px;max-height:420px;overflow:auto}img{max-width:100%;width:290px;border-radius:10px}li{margin:8px 0}code{font-family:Consolas,monospace}figure{margin:20px 0}@media print{pre{max-height:none}}</style></head><body><main>
<header><p class="muted">SUBWISE · FX · 2026-10-29 · Asia/Shanghai</p><h1>P03-B1 原生构建与验收收口</h1></header>
<div class="status"><strong>整体 BLOCKED：未产出可安装 APK，未达到 iOS/Android 原生验收门。</strong><p>旧代理端口与 JDK 选择问题已处理，但官方 SDK/Maven 下载持续中断。三次原生构建均 FAIL；App 启动、SQLite、安全存储、HTTPS、通知及重启保留均 NOT_RUN。不能把模拟器系统启动写成 Subwise 运行通过。</p></div>
<h2>结果与证据</h2>${table(['项目','状态','实际观察'],[
['Gradle/JDK启动','PASS','独立缓存中 Gradle 9.0.0 + JDK17.0.9 成功启动；原全局配置未改'],
['原生构建 1','FAIL · exit 1','Google Maven builder-8.5.0.jar 下载 TLS 握手中断；部分 Expo/RN Gradle插件已编译'],
['原生构建 2','FAIL · exit 1','仅本任务使用运行中的7897代理；随后 Maven依赖解析仍因握手中断失败'],
['原生构建 3','FAIL · exit 1','为 Maven/Gradle主机使用限定直连路径再次尝试；Kotlin依赖HEAD请求仍握手中断'],
['SDK依赖安装','FAIL / 环境 BLOCKED','官方 Android 36平台包约69%处 closed，exit 1；SDK36/Build Tools36/NDK27.1/CMake3.22.1未就绪'],
['独立模拟器系统启动','PASS','Subwise_P03B1；Android14/API34 x86_64；sys.boot_completed=1；App未安装'],
['Android App原生验收','NOT_RUN','无APK：启动、SQLite、SecureStore、HTTPS、通知、应用重启保留均没有运行证据'],
['iOS','环境 BLOCKED / 构建运行 NOT_RUN','FA已确认Mac mini M4当前不可访问；交付可执行任务及源码ZIP'],
['原生HarmonyOS','工具链 BLOCKED / 构建运行 NOT_RUN','标准位置与PATH未定位DevEco/Hvigor；独立跟踪，不用Android兼容结果替代']])}
<p class="muted">PASS＝该项在注明范围内实测满足；FAIL＝已执行但失败；BLOCKED＝前置条件阻止目标完成；NOT_RUN＝没有执行。失败构建不等于已发现产品代码缺陷。Windows外层脚本退出0也不能覆盖子命令保存的exit 1；最初sdkmanager包装器还曾因不兼容分号包名报not found而返回0，已改用新CLI的slash包名。</p>
<figure><img src="data:image/png;base64,${image}" alt="独立Android模拟器系统主页，Subwise尚未安装"><figcaption>唯一原生窗口实测截图：Android模拟器系统已启动。不是Subwise App通过证据；物理设备仍NOT_RUN。</figcaption></figure>
<h2>根因、采取的修正与剩余阻塞</h2><p>原GRADLE_USER_HOME中的代理指向未监听的7890；当前代理进程监听7897。原JAVA_HOME为JDK8，而PATH为JDK17。已在任务进程中固定JDK17、独立Gradle缓存和任务SDK，并尝试直连、现有代理及限定主机路径。官方Gradle分发包和命令行工具下载成功，但Google/Maven长连接与TLS握手仍不稳定，所需SDK包未完成安装。</p><p>没有关闭TLS或证书验证，没有换用私有/未经验证的仓库，没有修改代理软件出口、系统网络、全局JDK/Gradle设置，也未升级Expo/RN以绕过错误。下载失败的JAR预取没有写入已验证缓存；不把失败重试算成功。SDK官方命令行工具文件已核对元数据SHA-1，另记录SHA-256。</p>
<h2>交付与下一步</h2>${table(['交付物','用途 / 边界'],[['artifacts/subwise-p03-b1-mac-handoff.zip','源码+锁文件+Mac脚本+逐项验收任务；不是IPA/.app/APK'],['mobile/p03-b1/mac-verify.mjs','Mac arm64构建、签名校验、独立模拟器安装启动；脚本语法PASS，Mac执行NOT_RUN'],['MAC-TASK.md','SQLite/安全存储/HTTPS/通知/重启逐项实测；默认所有未观察能力NOT_RUN'],['mobile/p03-b1/build-android.ps1','限定工作区Gradle/SDK、进程JDK/代理；网络稳定后复现x86_64测试构建'],['HARMONY-TRACK.md','工具链、ArkTS编译、HAP原生运行独立跟踪']])}
<p><a href="artifacts/subwise-p03-b1-mac-handoff.zip">打开 Mac交接ZIP</a> · <a href="MAC-TASK.md">Mac执行任务</a> · <a href="README.md">Android复现与完整范围</a> · <a href="HARMONY-TRACK.md">鸿蒙跟踪</a></p><p class="muted">ZIP SHA-256：<code>${artifacts[0].sha256}</code></p>
<ol><li>先提供稳定访问官方Gradle/Maven/Google SDK的HTTPS通路；安装并核对SDK36、Build Tools36、NDK27.1.12297006、CMake3.22.1的实际文件和版本，再构建APK。单纯重复相同下载不能关闭环境门。</li><li>在独立模拟器安装APK，观察页面启动；验证模拟数据写入SQLite、失败保留、终止进程及重启后留存、安全标记写读删、无凭据HTTPS、通知拒绝/允许/实际送达。模板现有release使用测试签名，即使构建成功也不代表生产签名已通过；不得关闭签名验证。</li><li>在Mac mini M4解压交接包，在根目录执行 <code>node mobile/p03-b1/mac-verify.mjs</code>。沿用锁定版本，不复制Windows依赖；Mac/Xcode签名与许可由本人按正规流程准备。模拟器app不是物理iPhone IPA。</li><li>iOS/Android各自通过原生门并复核后，才可建议进入P03-C。HarmonyOS保持独立跟踪，未通过不宣称三端全部支持。</li></ol>
<h2>技术决策与范围保留</h2><p><strong>保留 React Native + Expo 作为候选；当前证据不足以批准正式开发或P03-C。</strong>本轮失败主要来自构建环境，不能据此否定框架；同样不能凭JS打包、插件源码或系统模拟器启动判定原生能力可用。未重新运行P03-B已通过的主机/Web测试，未修改已批准UI、业务架构和旧报告。</p><p>${preserved.length}个既有交付/基线文件SHA-256全部一致。新增文件仅为环境复现、交接、报告和被忽略的任务缓存；生成Android local.properties指向任务SDK。未使用真实平台凭据，未commit/push，未进入P03-C/P04。本轮到此停止，等待人工确认。回滚与清理边界见README；不得删除原先未跟踪的工作区文件。</p>
<h2>日志与原始记录</h2>${builds.map(b=>`<details><summary>构建${b.attempt} · exit ${b.exitCode} · FAIL</summary><pre>${esc(logExcerpt(b.log))}</pre><a href="evidence/${b.log}">完整本地日志</a></details>`).join('')}
<details><summary>SDK下载失败记录</summary><pre>${esc(logExcerpt('sdk-install-3.log'))}</pre></details>
<details><summary>环境、产物及验收状态JSON</summary><pre>${esc(JSON.stringify({environment:env,acceptance,emulator:json('evidence/emulator-observation.json')},null,2))}</pre></details>
<p class="muted">官方参考：<a href="https://docs.expo.dev/guides/local-app-development/">Expo本地原生构建</a>；<a href="https://developer.android.com/studio">Android官方工具</a>；<a href="https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices">Apple设备/模拟器运行</a>。链接说明工具路线，不作为本次运行成功证据。</p>
</main></body></html>`;
writeFileSync(resolve(dir,'SUBWISE-P03-B1-REPORT.html'),html);
console.log(JSON.stringify({report:'SUBWISE-P03-B1-REPORT.html',status:acceptance.overall,preserved:preserved.length,apk:existsSync(apkPath),zipSha256:artifacts[0].sha256}));
