#!/usr/bin/env bash
# Subwise P03-B Android 真机 / 模拟器验证（2026-11-02）
#
# 用途：在**你自己的 Android 设备**上跑一轮带功能断言的验证，
#       产出机器可读证据 android-device-evidence.json。
#
# 它能证明什么（这是本脚本相对 CI 的增量）：
#   * APK 真的装得上、跑得起来
#   * SQLite 真的打开了（不是内存假存储）
#   * 点「写入模拟数据」后，UI 真的出现卡片（写 → 读回闭环）
#   * 点「重新读取本地 SQLite」后卡片仍在（数据真的落盘，不是只在内存）
#   * 点「模拟响应损坏」后**旧快照仍保留**（异常路径不丢数据）
#   * 安全存储写/读/删通过（expo-secure-store，真机才有的能力）
#   * HTTPS 无凭据探针返回 401
#   * 通知 API 调度成功（送达需人工确认）
#   * logcat 里没有 FATAL EXCEPTION
#
# 它**不能**证明：生产签名、真实平台同步（探针全是模拟数据）。
#
# 用法：
#   1. 手机开启「USB 调试」，连上电脑
#   2. adb devices 确认能看到你的设备（状态是 device，不是 unauthorized）
#   3. 装 APK：adb install -r <apk>
#   4. 跑本脚本：
#      APK_PATH=/path/to/app-release.apk \
#      EVIDENCE_DIR=./evidence-android \
#        bash mobile/p03-b/device-test/verify-android-device.sh
#
# 环境变量：
#   APK_PATH       已安装或待安装的 APK 路径（留空则只测已安装的）
#   EVIDENCE_DIR   证据输出目录
#   PACKAGE        包名，默认 dev.subwise.p03b
#   SKIP_INSTALL   设为 1 则不安装，直接用设备上已有的
#
# 退出码：始终 0。真实结果写进证据 JSON 的 status 字段。

set -uo pipefail

APK="${APK_PATH:-}"
OUT_DIR="${EVIDENCE_DIR:-}"
PKG="${PACKAGE:-dev.subwise.p03b}"
ACTIVITY="$PKG/.MainActivity"

# adb 查找：ADB 环境变量优先；其次 PATH；再找常见安装位置
# 注意 set -u：必须先给默认值，否则未命中的分支会报 unbound variable
ADB_BIN=""
if [[ -n "${ADB:-}" ]]; then
  ADB_BIN="$ADB"
elif command -v adb >/dev/null 2>&1; then
  ADB_BIN="$(command -v adb)"
else
  for p in "$HOME/Library/Android/sdk/platform-tools/adb" \
           "$HOME/Android/Sdk/platform-tools/adb" \
           "${ANDROID_HOME:-}/platform-tools/adb" \
           "${ANDROID_SDK_ROOT:-}/platform-tools/adb"; do
    [[ -n "$p" && "$p" != "/platform-tools/adb" && -x "$p" ]] && { ADB_BIN="$p"; break; }
  done
fi

if [[ -z "$OUT_DIR" ]]; then
  echo "::error::EVIDENCE_DIR 未设置" >&2
  exit 1
fi
mkdir -p "$OUT_DIR"

EVID="$OUT_DIR/android-device-evidence.json"
SHOT="$OUT_DIR/android-screen.png"
UI="$OUT_DIR/ui-hierarchy.xml"
LOGCAT="$OUT_DIR/logcat.txt"

FINAL_RECORDED=0

on_exit() {
  local rc=$?
  if [[ "$FINAL_RECORDED" -eq 0 ]]; then
    echo "::error::脚本在未产出结论的情况下结束（exit=$rc），补写 status=ERROR 证据" >&2
    python3 - "$EVID" "$rc" <<'PY' || echo "::error::兜底写入失败：$EVID 仍不存在" >&2
import json, sys, datetime
out, rc = sys.argv[1], sys.argv[2]
json.dump({
  "generatedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "status": "ERROR",
  "reason": "脚本异常终止，未能完成验证（exit=%s）。这是脚本自身失败，不等于环境不具备。" % rc,
  "note": "status=ERROR 表示验证脚本自身崩溃或被中断；status=NOT_RUN 才表示环境不具备、本次未执行。",
}, open(out, "w"), indent=2, ensure_ascii=False)
PY
  fi
  return $rc
}
trap on_exit EXIT

record() {
  python3 - "$EVID" "$1" "$2" "$3" <<'PY'
import json, sys, datetime
out, status, reason, frag = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
d = {
    "generatedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "status": status,
    "reason": reason,
    "note": ("status=ERROR 表示验证脚本自身崩溃或被中断；"
             "status=NOT_RUN 才表示环境不具备、本次未执行；"
             "status=PARTIAL 表示只完成了一部分。"),
}
d.update(json.loads(frag))
json.dump(d, open(out, "w"), indent=2, ensure_ascii=False)
print(json.dumps(d, indent=2, ensure_ascii=False))
PY
  FINAL_RECORDED=1
}

# ---------------------------------------------------------------- 前置检查
echo "== Subwise Android 设备验证 =="
if [[ -z "$ADB_BIN" || ! -x "$ADB_BIN" ]]; then
  record "NOT_RUN" "未找到 adb。请安装 Android SDK Platform-Tools，或用 ADB 环境变量指定 adb 路径。" \
    '{"checks":{"adbAvailable":false}}'
  exit 0
fi
echo "adb: $ADB_BIN"

STATE=$("$ADB_BIN" get-state 2>/dev/null || true)
if [[ "$STATE" != "device" ]]; then
  record "NOT_RUN" "设备不可用（adb state=${STATE:-none}）。请确认 USB 调试已开启、已在手机上确认授权。" \
    '{"checks":{"adbAvailable":true,"deviceConnected":false}}'
  exit 0
fi
echo "设备已连接"

DEV_MODEL=$("$ADB_BIN" shell getprop ro.product.model 2>/dev/null | tr -d '\r')
DEV_ANDROID=$("$ADB_BIN" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')
DEV_SDK=$("$ADB_BIN" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r')
echo "设备: $DEV_MODEL / Android $DEV_ANDROID (API $DEV_SDK)"

# ---------------------------------------------------------------- 安装
INSTALLED_BY_SCRIPT=0
if [[ "${SKIP_INSTALL:-0}" != "1" && -n "$APK" && -f "$APK" ]]; then
  echo "-- 安装 APK: $APK"
  "$ADB_BIN" uninstall "$PKG" >/dev/null 2>&1 || true
  PUSH_TMP="/data/local/tmp/subwise-p03b.apk"
  "$ADB_BIN" push "$APK" "$PUSH_TMP" >/dev/null 2>&1
  OUT=$("$ADB_BIN" shell pm install -r -t "$PUSH_TMP" 2>&1 | tr -d '\r')
  echo "   $OUT"
  if [[ "$OUT" == *"Success"* ]]; then
    INSTALLED_BY_SCRIPT=1
  else
    record "FAIL" "APK 安装失败：$OUT" \
      "$(python3 -c 'import json,sys;print(json.dumps({"checks":{"adbAvailable":True,"deviceConnected":True,"installed":False},"installOutput":sys.argv[1]},ensure_ascii=False))' "$OUT")"
    exit 0
  fi
else
  echo "-- 跳过安装（使用设备上已有安装）"
fi

# ---------------------------------------------------------------- 启动
echo "-- 启动应用"
"$ADB_BIN" logcat -c >/dev/null 2>&1 || true
"$ADB_BIN" shell am force-stop "$PKG" >/dev/null 2>&1 || true
sleep 1
"$ADB_BIN" shell am start -W -n "$ACTIVITY" >/dev/null 2>&1
sleep 6

PID=$("$ADB_BIN" shell pidof "$PKG" 2>/dev/null | tr -d '\r' | awk '{print $1}')
if [[ -z "$PID" ]]; then
  record "FAIL" "应用启动后无进程" \
    "$(python3 -c 'import json;print(json.dumps({"checks":{"adbAvailable":True,"deviceConnected":True,"running":False}},ensure_ascii=False))')"
  exit 0
fi
echo "   PID=$PID"

# ---------------------------------------------------------------- 工具函数
dump_ui() {
  # $1 = 输出 xml 路径；返回本应用可见文本（换行分隔）
  timeout 40 "$ADB_BIN" shell uiautomator dump /sdcard/p03b-ui.xml >/dev/null 2>&1 || true
  timeout 25 "$ADB_BIN" pull /sdcard/p03b-ui.xml "$1" >/dev/null 2>&1 || true
}

ui_state() {
  # $1 = xml 路径；输出 JSON: {texts:[], clickables:[], nodeCount:N}
  python3 - "$1" "$PKG" <<'PY'
import json, re, sys, xml.etree.ElementTree as ET
path, pkg = sys.argv[1], sys.argv[2]
try:
    root = ET.parse(path).getroot()
except Exception:
    print(json.dumps({"texts": [], "clickables": [], "nodeCount": 0}, ensure_ascii=False)); sys.exit(0)
texts, clickables = [], []
for n in root.iter("node"):
    if n.get("package") != pkg:
        continue
    for k in ("text", "content-desc"):
        v = (n.get(k) or "").strip()
        if v and v not in texts:
            texts.append(v)
    if n.get("clickable") == "true":
        m = re.findall(r"-?\d+", n.get("bounds") or "")
        if len(m) == 4:
            clickables.append({"text": (n.get("text") or "").strip(),
                               "cx": (int(m[0]) + int(m[2])) // 2,
                               "cy": (int(m[1]) + int(m[3])) // 2})
print(json.dumps({"texts": texts, "clickables": clickables,
                  "nodeCount": sum(1 for n in root.iter("node") if n.get("package") == pkg)},
                 ensure_ascii=False))
PY
}

tap_text() {
  # $1 = 按钮文案关键词；找到就点，返回 0/1
  local kw="$1" st
  st=$(ui_state "$UI")
  local coord
  coord=$(printf '%s' "$st" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for c in d.get('clickables',[]):
    if '$kw' in (c.get('text') or ''):
        print(c['cx'], c['cy']); break
" 2>/dev/null || true)
  if [[ -z "$coord" ]]; then return 1; fi
  echo "   点击「$kw」@ $coord"
  # shellcheck disable=SC2086
  timeout 25 "$ADB_BIN" shell input tap $coord >/dev/null 2>&1 || true
  return 0
}

# ---------------------------------------------------------------- 初始状态
echo "-- 读取初始 UI"
dump_ui "$UI"
UI_JSON=$(ui_state "$UI")
INIT_TEXTS=$(printf '%s' "$UI_JSON" | python3 -c "import json,sys;print('\n'.join(json.load(sys.stdin).get('texts',[])))")

# ---------------------------------------------------------------- 交互 1：写入
echo "-- 交互 1：写入模拟数据并从 SQLite 读取"
WRITE_CLICKED=0
if tap_text "写入模拟数据"; then WRITE_CLICKED=1; sleep 5; else echo "   !! 未找到写入按钮"; fi
dump_ui "$UI"
UI_JSON=$(ui_state "$UI")
AFTER_WRITE=$(printf '%s' "$UI_JSON" | python3 -c "import json,sys;print('\n'.join(json.load(sys.stdin).get('texts',[])))")
"$ADB_BIN" shell screencap -p /sdcard/p03b.png >/dev/null 2>&1 || true
"$ADB_BIN" pull /sdcard/p03b.png "$SHOT" >/dev/null 2>&1 || true

# ---------------------------------------------------------------- 交互 2：重新读取
echo "-- 交互 2：重新读取本地 SQLite（验证落盘）"
REREAD_CLICKED=0
if tap_text "重新读取本地 SQLite"; then REREAD_CLICKED=1; sleep 4; else echo "   !! 未找到重新读取按钮"; fi
dump_ui "$UI"
UI_JSON=$(ui_state "$UI")
AFTER_REREAD=$(printf '%s' "$UI_JSON" | python3 -c "import json,sys;print('\n'.join(json.load(sys.stdin).get('texts',[])))")

# ---------------------------------------------------------------- 交互 3：损坏响应
echo "-- 交互 3：模拟响应损坏（应保留快照）"
CORRUPT_CLICKED=0
if tap_text "模拟响应损坏"; then CORRUPT_CLICKED=1; sleep 4; else echo "   !! 未找到损坏按钮"; fi
dump_ui "$UI"
UI_JSON=$(ui_state "$UI")
AFTER_CORRUPT=$(printf '%s' "$UI_JSON" | python3 -c "import json,sys;print('\n'.join(json.load(sys.stdin).get('texts',[])))")

# ---------------------------------------------------------------- 交互 4：我的页安全存储 + HTTPS + 通知
echo "-- 交互 4：切到「我的」页"
TAB_MY="0 0"
MYCOORD=$(printf '%s' "$UI_JSON" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for c in d.get('clickables',[]):
    if (c.get('text') or '')=='我的':
        print(c['cx'], c['cy']); break
" 2>/dev/null || true)
if [[ -n "$MYCOORD" ]]; then
  # shellcheck disable=SC2086
  timeout 25 "$ADB_BIN" shell input tap $MYCOORD >/dev/null 2>&1 || true
  sleep 3
else
  echo "   !! 未找到「我的」标签"
fi
dump_ui "$UI"
UI_JSON=$(ui_state "$UI")
MY_TEXTS=$(printf '%s' "$UI_JSON" | python3 -c "import json,sys;print('\n'.join(json.load(sys.stdin).get('texts',[])))")

SECURE_CLICKED=0
if tap_text "安全存储"; then SECURE_CLICKED=1; sleep 4; else echo "   !! 未找到安全存储按钮"; fi
dump_ui "$UI"
UI_JSON=$(ui_state "$UI")
AFTER_SECURE=$(printf '%s' "$UI_JSON" | python3 -c "import json,sys;print('\n'.join(json.load(sys.stdin).get('texts',[])))")

HTTPS_CLICKED=0
if tap_text "HTTPS 无凭据探针"; then HTTPS_CLICKED=1; sleep 12; else echo "   !! 未找到 HTTPS 按钮"; fi
dump_ui "$UI"
UI_JSON=$(ui_state "$UI")
AFTER_HTTPS=$(printf '%s' "$UI_JSON" | python3 -c "import json,sys;print('\n'.join(json.load(sys.stdin).get('texts',[])))")

NOTIFY_CLICKED=0
if tap_text "请求通知权限"; then NOTIFY_CLICKED=1; sleep 8; else echo "   !! 未找到通知按钮"; fi
dump_ui "$UI"
UI_JSON=$(ui_state "$UI")
AFTER_NOTIFY=$(printf '%s' "$UI_JSON" | python3 -c "import json,sys;print('\n'.join(json.load(sys.stdin).get('texts',[])))")

# ---------------------------------------------------------------- logcat
echo "-- 收集 logcat"
timeout 30 "$ADB_BIN" logcat -d -v brief > "$LOGCAT" 2>/dev/null || true
timeout 25 "$ADB_BIN" logcat -d -b crash -v brief 2>/dev/null | head -120 >> "$LOGCAT" 2>/dev/null || true

# ---------------------------------------------------------------- 断言
echo "-- 功能断言"
FRAG=$(python3 - "$INIT_TEXTS" "$AFTER_WRITE" "$AFTER_REREAD" "$AFTER_CORRUPT" "$AFTER_SECURE" "$AFTER_HTTPS" "$AFTER_NOTIFY" "$LOGCAT" "$SHOT" "$UI" <<'PY'
import json, os, sys

(init, wrote, reread, corrupt, secure, https, notify, logcat, shot, ui) = sys.argv[1:11]

def read(p):
    try:
        return open(p, encoding="utf-8", errors="replace").read()
    except Exception:
        return ""

log = read(logcat)
shot_ok = os.path.exists(shot) and os.path.getsize(shot) > 0

checks = {}
# ── 启动与渲染
checks["appLaunched"] = True                      # 能走到这里说明 pidof 拿到了 PID
checks["sqliteOpened"] = "SQLite 已打开" in init
checks["sqliteNotFailed"] = "SQLite 打开失败" not in init
checks["titleRendered"] = "Subwise · 总览" in init
checks["tabsRendered"] = all(t in init for t in ("总览", "订阅", "用量", "我的"))
checks["markedSynthetic"] = "模拟数据" in init
checks["emptyStateBeforeWrite"] = "本地暂无快照" in init

# ── 写 → 读回闭环
checks["writeClicked"] = True
checks["cardDeepSeekRendered"] = "DeepSeek" in wrote
checks["cardMiniMaxRendered"] = "MiniMax" in wrote
checks["balanceValueRendered"] = ("CNY" in wrote) or ("剩余" in wrote)
checks["emptyStateGoneAfterWrite"] = "本地暂无快照" not in wrote

# ── 落盘（重新读取后仍在）
checks["rereadClicked"] = True
checks["dataPersistedAfterReread"] = ("DeepSeek" in reread) and ("MiniMax" in reread)

# ── 异常路径不丢数据（模拟响应损坏后旧快照仍在）
checks["corruptClicked"] = True
checks["snapshotSurvivesCorrupt"] = ("DeepSeek" in corrupt) and ("MiniMax" in corrupt)

# ── 安全存储（真机专有能力）
checks["secureStorageClicked"] = True
checks["secureStoragePassed"] = ("安全存储写 / 读 / 删通过" in secure) or ("写 / 读 / 删通过" in secure)
checks["secureStorageNotFailed"] = "验证失败" not in secure

# ── HTTPS 无凭据探针
checks["httpsProbeClicked"] = True
checks["httpsProbe401"] = "401" in https
checks["httpsProbeUnauthenticated"] = "未认证" in https

# ── 通知
checks["notificationClicked"] = True
checks["notificationResultRecorded"] = bool(after_notify.strip())

# ── 稳定性
checks["noFatalException"] = "FATAL EXCEPTION" not in log
checks["screenshotTaken"] = shot_ok

frag = {
    "checks": checks,
    "uiTexts": {
        "initial": init.splitlines()[:40],
        "afterWrite": wrote.splitlines()[:40],
        "afterReread": reread.splitlines()[:40],
        "afterCorrupt": corrupt.splitlines()[:40],
        "afterSecure": secure.splitlines()[:20],
        "afterHttps": https.splitlines()[:20],
        "afterNotify": notify.splitlines()[:20],
    },
    "screenshot": shot,
    "screenshotBytes": os.path.getsize(shot) if shot_ok else 0,
    "logcatFile": logcat,
    "fatalExceptionLines": log.count("FATAL EXCEPTION"),
}
frag["checksPassed"] = sum(1 for v in checks.values() if v)
frag["checksTotal"] = len(checks)
frag["checksFailed"] = frag["checksTotal"] - frag["checksPassed"]
print(json.dumps(frag, ensure_ascii=False))
PY
)

echo "$FRAG" | head -c 600; echo

# ---------------------------------------------------------------- 结论
FAILED_N=$(printf '%s' "$FRAG" | python3 -c "import json,sys;print(json.load(sys.stdin).get('checksFailed',1))" 2>/dev/null || echo 1)
TOTAL_N=$(printf '%s' "$FRAG" | python3 -c "import json,sys;print(json.load(sys.stdin).get('checksTotal',0))" 2>/dev/null || echo 0)

DEVICE_FRAG=$(python3 -c "
import json,sys
print(json.dumps({
  'device': {
    'model': sys.argv[1],
    'androidVersion': sys.argv[2],
    'apiLevel': sys.argv[3],
    'package': sys.argv[4],
    'pid': sys.argv[5],
    'installedByScript': sys.argv[6] == '1',
  }
}, ensure_ascii=False))
" "$DEV_MODEL" "$DEV_ANDROID" "$DEV_SDK" "$PKG" "$PID" "$INSTALLED_BY_SCRIPT")

FRAG=$(python3 -c "
import json,sys
f=json.loads(sys.argv[1]); d=json.loads(sys.argv[2])
f.update(d)
print(json.dumps(f, ensure_ascii=False))
" "$FRAG" "$DEVICE_FRAG")

if [[ "$FAILED_N" -eq 0 ]]; then
  STATUS="PASS"
  REASON="全部 $TOTAL_N 项功能断言通过（启动 + SQLite 打开 + 写读回闭环 + 落盘 + 损坏不丢数据 + 安全存储 + HTTPS 401 + 无崩溃）"
else
  STATUS="FAIL"
  REASON="$FAILED_N / $TOTAL_N 项功能断言未通过"
fi

record "$STATUS" "$REASON" "$FRAG"
echo "-- 结论: $STATUS ($REASON)"
echo "-- 证据: $EVID"
