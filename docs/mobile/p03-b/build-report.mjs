import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';
const dir=fileURLToPath(new URL('.',import.meta.url));
const root=resolve(dir,'../../..');
const read=name=>readFileSync(resolve(dir,name),'utf8');
const json=name=>JSON.parse(read(name).replace(/^\uFEFF/,''));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const baseline=json('evidence/baseline.json');
const preservation=baseline.map(item=>({...item,currentSha256:hash(resolve(root,item.path)),unchanged:hash(resolve(root,item.path))===item.sha256}));
writeFileSync(resolve(dir,'evidence/preservation.json'),JSON.stringify(preservation,null,2));
const pkg=JSON.parse(readFileSync(resolve(root,'mobile/p03-b/rn/package.json')));
const commands=['typecheck','tests','dependencies','expo-compatibility','native-js-bundle','web-bundle','android-prebuild','android-assemble'].map(name=>json(`evidence/${name}.json`));
const verdict={phase:'P03-B',date:'2026-10-29',timezone:'Asia/Shanghai',verdict:'PARTIAL',nativeGate:'NOT_PASSED',recommendation:'React Native / Expo + independent ArkTS, conditional; final production stack not ratified',nativeRuntime:{android:'NOT_RUN',ios:'NOT_RUN',harmony:'NOT_RUN'},build:{android:'FAIL_ENVIRONMENT',ios:'NOT_RUN',harmony:'NOT_RUN'},nextPhaseStarted:false,commitPush:false,realCredentialsUsed:false,baselinePreserved:preservation.every(x=>x.unchanged)};
writeFileSync(resolve(dir,'evidence/acceptance.json'),JSON.stringify(verdict,null,2));
const sources=[
 ['Expo SQLite SDK 55','https://docs.expo.dev/versions/v55.0.0/sdk/sqlite/','文档支持 iOS/Android；Web 为 WASM 辅助验证。本轮采用安装包版本，不从 latest 页面推算。'],
 ['Expo SecureStore SDK 55','https://docs.expo.dev/versions/v55.0.0/sdk/securestore/','Keychain/Android 安全存储候选；卸载及备份行为必须分别验证。'],
 ['Expo Notifications SDK 55','https://docs.expo.dev/versions/v55.0.0/sdk/notifications/','iOS/Android 本地通知 API；本轮没有远程 Push、APNs/FCM 凭据。'],
 ['React Native out-of-tree','https://reactnative.dev/docs/out-of-tree-platforms','OpenHarmony 是外部维护平台；不能据此认定 Expo 模块支持原生鸿蒙。'],
 ['Flutter supported platforms','https://docs.flutter.dev/reference/supported-platforms','上游支持平台未列 HarmonyOS；换 Flutter 不消除原生鸿蒙与插件验证门。'],
 ['DeepSeek Get User Balance','https://api-docs.deepseek.com/api/get-user-balance/','公开余额响应字段；is_available=false 指余额不足，不能作为 schema_error 或伪造零余额。'],
 ['Huawei Asset Store','https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-asset','本轮页面返回空正文；未作为源码已编译或 API签名已核实证据。'],
 ['Huawei relationalStore','https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/data-persistence-by-rdb-store','本轮页面返回空正文；需在 SDK 内核对类型与事务实现。'],
 ['Huawei 通知 FAQ','https://developer.huawei.com/consumer/cn/doc/doccenter-dev-faq/notification-kit-faq-0002','可读官方授权示例；不代表本机通知实测。']
];
const table=(heads,rows)=>`<div class="overflow"><table><thead><tr>${heads.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const matrix=[
 ['JS/类型/依赖','PASS · 0.83.10 Android Hermes bundle','PASS · 0.83.10 iOS Hermes bundle','NOT_RUN · ArkTS 未编译'],
 ['原生构建','FAIL · Gradle 下载连接拒绝；无 APK','NOT_RUN · Windows 无 Xcode；无 IPA','NOT_RUN · 未确认 SDK/Hvigor；无 HAP'],
 ['模拟器/真机启动','NOT_RUN · AVD 未启动，无已连接设备','NOT_RUN','NOT_RUN · 无 Android 兼容替代'],
 ['原生 SQLite/冷启动','NOT_RUN · expo-sqlite 源码接线完成','NOT_RUN · expo-sqlite 源码接线完成','NOT_RUN · relationalStore 候选源码'],
 ['系统安全存储','NOT_RUN · SecureStore 测试标记探针','NOT_RUN · Keychain 测试标记探针','NOT_RUN · Asset Store 候选，空查询行为待核对'],
 ['原生 HTTPS','NOT_RUN · 固定 URL 无凭据探针','NOT_RUN · 固定 URL 无凭据探针','NOT_RUN · 重定向行为尚未验收'],
 ['权限/通知送达','NOT_RUN · 5 秒本地通知探针','NOT_RUN · 5 秒本地通知探针','NOT_RUN · 即时通知候选，不等同预排提醒'],
 ['基础页面交互','NOT_RUN · 移动端；Web 单独通过','NOT_RUN · 移动端；Web 单独通过','NOT_RUN · ArkUI 四导航候选']
];
const commandRows=commands.map(c=>[c.name,c.status,String(c.exitCode),c.command]);
const versionRows=Object.entries({...pkg.dependencies,...pkg.devDependencies}).map(([n,v])=>[n,v]);
const evidenceNames=['acceptance.json','toolchain.json','native-config-inspection.json','preservation.json','https-host.json','browser-observations.json'];
const details=evidenceNames.map(n=>`<details><summary>${esc(n)}</summary><pre>${esc(read('evidence/'+n))}</pre></details>`).join('')+commands.map(c=>`<details><summary>${esc(c.name)} · ${esc(c.status)} · 原始日志</summary><pre>${esc(read('evidence/'+c.log))}</pre></details>`).join('');
const screenshot=readFileSync(resolve(dir,'evidence/web-probe.png')).toString('base64');
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Subwise P03-B 最小技术验证</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f8fc;color:#182640;font:16px/1.75 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1120px;margin:auto;padding:44px 24px 80px}header{border-top:6px solid #315dcc;padding:28px 0}h1{font-size:36px;line-height:1.2}h2{font-size:24px;margin-top:38px}h3{font-size:19px}p{max-width:95ch}.eyebrow{color:#315dcc;font-weight:700;letter-spacing:2px}.banner{padding:20px 24px;background:#fff4df;border-left:5px solid #986017;border-radius:8px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{background:white;border:1px solid #dce3ef;border-radius:14px;padding:20px}.card strong{display:block;font-size:24px}.muted{color:#58657b}.overflow{overflow:auto}table{border-collapse:collapse;width:100%;background:white;font-size:14px}td,th{padding:13px;text-align:left;border:1px solid #dce3ef;vertical-align:top}th{background:#e8eefc;white-space:nowrap}code,pre{font-family:Consolas,monospace}pre{white-space:pre-wrap;word-break:break-word;background:#edf1f7;padding:16px;font-size:12px;max-height:560px;overflow:auto}details{margin:12px 0;border:1px solid #dce3ef;border-radius:8px;padding:12px;background:white}summary{cursor:pointer;font-weight:600}a{color:#315dcc}figure{margin:20px 0}img{max-width:100%;width:640px;border:1px solid #dce3ef;border-radius:12px}figcaption{color:#58657b;font-size:14px}li{margin:8px 0}@media(max-width:720px){main{padding:24px 16px}.cards{grid-template-columns:1fr}h1{font-size:29px}}@media print{details{break-inside:avoid}pre{max-height:none}main{padding:0}}
</style></head><body><main>
<header><div class="eyebrow">SUBWISE / P03-B / 2026-10-29</div><h1>移动端最小技术验证</h1><p class="muted">FX 验收 · Asia/Shanghai · 完全离线报告 · 无真实密钥 · 未进入 P03-C / P04</p></header>
<div class="banner"><strong>验收结论：PARTIAL。原生验收门未通过。</strong><p>已交付独立验证工程与可复核的主机 / Web 数据链路。Android 原生构建被环境阻塞，iOS 与 HarmonyOS 构建及三端原生运行均 NOT_RUN。当前证据不足以最终锁定可发布的三端技术栈；不将本轮交付完成写成三端技术验证全部通过。</p></div>
<h2>框架建议与选择依据</h2><p><strong>继续首选 React Native + Expo（iOS / Android）与独立 ArkTS / ArkUI（原生 HarmonyOS），但保留原生验证门。</strong>RN 已形成可类型检查、可双端打包、能在 Web 同源渲染并读写 SQLite 的小工程；这支持继续投入验证，但尚未证明原生插件组合能构建和运行。鸿蒙采用原生服务接口以避免假设 Expo 模块可直接迁移，代价是两套 UI 和跨语言合同维护。</p>
${table(['方案','本轮证据','决定'],[['RN / Expo + ArkTS','RN 类型/JS bundle/SQL/Web 链路通过；ArkTS 仅候选源码','有条件首选；原生门关闭后才能定版'],['Flutter + 鸿蒙适配','仅官方支持边界对比；Flutter CLI 未在 PATH，未创建 Flutter 工程或运行性能测试','暂不切换；当前失败来自环境，并非已证明 RN 不可行'],['React Native OpenHarmony','官方列为 out-of-tree；未验证 Expo SQLite/SecureStore/Notifications 鸿蒙覆盖','不作为本轮可复用 UI 承诺']])}
<p>Expo 55 是本轮刻意固定的验证组合，注册表另有 58.0.21；未把“最新”当作最好，也没有对 55 做长期维护期限承诺。生产选版与升级支持需在下一次决策中核对。Flutter 比较仅限官方支持边界，不声称性能、包体或开发成本胜出。</p>
<h2>实测概览</h2><div class="cards"><div class="card"><strong>8 / 8</strong>主机测试通过<br><span class="muted">真实磁盘 SQLite、跨进程重开、事务回滚、数据校验</span></div><div class="card"><strong>2 个 JS bundle</strong>Android / iOS Hermes<br><span class="muted">不是 APK / IPA 原生构建结果</span></div><div class="card"><strong>0 个原生启动包</strong>APK / IPA / HAP 均未验收<br><span class="muted">安全存储、通知、真机 HTTPS：NOT_RUN</span></div></div>
<h2>逐端支持与实际结果</h2>${table(['能力','Android','iOS','原生 HarmonyOS'],matrix)}
<p>PASS 只在列明环境内成立；FAIL 表示确实运行了命令且失败；NOT_RUN 表示没有执行，不能推断成功或失败。候选源码存在不算 API 能力验收。</p>
<h2>依赖与工具链</h2>${table(['直接依赖（package-lock.json 锁定完整树）','实际安装版本'],versionRows)}
${table(['项目','本轮结果'],[['主机','Windows；Node 24.21.0；npm 11.19.0；未安装/改动全局工具'],['Android 工具','SDK 目录已存在；仅 platform 30/33；Build Tools 最高 35.0.0；adb 枚举为空；已有两个 AVD 未启动'],['Android 目标（安装包源码）','minSdk 24；compile/target 36；Build Tools 36.0.0；NDK 27.1.12297006；AGP 8.12.0；Gradle wrapper 9.0.0'],['Java 差异','PATH java 17.0.9，但 JAVA_HOME 为 JDK 8；第二次仅进程内用已有 JDK 17，下载仍 Connection refused'],['iOS 目标（安装包源码）','RN helpers.rb 与 Expo.podspec 显示 iOS 15.1；不是实测最低系统；Xcode/CocoaPods 版本 NOT_RUN'],['HarmonyOS 候选','compile/compatible SDK 5.0.0(12)，Hvigor modelVersion 5.0.0；DevEco/编译器/插件解析版本 NOT_RUN；无依赖锁文件']])}
<p>Android 失败先发生在 Gradle 分发包下载，尚未到 SDK 缺口检查或 Kotlin/C++ 编译阶段；不能把推测的后续错误写成实际错误。重试未关闭 TLS、未更改网络/代理、安全边界或全局 JAVA_HOME。</p>
<h2>模拟适配器 → 本地存储 → UI</h2><p>RN 的模拟响应先经过 normalize 校验，以不可变观测 ID 写入 SQLite 事务，再查询数据库并生成 UI 卡片。DeepSeek 多币种独立显示、金额保持十进制字符串；缺失赠金为 null，零余额正常显示；is_available=false 作为余额不足保留。MiniMax 使用 <code>subwise.synthetic.windows.v1</code> 内部测试合同：5 小时余量 62/100 与周窗口未知分别展示，不把两个窗口合成总进度，不把过期窗口自动清零。</p>
${table(['证据范围','实测','不能推出'],[['Node / node:sqlite','8 项通过：多币种/精度/缺失/不可用、窗口未知/过期/越界/重复、独立子进程重开、幂等、失败留存、事务回滚、未来 schema 拒绝、固定无凭据请求策略','原生 expo-sqlite、飞行模式杀进程重启已通过'],['浏览器 / RN Web + SQLite WASM','首次空态、写入并显示四张卡、损坏响应留存、页面重载持久化、四导航；Web 安全存储/通知正确标 NOT_RUN','手机触控、系统锁屏/备份、SQLite 原生实现已通过'],['宿主 HTTPS','固定 DeepSeek 官方 GET /user/balance，未带 Authorization，观察 HTTP 401','真实账户余额成功、移动网络可达、TLS 错误/401/429 全链路已通过'],['HarmonyOS','具备原生 RDB/Asset/HTTP/通知/ArkUI 候选源文件；fixture 与 RN 一致','ArkTS 编译、跨端适配器等价、历史模型一致、HAP 运行通过']])}
<figure><img alt="桌面浏览器中的模拟 SQLite 数据链路验证，不是手机真机截图" src="data:image/png;base64,${screenshot}"><figcaption>桌面 IAB 实测截图：RN Web + expo-sqlite WASM。固定 2026-10-29 数据全部为模拟。并非已批准产品 UI 的修改。</figcaption></figure>
<h2>构建与执行日志</h2>${table(['检查','结果','退出码','实际命令'],commandRows)}
<p>首次 Expo 安装因运行中的 CLI 依赖被替换，末尾出现模块加载错误；重新调用 CLI 后兼容检查通过，未用初次命令结果宣称成功。类型检查发现一个隐式 any，已用 Card 类型修正；最终日志反映修复后的状态。包安装时的上游过时依赖警告未等同漏洞审计通过，本轮未做完整供应链/发布审核。</p>
<h2>未解决问题与 P03-C 准备条件</h2><ol>
<li><strong>先关闭原生工程门：</strong>恢复官方 Gradle/Maven 下载并准备 SDK 36/NDK；获得 Mac/Xcode；确认 DevEco/HarmonyOS SDK/编译器。每端产出可核对哈希的包及启动证据，不能用 Expo Web 或 Android 兼容运行替代。</li>
<li><strong>再关闭系统服务门：</strong>三端 SQLite 杀进程/飞行模式/重启、安全存储测试标记写读删及锁屏/备份/卸载行为、通知拒绝/允许/实际送达、原生 HTTPS 超时/重定向/网络失败。当前源码没有持久化测试回执，必须记录外部观察。</li>
<li><strong>鸿蒙仍是高不确定项：</strong>Asset 删除后空查询返回/错误、ArkTS 严格类型、SDK API签名和事务均需编译与设备验证。两端持久化模型不完全相同，正式接入前应统一合同与失败语义。Harmony 即时通知不等同 RN 5 秒调度。</li>
<li><strong>真实平台合同：</strong>DeepSeek 首先复核产品、地区、授权方式；MiniMax 获取官方可核实响应 schema/单位/共享池/窗口身份，不能直接把本轮内部模拟结构映射为真实接口。未知、无上限和零应继续区分。未经验证的私有接口不接入。</li>
<li><strong>凭据与真实查询：</strong>仅在新阶段明确授权及系统安全存储通过后引入用户凭据；固定主机/路径、禁止认证跨域重定向、无日志/备份秘密、超时与401/403/429处理及失败保留。不要通过推理请求测试额度。</li>
<li><strong>发布与 UI：</strong>当前页面是技术探针，安全区为简化固定留白；读屏、大字、物理输入、主题、设备旋转、长期迁移、时区/月底通知、签名和商店审查均 NOT_RUN，不能当作已批准 UI 的移动实现完成。</li>
</ol><p><strong>本轮停止点：</strong>P03-B 工程与验收报告交付，状态 PARTIAL；不自动启动 P03-C 或 P04。真实平台接入前先补齐上述阻塞项，再由 FA 决定是否进入下一阶段。</p>
<h2>基线、范围与回滚</h2><p>对 ${preservation.length} 个既有文件重新计算 SHA-256：${preservation.every(x=>x.unchanged)?'全部一致':'发现差异，必须复核'}。包含已批准 UI、规划、产品文件和整个 P03-A。当前仓库原文件均未跟踪，使用文件哈希而非空 Git diff 作为保留证据。所有新增源文件限制在 mobile/p03-b 与 docs/mobile/p03-b；无 commit/push，无 Pi 调用，无真实账号查询。移除这两个新增目录可回滚本轮源码，需先确认没有后续工作；勿清理原基线。node_modules/Gradle 下载缓存不算产品变更。</p>
<h2>官方资料与证据边界</h2><ul>${sources.map(([title,url,note])=>`<li><a href="${url}">${esc(title)}</a> — ${esc(note)}</li>`).join('')}</ul><p>SDK 版本数值另取自实际安装的 package-lock.json、React Native gradle/libs.versions.toml 与 iOS podspec；链接只是文档支持，不代表本机运行。</p>
<h2>离线证据附录</h2>${details}<details><summary>复现与逐端验收步骤</summary><pre>${esc(read('README.md'))}</pre></details>
</main></body></html>`;
writeFileSync(resolve(dir,'SUBWISE-P03-B-REPORT.html'),html);
const files=[];
function walk(path){for(const entry of readdirSync(path,{withFileTypes:true})){if(['node_modules','.expo','android','ios','dist-native','dist-web','.hvigor','oh_modules','build'].includes(entry.name))continue;const file=resolve(path,entry.name);if(entry.isDirectory())walk(file);else if(!/source-manifest\.json|report-validation\.json/.test(entry.name))files.push({path:relative(root,file).replaceAll('\\','/'),sha256:hash(file),bytes:statSync(file).size});}}
walk(resolve(root,'mobile/p03-b'));walk(dir);
writeFileSync(resolve(dir,'evidence/source-manifest.json'),JSON.stringify(files,null,2));
console.log(JSON.stringify({report:'docs/mobile/p03-b/SUBWISE-P03-B-REPORT.html',verdict:verdict.verdict,preserved:preservation.length,allPreserved:verdict.baselinePreserved,files:files.length}));
