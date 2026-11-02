#!/usr/bin/env python3
"""生成 P03-B1 复核轮的离线 HTML 报告。

约束（仓库既有纪律）：
- 报告必须离线可读：无 <script> / <iframe> / @import / url()，图片用 base64 内嵌。
- 非 https 的 href 必须指向真实存在的文件。
- 不修改任何旧轮次的报告或证据文件；本脚本只产出本轮自己的 HTML。

用法：
  python3 docs/mobile/p03-b1/build-recheck-report.py
输出：
  docs/mobile/p03-b1/SUBWISE-P03-B1-RECHECK-2026-11-02.html
读取：
  docs/mobile/p03-b1/evidence/recheck-2026-11-02.json
"""
import base64
import json
import os
import sys

# 本文件位于 <repo>/docs/mobile/p03-b1/build-recheck-report.py
DOCS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(DOCS)))
EVID = os.path.join(DOCS, "evidence")
OUT_HTML = os.path.join(DOCS, "SUBWISE-P03-B1-RECHECK-2026-11-02.html")
EVID_JSON = os.path.join(EVID, "recheck-2026-11-02.json")

CSS = """<style>
body{margin:0;background:#f6f8fc;color:#182640;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}
main{max-width:1060px;margin:auto;padding:36px 24px 72px}
header{border-top:5px solid #315dcc;padding:18px 0}
h1{font-size:32px}h2{font-size:23px;margin-top:34px}h3{font-size:19px;margin-top:24px}
.status{background:#eaf6ec;border-left:5px solid #1f7a44;padding:20px;border-radius:8px}
.warn{background:#fff1d9;border-left:5px solid #986017;padding:20px;border-radius:8px}
.bad{background:#fdeceb;border-left:5px solid #b3261e;padding:20px;border-radius:8px}
a{color:#315dcc}
table{border-collapse:collapse;width:100%;background:white;font-size:14px}
th,td{border:1px solid #dce3ef;padding:11px;text-align:left;vertical-align:top}
th{background:#e8eefc}
.scroll{overflow:auto}
.muted,figcaption{color:#58657b;font-size:14px}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:white;
    border:1px solid #dce3ef;border-radius:8px;padding:12px}
img{max-width:100%;width:300px;border-radius:10px}
li{margin:7px 0}code{font-family:Consolas,monospace;font-size:13px}
figure{margin:20px 0}
@media print{pre{page-break-inside:avoid}}
</style>"""

# 截图来源：优先用仓库内已入库的证据图片；
# 若本机还有原始截图（scratch 目录），则用更新鲜的那份。
# 两者都没有时跳过图片，不让生成脚本因缺文件而失败。
_SHOTS = [
    (
        os.path.join(DOCS, "evidence", "ios-simulator.png"),
        "/home/ubuntu/.hermes/cache/scratch/subwise/ios-evidence/ios-simulator.png",
        "iOS 模拟器实跑截图（run 41400104979）。总览页 UI 完整渲染，无报错；"
        "页面处于空状态「本地暂无快照」——脚本只启动不交互，功能断言未执行。",
    ),
]

SHOTS = []
for _repo_path, _local_path, _caption in _SHOTS:
    for _p in (_repo_path, _local_path):
        try:
            if _p and os.path.exists(_p):
                SHOTS.append((str(_p), _caption))
                break
        except OSError:
            continue


def esc(s):
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def img_data_uri(path):
    with open(path, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()


def build(ev):
    h = ev["harmonyCompilation"]
    c = h["crossCheck"]
    ios = ev["iosSimulatorRun"]
    apk = ev["androidApk"]
    repo = ev["repository"]

    findings_rows = "\n".join(
        "<tr><td><code>{id}</code></td><td>{sev}</td><td>{st}</td><td>{ti}</td></tr>".format(
            id=esc(f["id"]),
            sev=esc(f["severity"]),
            st=esc(f["status"]),
            ti=esc(f["title"]),
        )
        for f in ev["findings"]
    )

    apk_rows = "\n".join(
        "<tr><td><code>{r}</code></td><td>{b}</td><td><code>{s}</code></td></tr>".format(
            r=esc(k), b=esc(v["bytes"]), s=esc(v["sha256"] or "—")
        )
        for k, v in apk["ciRuns"].items()
    )

    not_run = "\n".join("<li>%s</li>" % esc(x) for x in h["still_NOT_RUN"])
    ios_not_run = "\n".join("<li>%s</li>" % esc(x) for x in ios["still_NOT_RUN"])
    not_claimed = "\n".join("<li>%s</li>" % esc(x) for x in ev["notClaimed"])

    figures = ""
    for path, caption in SHOTS:
        if not os.path.exists(path):
            continue
        figures += (
            '<figure><img src="{uri}" alt="{alt}"><figcaption>{cap}</figcaption></figure>'
        ).format(uri=img_data_uri(path), alt=esc(caption[:80]), cap=esc(caption))

    signed_local = "未签名" if not h["localRun"]["signed"] else "已签名"
    signed_ci = "未签名" if not h["ciRun"]["signed"] else "已签名"

    body = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Subwise P03-B1 状态复核轮 2026-11-02</title>
@@CSS@@
</head><body><main>

<header>
<p class="muted">SUBWISE · FX · 2026-11-02 · Asia/Shanghai · Ubuntu / 4 核 3.6GB / 无 KVM</p>
<h1>P03-B1 状态复核轮 —— 独立复验与文档纠错</h1>
</header>

<div class="status">
<strong>两个新提交已拉取并独立复验：HarmonyOS ArkTS 编译本机与 CI 双双通过，iOS 模拟器进程启动证据属实。</strong>
<p>本轮不新增功能、不改业务代码、不改已批准 UI。发现 4 处文档与事实不符并已修正，
另修复 1 项高危缺陷：校验脚本崩溃时证据缺失无任何信号。</p>
</div>

<div class="warn">
<strong>三端真机、生产签名、P03-C 授权本轮均未获得。</strong>
<p>iOS 只验证到「进程启动 + 静态信息」，功能断言一行未跑；HarmonyOS 只验证到「ArkTS 编译通过」，
签名 / 安装 / 运行 / 运行时行为全部 NOT_RUN。</p>
</div>

<h2>结论总览</h2>
<div class="scroll"><table><thead><tr><th>项</th><th>结论</th><th>依据</th></tr></thead><tbody>
<tr><td>拉取</td><td>PASS</td><td><code>424c9ff</code> → <code>6a8b94f</code>，2 个提交（PR #1、#2 已合并），本地与 <code>origin/main</code> 一致</td></tr>
<tr><td>HarmonyOS ArkTS 编译</td><td>PASS（独立复验）</td><td>本机 ERROR 0 / WARN 2，HAP 50,768 字节，8 条目，0 签名条目</td></tr>
<tr><td>HarmonyOS CI workflow</td><td>PASS（首次运行）</td><td>run <code>41404486235</code> 全绿，产物与本机逐条目内容摘要一致</td></tr>
<tr><td>iOS 模拟器进程启动</td><td>PASS（读 CI 证据）</td><td>run <code>41400104979</code>，<code>ios-run.json</code> status=RUN、launchPid 41594、截图 UI 完整渲染</td></tr>
<tr><td>iOS 功能断言</td><td>NOT_RUN</td><td>脚本只做启动不交互，截图处于空状态</td></tr>
<tr><td>本地回归</td><td>PASS</td><td><code>npm run check</code> 通过；探针 <code>tsc</code> exit 0；单测 8 passed</td></tr>
<tr><td>文档纠错</td><td>4 处已修</td><td>见「缺陷清单」</td></tr>
<tr><td>F3 证据缺失缺陷</td><td>已修</td><td>两个脚本加 EXIT 兜底 + CI 显式判定 status</td></tr>
<tr><td>自检</td><td>165 项断言全绿</td><td><code>node docs/mobile/p03-b1/verify-recheck-2026-11-02.mjs</code></td></tr>
<tr><td>真机 / 生产签名 / P03-C</td><td>NOT_RUN</td><td>本轮未触及</td></tr>
</tbody></table></div>

<p class="muted">PASS ＝该项在注明范围内实测满足；NOT_RUN ＝ 没有执行。</p>

<h2>本轮实际执行的验证</h2>

<h3>HarmonyOS 编译：本机从零复现</h3>
<p>不采信仓库里 <code>harmony-compile-linux-2026-10-30.json</code> 的自述，本机重跑了一遍。
工具链为官方 HarmonyOS 命令行工具链 5.1.0.840，包 2,153,496,473 字节，
sha256 <code>1dcefa47…478f1</code>（脚本 size + sha256 双校验，不匹配即拒绝使用）。
华为镜像实测 25MB/s，约 90 秒下载完毕。</p>

<div class="scroll"><table><thead><tr><th>项</th><th>本机</th><th>CI run 41404486235</th></tr></thead><tbody>
<tr><td>status</td><td>@@LR_STATUS@@</td><td>@@CR_STATUS@@</td></tr>
<tr><td>ERROR / WARN</td><td>@@LR_ERR@@ / @@LR_WARN@@</td><td>@@CR_ERR@@ / @@CR_WARN@@</td></tr>
<tr><td>HAP 字节</td><td>@@LR_BYTES@@</td><td>@@CR_BYTES@@</td></tr>
<tr><td>整包 sha256</td><td><code>@@LR_SHA@@</code></td><td><code>@@CR_SHA@@</code></td></tr>
<tr><td>签名</td><td>@@LR_SIGNED@@</td><td>@@CR_SIGNED@@</td></tr>
</tbody></table></div>

<p>两个 WARN：<code>entry</code> 模块版本 <code>0.0.1</code> 不合 SemVer（hvigor 要求首段非 0）、
<code>No signingConfig found for product default</code>。</p>

<h3>本机与 CI 产物比对：逐条目内容摘要一致</h3>
<p>整包 sha256 不同<strong>属预期</strong> —— HAP 是 zip，条目携带构建时间戳。改用逐条目内容摘要比对：</p>
<div class="scroll"><table><thead><tr><th>比对项</th><th>结果</th></tr></thead><tbody>
<tr><td>条目名一致</td><td><code>@@ENTRY_NAMES@@</code></td></tr>
<tr><td>逐条目内容摘要一致</td><td><code>@@ENTRY_DIGEST@@</code></td></tr>
<tr><td>条目数</td><td>@@ENTRY_COUNT@@</td></tr>
<tr><td>签名条目数</td><td><strong>@@SIG_COUNT@@</strong></td></tr>
<tr><td><code>ets/modules.abc</code></td><td>34,444 字节，魔数 <code>PANDA</code>（真实 ArkTS 字节码，非空壳）</td></tr>
<tr><td>bundleName</td><td><code>dev.subwise.p03b</code></td></tr>
<tr><td>min / target API</td><td>50000012 (API 12) / 50100018 (API 18)</td></tr>
</tbody></table></div>

<h3>Android APK 字节数与 sha256</h3>
<div class="scroll"><table><thead><tr><th>run</th><th>字节</th><th>sha256</th></tr></thead><tbody>
@@APK_ROWS@@
</tbody></table></div>
<p>字节数跨 run 稳定，sha256 每次变（签名时间戳）。本机 x86_64-only APK 为 @@LOCAL_APK@@ 字节，
与 CI 的 arm64+armeabi 产物不同，两者不可混用。</p>

<h3>本地回归</h3>
<pre>npm run check                    → 通过（node --check server.js &amp;&amp; app.js）
mobile/p03-b/rn: npx tsc --noEmit → exit 0
mobile/p03-b/rn: node --test      → tests 8 / pass 8 / fail 0</pre>

@@FIGURES@@

<h2>仍为 NOT_RUN 的项（本轮没有推进任何一项）</h2>
<h3>HarmonyOS（7 项）</h3>
<ul>@@HARMONY_NOT_RUN@@</ul>
<h3>iOS（4 项）</h3>
<ul>@@IOS_NOT_RUN@@</ul>
<p class="muted">Android 物理真机与生产发布签名（当前仍为 Expo 模板 debug 证书）同样未推进。
P03-C 仍需 FA 单独授权。</p>

<h2>缺陷清单</h2>
<div class="scroll"><table><thead><tr><th>ID</th><th>严重度</th><th>状态</th><th>标题</th></tr></thead><tbody>
@@FINDINGS_ROWS@@
</tbody></table></div>

<h3>F1（medium）PLAN.md 状态表 APK 大小写错 —— 已修</h3>
<p>原写「APK 19.62 MB」。三次 CI 日志均为 37,854,296 字节（36.1 MiB）。
该数字在 <code>66c3dc1</code> 引入时就是错的：Windows 轮从未产出 APK，仓库此前根本没有这张表。
已改为「✅ APK 37,854,296 字节（36.1 MiB）」。</p>

<h3>F2（medium）PLAN.md iOS 行状态落后于正文与 CI 事实 —— 已修</h3>
<p>原写「模拟器/实跑 ❌ NOT_RUN（本轮刚加实跑校验）」，但同一份文档上方已写明实跑通过，
run <code>41400104979</code> 也确实产出了 <code>status=RUN</code> 证据 —— 表格比正文旧。
已改为「◐ 进程启动已验证（PID 41594，截图 UI 完整渲染）；<strong>功能断言 NOT_RUN</strong>」，
同时把构建列的 14.18 MB 补清楚：那是 artifact zip 大小，<code>.app</code> 原始为 49.46 MiB。</p>

<h3>F3（high）两个校验脚本恒 exit 0，证据缺失无显式信号 —— <strong>已修</strong></h3>
<div class="bad">
<p><strong>现象</strong>：脚本崩溃时 <code>ios-run.json</code> / <code>harmony-build.json</code> 整个不存在。
上传步骤用 <code>if-no-files-found: warn</code> 不会报错；<code>continue-on-error: true</code> 进一步掩盖退出码。
结果是「文件不存在」与「文件里写着 NOT_RUN」在 CI 上表现完全一样 —— 无法区分
「环境不具备，本次没做」和「脚本自己崩了，证据没产出」。这是最危险的一种状态：
容易把一次静默失败读成一次诚实记录的未执行。</p>
<p><strong>根因</strong>：<code>verify-ios-simulator.sh</code> 有 8 处 <code>exit 0</code>、
<code>build-harmony-linux.sh</code> 有 6 处 <code>exit 0</code>。失败结果只存在于 JSON 内容里，
而 JSON 可能压根不存在。</p>
</div>
<p><strong>已实施的修法</strong>：</p>
<ol>
<li><strong>两个脚本各加 EXIT 兜底</strong>（<code>on_exit</code> + <code>trap on_exit EXIT</code>）：
<code>FINAL_RECORDED</code> / <code>EVIDENCE_WRITTEN</code> 标记区分「已写过结论」与「异常中止」；
任何非正常结束补写 <code>status=ERROR</code>，<code>error</code> 明写「这是脚本自身失败，不等于环境不具备」。
trap 装在静态核验<b>之前</b>（那一步自己也会崩）。iOS 脚本原有的独立 EXIT trap（模拟器 shutdown）
并入 <code>on_exit</code>，保证每个脚本只有一个 EXIT trap —— 多个 trap 会互相覆盖，兜底就失效。</li>
<li><strong>新增 <code>mobile/p03-b/scripts/check-evidence-status.py</code></strong>：读证据 JSON 的
<code>status</code> 与期望值比对，不符则 <code>::error::</code> 标红并贴出原因。
文件缺失、JSON 非法、缺 <code>status</code> 字段一律 exit 1。</li>
<li><strong>两个 workflow 各加一步判定</strong>：iOS job 判 <code>RUN</code>，HarmonyOS job 判
<code>COMPILE_OK</code>。判定步骤<b>排在所有上传之后</b>，避免判红时把产物和证据丢掉。</li>
</ol>
<h4>实施中发现的第二个漏洞：<code>if: always()</code> 缺失</h4>
<p>第一次实现只加了判定步骤，验收时用崩溃注入发现：<b>判定步骤自己也会被跳过</b>。
GitHub Actions 默认「上一步失败 → 后续步骤跳过」，于是鸿蒙编译步骤崩溃（exit≠0）→
「上传 HAP」和「判定编译结果」全被跳过 → 产物和刚写出来的 ERROR 证据一起丢失，
等于绕了一圈回到原来的问题。</p>
<p><b>修法</b>：鸿蒙 4 个步骤与 iOS 3 个步骤全部加 <code>if: always()</code>；
两个 workflow 的 <code>if-no-files-found: error</code> 改为 <code>warn</code>；
鸿蒙编译 run 改为 <code>bash ... || echo ::error::</code>；概要步骤读 JSON 改为容错。</p>
<p><b>验收</b>：用 YAML 解析断言每个步骤的 <code>if</code> / <code>continue-on-error</code> /
<code>if-no-files-found</code>，并断言判定步骤排在所有上传之后 —— 12 项断言全绿。</p>
<p><strong>残留边界</strong>：SIGKILL / OOM kill 这类硬终止不会被 shell trap 捕获。
这种情况仍需靠 CI 侧判定步骤发现「证据缺失」来兜 —— 但那一次会明确报「证据文件不存在」，
而不是静默。</p>
<p><strong>验收</strong>：崩溃注入（未定义变量触发 <code>set -u</code> 中止）→ 两个脚本均产出
<code>status=ERROR</code> 且与 NOT_RUN 可区分；正常路径不受影响（Linux 上 iOS 仍 NOT_RUN，
鸿蒙真实编译仍 COMPILE_OK / 50,768 字节 / ERROR 0 / WARN 2）；判定脚本 6 种输入全部符合预期；
端到端为「脚本 exit 0 + 判定 exit 1」，符合设计。</p>

<h3>F4（medium）产物 sha256 被误当作可复现性依据 —— 已修</h3>
<p>已在 <code>docs/mobile/PLAN.md</code> 新增「读 CI 结果的规矩」小节，写明字节数与 sha256 的区别、
必须读 JSON <code>status</code>。</p>

<h3>F5（low）iOS 实跑证据强度 —— 已在文档标注</h3>
<p>截图处于空状态，脚本不做交互。已在 PLAN.md iOS 行显式区分「进程启动已验证」与「功能断言 NOT_RUN」。</p>

<h3>F6（low）鸿蒙 compileSdkVersion 被抬高 —— 已在旧文档标注</h3>
<p><code>compileSdkVersion</code> 由 <code>5.0.0(12)</code> 改为 <code>5.1.0(18)</code>（可用工具链只带 API 18）；
<code>compatibleSdkVersion</code> 保持 <code>5.0.0(12)</code>，设备最低要求未变。
<code>HARMONY-TRACK.md</code> 已如实记录。</p>

<h2>CI 结果读取规矩（已写入 docs/mobile/PLAN.md）</h2>
<div class="warn">
<p><strong>CI 步骤绿色 ≠ 该项实测通过。</strong> 两个校验脚本把结果写进 JSON 后<strong>恒 <code>exit 0</code></strong>
（<code>verify-ios-simulator.sh</code> 8 处、<code>build-harmony-linux.sh</code> 6 处）。
编译失败、证据缺失、环境不具备，在 Actions 页面上都表现为「成功」。判定必须读 JSON 的 <code>status</code>：</p>
</div>
<div class="scroll"><table><thead><tr><th>产物</th><th>字段</th><th>通过值</th><th>其他值</th></tr></thead><tbody>
<tr><td><code>harmony-build.json</code></td><td><code>status</code></td><td><code>COMPILE_OK</code></td><td><code>FAIL</code> / <code>NOT_RUN</code></td></tr>
<tr><td><code>ios-run.json</code></td><td><code>status</code></td><td><code>RUN</code></td><td><code>NOT_RUN</code> / <code>ERROR</code></td></tr>
</tbody></table></div>
<p><strong>产物 sha256 不可用于「源码未变」证明</strong>（APK 与 HAP 都会变），应比逐条目内容摘要。</p>

<h2>本轮没有做的事</h2>
<ul>
<li>没有修改任何业务代码、探针源码、已批准 UI。</li>
<li>没有修改任何旧轮次的报告或证据文件（新建独立报告与独立证据）。</li>
<li>没有触碰 P03-C / P04 —— P03-C 仍需 FA 单独授权。</li>
<li>没有提交、没有推送。改动停留在工作区，等 FA 审阅。</li>
<li>没有对外发布、商店上传、凭据使用。</li>
</ul>

<h2>本轮未声称的事项</h2>
<ul>@@NOT_CLAIMED@@</ul>

<h2>证据与复现</h2>
<div class="scroll"><table><thead><tr><th>文件</th><th>内容</th></tr></thead><tbody>
<tr><td><a href="P03-B1-RECHECK-2026-11-02.md">P03-B1-RECHECK-2026-11-02.md</a></td><td>本轮报告（Markdown 原件）</td></tr>
<tr><td><a href="evidence/recheck-2026-11-02.json">evidence/recheck-2026-11-02.json</a></td><td>机器可读证据（本轮全部观测值）</td></tr>
<tr><td><a href="../PLAN.md">../PLAN.md</a></td><td>状态表与 CI 读取规矩（本轮修改的唯一既有文件）</td></tr>
</tbody></table></div>

<pre># 鸿蒙编译复现（首次需下载 2.15G 工具链；已有则 SKIP_DOWNLOAD=1）
cd mobile/p03-b/harmony
OHOS_CLT_HOME=~/projects/subwise/.local/ohos-clt \\
EVIDENCE_DIR=/tmp/harmony-evidence bash scripts/build-harmony-linux.sh</pre>

<p class="muted">仓库状态：HEAD <code>@@HEAD@@</code>，与 <code>origin/main</code> @@SYNC@@。
本轮仅改 <code>docs/mobile/PLAN.md</code> 一个既有文件（业务代码零改动）。</p>

</main>
<h2>七、三端设备验证路径</h2>
<p>FA 提供了三台可用设备：Android 虚拟机、Mac mini M4、荣耀鸿蒙真机。
服务器是无 KVM 的 Linux（4 核 3.6GB），模拟器会被 OOM killer 杀掉，
不适合长期占用生产机 —— 因此改为<b>交付设备端脚本，由 FA 在自己设备上跑</b>，
产出机器可读证据回来，由本轮统一复核归档。</p>

<h3>服务器侧短暂尝试的真实结果</h3>
<ul>
<li>API 30 模拟器 boot 约 400 秒；<code>sys.boot_completed</code> 始终未置位，
但 shell 与 logcat 都可用 —— <b>判据应是「shell 能响应」，不是等 boot 属性</b>。</li>
<li>首次启动弹出 <b>"System UI isn't responding"</b> ANR 弹窗盖住界面，
导致 <code>uiautomator dump</code> 只返回系统层级，误判成「应用没渲染」。
关掉弹窗后拿到完整 UI 层级，<b>Subwise 界面渲染完全正常</b>
（"SQLite 已打开 · 已读取本地记录"、"本地暂无快照"、"写入模拟数据并从 SQLite 读取" 都在）。</li>
<li>第二次启动 qemu 被 OOM killer 杀掉（可用内存仅 615MB，swap 1.6G/1.9G 打满）。
→ 结论：服务器不是跑模拟器的合适环境。</li>
</ul>

<h3>交付的设备端脚本包</h3>
<table>
<tr><th>文件</th><th>作用</th></tr>
<tr><td><code>device-test/verify-android-device.sh</code></td><td>Android 真机/模拟器验证（adb）</td></tr>
<tr><td><code>device-test/verify-ios-device.sh</code></td><td>iOS 模拟器/真机验证（xcrun simctl）</td></tr>
<tr><td><code>device-test/verify-harmony-device.sh</code></td><td>HarmonyOS 真机验证（hdc）</td></tr>
<tr><td><code>device-test/collect-device-evidence.sh</code></td><td>三端证据汇总器</td></tr>
<tr><td><code>docs/mobile/p03-b1/DEVICE-TEST-GUIDE.md</code></td><td>FA 操作说明（含每端人工确认清单）</td></tr>
</table>

<h3>各端的硬证据（不只是「能启动」）</h3>
<ul>
<li><b>Android</b>：点「写入模拟数据」后 UI 出现卡片 → 点「重新读取本地 SQLite」后卡片仍在
（证明数据真落盘）→ 点「模拟响应损坏」确认旧快照不丢；另测安全存储写/读/删、
HTTPS 无凭据 401、通知调度、logcat 无 FATAL EXCEPTION。</li>
<li><b>iOS</b>：<b>直接读 app 沙盒里的 SQLite</b>，确认 <code>snapshots</code> 表里
deepseek 与 minimax 两个 provider 的行都在 —— iOS 端唯一能证明「写入 → 落盘」的硬证据。</li>
<li><b>HarmonyOS</b>：<b>读 app 沙盒里的 RDB</b>，确认 <code>probe_rows</code> 表里
两个 provider 的行都在；另收 hilog 查 FATAL。</li>
</ul>

<div class="warn">
<p><b>如实标注交互来源</b>：iOS 没有通用 UI dump，脚本按
<code>idb</code> → <code>osascript</code> → 人工 的优先级尝试，用了哪种会写进证据的
<code>interaction.method</code>；人工点击的<b>不会</b>被写成脚本自动化。</p>
<p><b>汇总器拒绝把非 PASS 算成 PASS</b>：<code>PARTIAL</code> / <code>NOT_RUN</code> /
<code>ERROR</code> / <code>FAIL</code> / 缺证据一律判 <code>INCOMPLETE</code>。
<code>PARTIAL</code> 是新增状态 —— 脚本完成了一部分但需人工介入，既不是失败也不是通过。</p>
</div>

<h3>遗留阻塞</h3>
<ul>
<li>HarmonyOS 的 CI HAP 是<b>未签名</b>的，装不上真机 —— 需用 DevEco Studio 配签名重新构建。</li>
<li>通知实际送达 / 安全存储文案 / HTTPS 状态码这三类脚本查不到，
指南里逐端列出了需要肉眼确认的具体条目。</li>
<li>iOS 真机安装需自己的开发者证书，bundle id 建议改掉避免冲突。</li>
</ul>
</body></html>"""

    repl = {
        "@@CSS@@": CSS,
        "@@LR_STATUS@@": esc(h["localRun"]["status"]),
        "@@CR_STATUS@@": esc(h["ciRun"]["status"]),
        "@@LR_ERR@@": esc(h["localRun"]["errors"]),
        "@@LR_WARN@@": esc(h["localRun"]["warnings"]),
        "@@CR_ERR@@": esc(h["ciRun"]["errors"]),
        "@@CR_WARN@@": esc(h["ciRun"]["warnings"]),
        "@@LR_BYTES@@": esc(h["localRun"]["hapBytes"]),
        "@@CR_BYTES@@": esc(h["ciRun"]["hapBytes"]),
        "@@LR_SHA@@": esc(h["localRun"]["hapSha256"]),
        "@@CR_SHA@@": esc(h["ciRun"]["hapSha256"]),
        "@@LR_SIGNED@@": signed_local,
        "@@CR_SIGNED@@": signed_ci,
        "@@ENTRY_NAMES@@": esc(c["entryNamesEqual"]),
        "@@ENTRY_DIGEST@@": esc(c["perEntryContentDigestEqual"]),
        "@@ENTRY_COUNT@@": esc(c["entryCount"]),
        "@@SIG_COUNT@@": esc(c["signatureEntryCount"]),
        "@@APK_ROWS@@": apk_rows,
        "@@LOCAL_APK@@": esc(apk["localX86OnlyApkBytes"]),
        "@@FIGURES@@": figures,
        "@@HARMONY_NOT_RUN@@": not_run,
        "@@IOS_NOT_RUN@@": ios_not_run,
        "@@FINDINGS_ROWS@@": findings_rows,
        "@@NOT_CLAIMED@@": not_claimed,
        "@@HEAD@@": esc(repo["head"][:7]),
        "@@SYNC@@": "一致" if repo["inSync"] else "不一致",
    }
    for k, v in repl.items():
        body = body.replace(k, v)
    leftovers = [tok for tok in repl if tok in body]
    if leftovers:
        sys.exit("占位符未全部替换: %s" % leftovers)
    return body


def main():
    if not os.path.exists(EVID_JSON):
        sys.exit("缺少证据文件: %s" % EVID_JSON)
    with open(EVID_JSON, encoding="utf-8") as f:
        ev = json.load(f)
    html = build(ev)
    with open(OUT_HTML, "w", encoding="utf-8") as f:
        f.write(html)
    print("written: %s (%d bytes)" % (OUT_HTML, len(html.encode("utf-8"))))


if __name__ == "__main__":
    main()
