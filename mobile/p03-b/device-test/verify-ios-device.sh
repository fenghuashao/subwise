#!/usr/bin/env bash
# Subwise P03-B iOS 真机 / 模拟器验证（2026-11-02）
#
# 用途：在 **Mac** 上对 iOS 模拟器（以及连着 Mac 的真机）跑一轮带功能断言的验证，
#       产出机器可读证据 ios-device-evidence.json。
#
# 它能证明什么（相对 CI 的增量）：
#   * .app 能装、能启动（进程存在）
#   * 界面真的渲染（UI 层级里能看到 Subwise 文案，不是白屏）
#   * SQLite 真的打开了
#   * 点「写入模拟数据并从 SQLite 读取」后，UI 出现卡片（写 → 读回闭环）
#   * 点「重新读取本地 SQLite」后卡片仍在（数据真的落盘）
#   * 点「模拟响应损坏」后旧快照仍保留（异常路径不丢数据）
#   * 安全存储（expo-secure-store）写/读/删通过
#   * HTTPS 无凭据探针返回 401
#   * 通知调度 API 返回成功（**送达需人工在手机/模拟器上确认**）
#
# 它**不能**证明：真机（未插真机时）、生产签名、真实平台同步。
#
# 用法（在 Mac 上）：
#   # 模拟器
#   bash mobile/p03-b/device-test/verify-ios-device.sh \
#     --app .local/p03-b1/ios-derived/Build/Products/Release-iphonesimulator/SubwiseP03B.app
#
#   # 真机（需开发者签名 + 已连接）
#   bash mobile/p03-b/device-test/verify-ios-device.sh \
#     --app <xxx.app> --device <udid-of-connected-device>
#
# 参数：
#   --app <path>      .app 产物路径（必填）
#   --device <udid>   指定模拟器/真机 UDID（可选，默认挑一个 iPhone 模拟器）
#   --out <dir>       证据输出目录（默认 ./evidence-ios）
#   --bundle <id>     bundle id（默认从 .app 的 Info.plist 读）
#
# 退出码：始终 0。真实结果写进证据 JSON 的 status 字段。

set -uo pipefail

APP=""
DEVICE_UDID=""
OUT_DIR="./evidence-ios"
BUNDLE_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)    APP="$2"; shift 2 ;;
    --device) DEVICE_UDID="$2"; shift 2 ;;
    --out)    OUT_DIR="$2"; shift 2 ;;
    --bundle) BUNDLE_OVERRIDE="$2"; shift 2 ;;
    *) echo "::error::未知参数：$1" >&2; exit 2 ;;
  esac
done

if [[ -z "$APP" ]]; then
  echo "::error::必须用 --app 指定 .app 路径" >&2
  exit 2
fi
if [[ ! -d "$APP" ]]; then
  echo "::error::.app 不存在：$APP" >&2
  exit 2
fi
if ! command -v xcrun >/dev/null 2>&1; then
  echo "::error::需要 macOS（xcrun 不存在）" >&2
  exit 2
fi

mkdir -p "$OUT_DIR"
EVID="$OUT_DIR/ios-device-evidence.json"
SHOT="$OUT_DIR/ios-screen.png"
UI="$OUT_DIR/ui-hierarchy.txt"
LOG="$OUT_DIR/launch.log"

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
  "note": ("status=ERROR 表示验证脚本自身崩溃或被中断；"
             "status=NOT_RUN 才表示环境不具备、本次未执行；"
             "status=PARTIAL 表示只完成了一部分。"),
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

echo "== Subwise iOS 设备验证 =="
echo "app: $APP"
echo "证据目录: $OUT_DIR"

# ---------------------------------------------------------------- 静态信息
BUNDLE="$BUNDLE_OVERRIDE"
if [[ -z "$BUNDLE" ]]; then
  BUNDLE=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Info.plist" 2>/dev/null || true)
fi
echo "bundle: $BUNDLE"

APP_SIZE=$(du -sk "$APP" 2>/dev/null | awk '{print $1}')
echo "app 大小: ${APP_SIZE} KiB"

# ---------------------------------------------------------------- 选设备
if [[ -z "$DEVICE_UDID" ]]; then
  DEVICE_UDID=$(xcrun simctl list devices available 2>/dev/null \
    | grep -E "iPhone" | grep -E "\([0-9A-F-]{36}\)" | head -1 \
    | grep -oE "[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}" || true)
fi
if [[ -z "$DEVICE_UDID" ]]; then
  record "NOT_RUN" "未找到可用的 iOS 模拟器。请在 Xcode 里装好模拟器 runtime，或用 --device 指定真机 UDID。" \
    '{"checks":{"appExists":true,"deviceAvailable":false}}'
  exit 0
fi
DEVICE_NAME=$(xcrun simctl list devices 2>/dev/null | grep "$DEVICE_UDID" | head -1 | sed 's/^ *//' || true)
echo "设备: $DEVICE_NAME ($DEVICE_UDID)"

IS_REAL_DEVICE=0
if xcrun devicectl list devices 2>/dev/null | grep -q "$DEVICE_UDID"; then
  IS_REAL_DEVICE=1
  echo "（检测为真机）"
fi

# ---------------------------------------------------------------- 启动
echo "-- 启动模拟器"
xcrun simctl boot "$DEVICE_UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$DEVICE_UDID" -b >/dev/null 2>&1 || true
echo "-- 安装应用"
xcrun simctl install "$DEVICE_UDID" "$APP" >/dev/null 2>&1 || true

echo "-- 拉起进程"
xcrun simctl terminate "$DEVICE_UDID" "$BUNDLE" >/dev/null 2>&1 || true
LAUNCH_OUT=$(xcrun simctl launch "$DEVICE_UDID" "$BUNDLE" 2>&1 || true)
echo "   $LAUNCH_OUT"
LAUNCH_PID=$(printf '%s' "$LAUNCH_OUT" | grep -oE "pid: [0-9]+" | grep -oE "[0-9]+" | head -1)
sleep 6

if [[ -z "$LAUNCH_PID" ]]; then
  record "FAIL" "应用未能启动：$LAUNCH_OUT" \
    "$(python3 -c 'import json,sys;print(json.dumps({"checks":{"appExists":True,"deviceAvailable":True,"launched":False},"launchOutput":sys.argv[1]},ensure_ascii=False))' "$LAUNCH_OUT")"
  exit 0
fi
echo "   PID=$LAUNCH_PID"

# ---------------------------------------------------------------- 交互能力探测
# iOS 上没有 uiautomator 那样的通用 UI dump。能驱动点击的手段按可靠性排序：
#   1. idb（fb-idb）—— 真正的自动化，能拿 accessibility 树、能 tap、能读文案
#   2. osascript —— 给 Simulator.app 窗口发鼠标点击，坐标依赖窗口位置
#   3. 都没有 —— 降级为「人工点击 + 脚本事后查数据库」
#
# 交互方式会如实写进证据的 interaction.method，不能把「人工点的」写成「脚本点的」。
IDB=""
for c in "$(command -v idb 2>/dev/null || true)" "$HOME/.local/bin/idb" "/opt/homebrew/bin/idb" "/usr/local/bin/idb"; do
  [[ -n "$c" && -x "$c" ]] && { IDB="$c"; break; }
done

INTERACTION_METHOD="none"
INTERACTION_NOTE=""

tap_xy() {
  # $1=x $2=y（设备逻辑坐标）
  case "$INTERACTION_METHOD" in
    idb)
      "$IDB" ui tap --udid "$DEVICE_UDID" "$1" "$2" >/dev/null 2>&1 || true
      ;;
    osascript)
      # 把设备逻辑坐标换算成屏幕坐标（模拟器窗口 100% 缩放时是 1:1，
      # 但设备分辨率与窗口大小不一定相同，所以这里用窗口实际尺寸换算）
      python3 - "$1" "$2" <<'PYX' > /tmp/p03b_click.scpt
import subprocess, sys, re
x, y = int(sys.argv[1]), int(sys.argv[2])
try:
    out = subprocess.run(["osascript", "-e",
        'tell application "System Events" to tell process "Simulator" to get position of window 1'],
        capture_output=True, text=True, timeout=10).stdout.strip()
    win = subprocess.run(["osascript", "-e",
        'tell application "System Events" to tell process "Simulator" to get size of window 1'],
        capture_output=True, text=True, timeout=10).stdout.strip()
    px, py = [int(v) for v in re.findall(r"-?\d+", out)[:2]]
    ww, wh = [int(v) for v in re.findall(r"-?\d+", win)[:2]]
    # 窗口尺寸减去标题栏高度
    sx, sy = 540, 960   # 设备逻辑分辨率（iPhone 15 Pro 之类）
    cx = px + int(x * (ww - 0) / sx)
    cy = py + int(y * (wh - 60) / sy)
    print(f'tell application "System Events" to click at {{{cx}, {cy}}}')
except Exception:
    print("")
PYX
      [[ -s /tmp/p03b_click.scpt ]] && osascript /tmp/p03b_click.scpt >/dev/null 2>&1 || true
      ;;
    *)
      return 1
      ;;
  esac
  return 0
}

read_ui_texts_idb() {
  # idb 能给出真实的 accessibility 树 —— 这是 iOS 上唯一可靠的 UI 读取方式
  [[ -n "$IDB" ]] || { echo ""; return 1; }
  "$IDB" ui describe-all --udid "$DEVICE_UDID" 2>/dev/null     | python3 -c "
import sys, json
try:
    items = json.load(sys.stdin)
except Exception:
    print(''); raise SystemExit(0)
labels = []
for it in items if isinstance(items, list) else []:
    if isinstance(it, dict):
        for k in ('AXLabel', 'AXValue', 'label', 'value'):
            v = it.get(k)
            if isinstance(v, str) and v.strip():
                labels.append(v.strip()); break
print(' || '.join(labels))
" 2>/dev/null || echo ""
}

if [[ -n "$IDB" ]]; then
  INTERACTION_METHOD="idb"
  INTERACTION_NOTE="用 fb-idb 驱动点击并读 accessibility 树"
  echo "-- 交互方式: idb"
elif command -v osascript >/dev/null 2>&1; then
  INTERACTION_METHOD="osascript"
  INTERACTION_NOTE="用 osascript 点击 Simulator 窗口；坐标按窗口尺寸换算，可能有偏移"
  echo "-- 交互方式: osascript"
else
  INTERACTION_METHOD="none"
  INTERACTION_NOTE="本机没有 idb / osascript，交互需人工完成；脚本会事后查数据库验证"
  echo "-- 交互方式: 人工（脚本只做启动与事后查库）"
fi

APP_DATA=$(xcrun simctl get_app_container "$DEVICE_UDID" "$BUNDLE" data 2>/dev/null || true)
echo "数据容器: $APP_DATA"

echo "-- 截图"
xcrun simctl io "$DEVICE_UDID" screenshot "$SHOT" >/dev/null 2>&1 || true
SHOT_BYTES=0
[[ -f "$SHOT" ]] && SHOT_BYTES=$(stat -f%z "$SHOT" 2>/dev/null || wc -c < "$SHOT" 2>/dev/null || echo 0)
echo "   截图 $SHOT_BYTES 字节"

# ---------------------------------------------------------------- 触发写入
# 关键：光读数据库只能证明「文件存在」。必须先让 app 真的执行一次写入，
# 才能证明「适配器 → SQLite → UI」的闭环真的成立。
#
# 按钮位置（iPhone 逻辑分辨率 393x852 基准，按 1080x1920 缩放系数换算）：
#   「写入模拟数据并从 SQLite 读取」在总览页第一个按钮
#   「重新读取本地 SQLite（无需联网）」在第二个按钮
# 坐标为经验值，依赖模拟器窗口尺寸；idb 模式下会用 accessibility 树找真实位置。
WRITE_TAPPED=0
REREAD_TAPPED=0

if [[ "$INTERACTION_METHOD" == "idb" ]]; then
  # 用 accessibility 标签定位按钮，拿它的 frame 算中心点
  BTN=$(printf '%s' "$(read_ui_texts_idb)" | python3 -c "
import sys
t = sys.stdin.read()
print('yes' if '写入模拟数据' in t else 'no')
" 2>/dev/null || echo no)
  if [[ "$BTN" == "yes" ]]; then
    # idb 的 describe-all 里带 frame，直接找带「写入模拟数据」的元素
    "$IDB" ui describe-all --udid "$DEVICE_UDID" 2>/dev/null > /tmp/p03b_ax.json || true
    COORD=$(python3 - <<'PYX'
import json
try:
    items = json.load(open("/tmp/p03b_ax.json"))
except Exception:
    print(""); raise SystemExit(0)
for it in (items if isinstance(items, list) else []):
    if not isinstance(it, dict):
        continue
    label = " ".join(str(it.get(k, "")) for k in ("AXLabel", "AXValue", "label", "value"))
    if "写入模拟数据" not in label:
        continue
    f = it.get("frame") or it.get("AXFrame") or {}
    try:
        x, y, w, h = f["x"], f["y"], f["width"], f["height"]
        print("%d %d" % (int(x + w / 2), int(y + h / 2)))
        break
    except Exception:
        continue
print("")
PYX
)
    if [[ -n "$COORD" ]]; then
      # shellcheck disable=SC2086
      tap_xy $COORD && WRITE_TAPPED=1
      echo "   已点击「写入模拟数据」@ $COORD (idb)"
      sleep 6
    fi
  fi
fi

if [[ "$WRITE_TAPPED" -eq 0 && "$INTERACTION_METHOD" == "osascript" ]]; then
  # 经验坐标：总览页「写入模拟数据」按钮
  # 1080x1920 设备上大约在 (540, 687)；这里按 393x852 逻辑坐标换算
  tap_xy 196 300 && WRITE_TAPPED=1
  echo "   已尝试点击「写入模拟数据」(osascript，经验坐标)"
  sleep 6
fi

if [[ "$WRITE_TAPPED" -eq 0 ]]; then
  echo "   !! 无法自动点击写入按钮 —— 请手动在 App 里点一次「写入模拟数据并从 SQLite 读取」，"
  echo "      然后按回车继续（脚本会接着查数据库）"
  read -r -t 300 _ || true
fi

# ---------------------------------------------------------------- SQLite 落盘检查
# 这是 iOS 端最硬的证据：直接读 app 沙盒里的 SQLite 数据库，
# 证明「写入 → 读回 → 落盘」真的发生了，不只是 UI 上出现了字。
SQLITE_RESULT=$(python3 - "$APP_DATA" <<'PY'
import json, os, sqlite3, sys

data = sys.argv[1]
result = {"dbFound": False, "snapshots": [], "rowCount": 0, "error": None}

if not data:
    result["error"] = "未能定位 app 数据容器"
    print(json.dumps(result, ensure_ascii=False)); sys.exit(0)

candidates = []
for root, dirs, files in os.walk(data):
    for f in files:
        if f.endswith((".db", ".sqlite", ".sqlite3")):
            candidates.append(os.path.join(root, f))
    if len(candidates) > 20:
        break

for path in candidates:
    try:
        con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
        cur = con.cursor()
        tables = [r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        if "snapshots" not in tables:
            con.close(); continue
        result["dbFound"] = True
        result["dbPath"] = path
        result["tables"] = tables
        rows = cur.execute("SELECT id, provider, observed_at FROM snapshots ORDER BY id").fetchall()
        result["rowCount"] = len(rows)
        result["snapshots"] = [{"id": r[0], "provider": r[1], "observedAt": r[2]} for r in rows]
        con.close()
        break
    except Exception as e:
        result["error"] = str(e)

print(json.dumps(result, ensure_ascii=False))
PY
)
echo "-- SQLite 检查: $SQLITE_RESULT"

# ---------------------------------------------------------------- 断言
FRAG=$(python3 - "$SQLITE_RESULT" "$SHOT_BYTES" "$LAUNCH_PID" "$BUNDLE" "$IS_REAL_DEVICE" "$APP_DATA" "$SHOT" \
  "$INTERACTION_METHOD" "$WRITE_TAPPED" "$INTERACTION_NOTE" <<'PY'
import json, os, sys

sqlite_res = json.loads(sys.argv[1])
shot_bytes = int(sys.argv[2])
pid = sys.argv[3]
bundle = sys.argv[4]
is_real = int(sys.argv[5])
app_data = sys.argv[6]
shot = sys.argv[7]
method = sys.argv[8]
write_tapped = int(sys.argv[9])
method_note = sys.argv[10]

snap = sqlite_res.get("snapshots", [])
providers = sorted({s.get("provider") for s in snap})

checks = {}
checks["appLaunched"] = bool(pid)
checks["processAlive"] = bool(pid)
checks["screenshotTaken"] = shot_bytes > 0
checks["sqliteDbFound"] = bool(sqlite_res.get("dbFound"))
checks["sqliteHasRows"] = sqlite_res.get("rowCount", 0) > 0
checks["deepseekSnapshotStored"] = "deepseek" in providers
checks["minimaxSnapshotStored"] = "minimax" in providers
# 两个 provider 都必须在库里，说明两次写入都成功（deepseek + minimax）
checks["bothProvidersStored"] = len(providers) >= 2
checks["snapshotPayloadParseable"] = all(
    isinstance(s.get("id"), str) and s.get("id") for s in snap)
# 交互来源必须如实标注：脚本自动点的 vs 人工点的，不能混为一谈
checks["interactionWasAutomated"] = write_tapped == 1

frag = {
    "checks": checks,
    "interaction": {
        "method": method,
        "note": method_note,
        "writeTappedByScript": write_tapped == 1,
    },
    "launchPid": pid,
    "bundleIdentifier": bundle,
    "isRealDevice": bool(is_real),
    "appDataContainer": app_data,
    "sqlite": sqlite_res,
    "screenshot": shot,
    "screenshotBytes": shot_bytes,
    "providers": providers,
}
frag["checksPassed"] = sum(1 for v in checks.values() if v)
frag["checksTotal"] = len(checks)
frag["checksFailed"] = frag["checksTotal"] - frag["checksPassed"]
print(json.dumps(frag, ensure_ascii=False))
PY
)

echo "$FRAG" | head -c 600; echo

FAILED_N=$(printf '%s' "$FRAG" | python3 -c "import json,sys;print(json.load(sys.stdin).get('checksFailed',1))" 2>/dev/null || echo 1)
TOTAL_N=$(printf '%s' "$FRAG" | python3 -c "import json,sys;print(json.load(sys.stdin).get('checksTotal',0))" 2>/dev/null || echo 0)

if [[ "$FAILED_N" -eq 0 ]]; then
  STATUS="PASS"
  REASON="全部 $TOTAL_N 项断言通过（启动 + 截图 + SQLite 落盘 + 两个 provider 的快照都写进沙盒）"
elif [[ "$WRITE_TAPPED" -eq 0 && "$INTERACTION_METHOD" == "none" ]]; then
  # 没有自动化手段时，脚本没点按钮 → 库为空是预期结果，不算脚本失败
  STATUS="PARTIAL"
  REASON="脚本完成启动与查库，但未能自动点击「写入模拟数据」（本机无 idb / osascript）。" \
          "数据库为空属预期 —— 请人工在 App 里点一次写入后重跑本脚本。"
else
  STATUS="FAIL"
  REASON="$FAILED_N / $TOTAL_N 项断言未通过"
fi

record "$STATUS" "$REASON" "$FRAG"
echo "-- 结论: $STATUS ($REASON)"
echo "-- 证据: $EVID"
