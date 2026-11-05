#!/usr/bin/env bash
# iOS 探针：模拟器验证本轮 SQLite 写入，真机目前只验证安装和启动。
#   --app <.app> [--kind simulator|physical] [--device <UDID>] [--out <目录>] [--bundle <ID>]
# 默认使用 iPhone 模拟器。真机必须指定 --device，并提供设备签名的 .app。
# 旧式 --device 仍接受精确的模拟器或 CoreDevice 设备标识。
# 分类后的结果分别写入 ios-simulator-evidence.json 和 ios-physical-device-evidence.json。

set -uo pipefail

APP=""
DEVICE_UDID=""
TARGET_KIND=""
DEVICE_KIND=""
OUT_DIR="./evidence-ios"
BUNDLE_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  if [[ $# -lt 2 || -z "$2" || "$2" == --* ]]; then
    echo "缺少参数值：$1" >&2; exit 2
  fi
  case "$1" in
    --app) APP="$2" ;;
    --device) DEVICE_UDID="$2" ;;
    --kind) TARGET_KIND="$2" ;;
    --out) OUT_DIR="$2" ;;
    --bundle) BUNDLE_OVERRIDE="$2" ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
  shift 2
done
case "$TARGET_KIND" in ""|simulator|physical) ;; *) echo "--kind 仅接受 simulator 或 physical" >&2; exit 2 ;; esac
[[ -n "$APP" ]] || { echo "请指定 --app <.app>" >&2; exit 2; }
if [[ -z "$DEVICE_UDID" ]]; then
  [[ "$TARGET_KIND" != physical ]] || { echo "真机验证需要 --device <UDID>" >&2; exit 2; }
  TARGET_KIND=simulator
fi

mkdir -p "$OUT_DIR" || exit 1
SCRATCH=$(mktemp -d "$OUT_DIR/.ios-run.XXXXXXXX") || exit 1
FINAL_RECORDED=0
EVID=""

select_evidence_file() {
  case "$TARGET_KIND" in
    simulator) EVID="$OUT_DIR/ios-simulator-evidence.json" ;;
    physical) EVID="$OUT_DIR/ios-physical-device-evidence.json" ;;
  esac
}
select_evidence_file

record() {
  python3 - "$EVID" "$TARGET_KIND" "$DEVICE_KIND" "$1" "$2" "$3" <<'PY' || return 1
import datetime, json, os, sys, tempfile

path, target_kind, device_kind, status, reason, fragment = sys.argv[1:]
data = json.loads(fragment)
data.update(platform="ios", targetKind=target_kind, deviceKind=device_kind or None,
            status=status, reason=reason,
            generatedAtUtc=datetime.datetime.now(datetime.timezone.utc).isoformat())
with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=os.path.dirname(path),
                                 delete=False) as tmp:
    json.dump(data, tmp, indent=2, ensure_ascii=False)
os.replace(tmp.name, path)
PY
  FINAL_RECORDED=1
  echo "$1 · $2 ($EVID)"
}

on_exit() {
  local rc=$?
  if [[ "$FINAL_RECORDED" -eq 0 && -n "$EVID" ]]; then
    record "ERROR" "验证脚本异常结束，不等于环境不具备（exit=$rc）" '{}' || rc=1
  fi
  # 仅清理本轮私有的探测与交互文件。
  rm -f "$SCRATCH/devices.json" "$SCRATCH/ui.json" "$SCRATCH/screen.png"
  rmdir "$SCRATCH" || true
  return "$rc"
}
trap on_exit EXIT

# simctl 与 devicectl 给出的结构化设备清单才可证明设备种类。
if command -v xcrun >/dev/null 2>&1; then
  if [[ "$TARGET_KIND" != physical ]]; then
    SIM_ID=$(xcrun simctl list devices available -j 2>/dev/null | python3 -c '
import json, sys
request = sys.argv[1].casefold()
for runtime, devices in json.load(sys.stdin).get("devices", {}).items():
    if ".iOS-" not in runtime:
        continue
    for device in devices:
        udid = device.get("udid", "")
        if (device.get("isAvailable") is True and udid and
            (request == udid.casefold() if request else device.get("name", "").startswith("iPhone"))):
            print(udid)
            raise SystemExit
' "$DEVICE_UDID" 2>/dev/null) || SIM_ID=""
    if [[ -n "$SIM_ID" ]]; then
      DEVICE_KIND=simulator
      DEVICE_UDID="$SIM_ID"
    fi
  fi
  if [[ -z "$DEVICE_KIND" && "$TARGET_KIND" != simulator && -n "$DEVICE_UDID" ]]; then
    if xcrun devicectl list devices --json-output "$SCRATCH/devices.json" >/dev/null 2>&1 &&
       python3 - "$SCRATCH/devices.json" "$DEVICE_UDID" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    devices = json.load(f)["result"]["devices"]
for device in devices:
    hw = device.get("hardwareProperties", {})
    ids = [device.get("identifier"), hw.get("udid")]
    if (hw.get("reality") == "physical" and hw.get("platform") == "iOS"
        and sys.argv[2].casefold() in {v.casefold() for v in ids if isinstance(v, str)}):
        sys.exit(0)
sys.exit(1)
PY
    then
      DEVICE_KIND=physical
    fi
  fi
fi
if [[ -z "$TARGET_KIND" && -z "$DEVICE_KIND" ]]; then
  echo "无法识别此标识；请指定 --kind simulator 或 --kind physical 以记录本次未运行的目标。" >&2
  exit 2
fi
TARGET_KIND=${TARGET_KIND:-$DEVICE_KIND}
select_evidence_file
if [[ -z "$DEVICE_KIND" ]]; then
  record "NOT_RUN" "Xcode 设备清单中未识别到目标设备，请检查工具、连接及设备标识。" '{"checks":{"deviceAvailable":false}}'
  exit $?
fi
if [[ ! -d "$APP" ]]; then
  record "NOT_RUN" "指定的 .app 不存在。" '{"checks":{"deviceAvailable":true,"appExists":false}}'
  exit $?
fi
BUNDLE="$BUNDLE_OVERRIDE"
if [[ -z "$BUNDLE" ]]; then
  BUNDLE=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Info.plist" 2>/dev/null || true)
fi
if [[ -z "$BUNDLE" ]]; then
  record "NOT_RUN" "无法读取 .app 的 bundle identifier。" '{"checks":{"bundleIdentifierAvailable":false}}'
  exit $?
fi

if [[ "$DEVICE_KIND" == physical ]]; then
  if ! xcrun devicectl device install app --device "$DEVICE_UDID" "$APP"; then
    record "FAIL" "在指定真机上安装失败，请检查配对及开发签名。" '{"checks":{"installed":false}}'
  elif ! xcrun devicectl device process launch --device "$DEVICE_UDID" "$BUNDLE"; then
    record "FAIL" "安装成功，但 devicectl 启动失败。" '{"checks":{"installed":true,"launched":false}}'
  else
    record "PARTIAL" "真机已安装并启动；SQLite 写入和重启回读、通知、安全存储与网络待实测。" '{"checks":{"installed":true,"launched":true}}'
  fi
  exit $?
fi

# 已启动的模拟器也允许继续，bootstatus 才是就绪依据。
xcrun simctl boot "$DEVICE_UDID" >/dev/null 2>&1 || true
if ! xcrun simctl bootstatus "$DEVICE_UDID" -b >/dev/null 2>&1; then
  record "NOT_RUN" "模拟器未就绪。" '{"checks":{"simulatorReady":false}}'
  exit $?
fi
if ! xcrun simctl install "$DEVICE_UDID" "$APP"; then
  record "FAIL" "本轮安装失败，停止验证。" '{"checks":{"installed":false}}'
  exit $?
fi
xcrun simctl terminate "$DEVICE_UDID" "$BUNDLE" >/dev/null 2>&1 || true
if ! LAUNCH_OUT=$(xcrun simctl launch "$DEVICE_UDID" "$BUNDLE"); then
  record "FAIL" "本轮启动失败。" '{"checks":{"installed":true,"launched":false}}'
  exit $?
fi
# simctl launch 输出 <bundle>: <pid>。仅匹配当前 bundle。
LAUNCH_PID=$(printf '%s\n' "$LAUNCH_OUT" | awk -v bundle="$BUNDLE:" '$1 == bundle && $2 ~ /^[1-9][0-9]*$/ {print $2; exit}')
if [[ -z "$LAUNCH_PID" ]]; then
  record "FAIL" "simctl 未返回目标应用的有效 PID。" '{"checks":{"launched":false}}'
  exit $?
fi
sleep 6

# 两次读取同一沙盒。初次写入看新增行，固定 ID 的重复写入还需本轮 UI 状态变化。
APP_DATA=$(xcrun simctl get_app_container "$DEVICE_UDID" "$BUNDLE" data 2>/dev/null || true)
if [[ -z "$APP_DATA" || ! -d "$APP_DATA" ]]; then
  record "FAIL" "无法读取本轮模拟器数据容器。" '{"checks":{"appLaunched":true,"sandboxFound":false}}'
  exit $?
fi

inspect_snapshots() {
  python3 - "$APP_DATA" "$1" <<'PY'
import json, sqlite3, sys
from pathlib import Path

paths = list(Path(sys.argv[1]).rglob("subwise-p03b.db"))
if len(paths) != 1:
    raise SystemExit("未定位到唯一的探针数据库")
with sqlite3.connect(paths[0].resolve().as_uri() + "?mode=ro", uri=True) as conn:
    if sys.argv[2] == "baseline":
        print(conn.execute("SELECT COALESCE(MAX(rowid), 0) FROM snapshots").fetchone()[0])
    else:
        rows = conn.execute("SELECT rowid, provider, payload FROM snapshots WHERE provider IN ('deepseek','minimax')").fetchall()
        providers = set()
        new_providers = set()
        for row_id, provider, payload in rows:
            snapshot = json.loads(payload)
            if snapshot.get("provider") != provider or not snapshot.get("items"):
                raise ValueError("新增快照的内容或平台无效")
            providers.add(provider)
            if row_id > int(sys.argv[2]):
                new_providers.add(provider)
        print(json.dumps({"rowCount": len(rows), "providers": sorted(providers),
                          "newProviders": sorted(new_providers)}))
PY
}
if ! BASE_ROW=$(inspect_snapshots baseline); then
  record "FAIL" "写入前无法读取探针数据库基线。" '{"checks":{"appLaunched":true,"sqliteBaselineRead":false}}'
  exit $?
fi

WRITE_TAPPED=0
INTERACTION_METHOD=none
UI_READY=0
UI_COMPLETED=0
IDB=$(command -v idb 2>/dev/null || true)
if [[ -z "$IDB" && -x "$HOME/.local/bin/idb" ]]; then IDB="$HOME/.local/bin/idb"; fi
has_status() {
  python3 - "$SCRATCH/ui.json" "$1" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    items = json.load(f)
sys.exit(0 if any(item.get(key) == sys.argv[2] for item in items
                  for key in ("AXLabel", "AXValue", "label", "value")) else 1)
PY
}
if [[ -n "$IDB" ]]; then
  if "$IDB" ui describe-all --udid "$DEVICE_UDID" > "$SCRATCH/ui.json"; then
    if has_status "SQLite 已打开 · 已读取本地记录"; then UI_READY=1; fi
    COORD=$(python3 - "$SCRATCH/ui.json" <<'PY'
import json, math, sys
with open(sys.argv[1], encoding="utf-8") as f:
    items = json.load(f)
for item in items:
    labels = [item.get(k) for k in ("AXLabel", "AXValue", "label", "value")]
    if "写入模拟数据并从 SQLite 读取" not in labels:
        continue
    roles = [str(item[k]).lower() for k in ("type", "role", "AXRole") if item.get(k)]
    if roles and not any(role in ("button", "axbutton") for role in roles):
        continue
    frame = item.get("frame") or item.get("AXFrame") or {}
    if (isinstance(frame, dict)
        and all(isinstance(frame.get(k), (int, float)) and math.isfinite(frame[k])
                for k in ("x", "y", "width", "height"))
        and frame["width"] > 0 and frame["height"] > 0):
        print(int(frame["x"] + frame["width"]/2), int(frame["y"] + frame["height"]/2))
        break
PY
)
    if read -r X Y <<< "$COORD" && [[ -n "$X" && -n "$Y" ]] &&
       "$IDB" ui tap --udid "$DEVICE_UDID" "$X" "$Y"; then
      WRITE_TAPPED=1
      INTERACTION_METHOD=idb
    fi
  fi
fi
if [[ "$WRITE_TAPPED" -eq 0 && -t 0 ]]; then
  echo "请在此模拟器上点击「写入模拟数据并从 SQLite 读取」，完成后按回车。"
  if read -r -t 300 _; then INTERACTION_METHOD=manual; fi
fi

sleep 6
if [[ "$UI_READY" == 1 ]] && "$IDB" ui describe-all --udid "$DEVICE_UDID" > "$SCRATCH/ui.json" &&
   has_status "模拟适配器 → SQLite → UI 完成；非平台同步"; then
  UI_COMPLETED=1
fi
if ! SQLITE_RESULT=$(inspect_snapshots "$BASE_ROW"); then
  record "FAIL" "无法读取或解析本轮新增的快照。" '{"checks":{"sqliteBaselineRead":true,"snapshotsReadable":false}}'
  exit $?
fi
SHOT=""
if xcrun simctl io "$DEVICE_UDID" screenshot "$SCRATCH/screen.png" >/dev/null 2>&1 &&
   [[ -s "$SCRATCH/screen.png" ]] && mv "$SCRATCH/screen.png" "$OUT_DIR/ios-simulator-screen.png"; then
  SHOT="$OUT_DIR/ios-simulator-screen.png"
fi
ALIVE=0
if xcrun simctl spawn "$DEVICE_UDID" launchctl list 2>/dev/null |
   awk -v pid="$LAUNCH_PID" '$1 == pid {found=1} END {exit !found}'; then
  ALIVE=1
fi
FRAG=$(python3 - "$SQLITE_RESULT" "$INTERACTION_METHOD" "$WRITE_TAPPED" "$SHOT" "$LAUNCH_PID" "$ALIVE" "$BUNDLE" "$UI_COMPLETED" <<'PY'
import json, os, sys
sqlite_result = json.loads(sys.argv[1])
method, tapped, shot, pid, alive, bundle, ui_completed = sys.argv[2:]
providers = set(sqlite_result["providers"])
checks = {
    "appLaunched": True,
    "processAlive": alive == "1",
    "screenshotTaken": bool(shot),
    "sqliteBaselineRead": True,
    "bothProvidersStored": {"deepseek", "minimax"} <= providers,
    "currentWriteObserved": set(sqlite_result["newProviders"]) == {"deepseek", "minimax"} or ui_completed == "1",
    "interactionWasAutomated": tapped == "1",
}
print(json.dumps({
    "checks": checks, "checksPassed": sum(checks.values()), "checksTotal": len(checks),
    "checksFailed": len(checks) - sum(checks.values()), "sqlite": sqlite_result,
    "interaction": {"method": method, "writeTappedByScript": tapped == "1"},
    "screenshot": shot or None, "screenshotBytes": os.path.getsize(shot) if shot else 0,
    "bundleIdentifier": bundle, "launchPid": int(pid), "isRealDevice": False,
}))
PY
) || exit 1

if [[ "$ALIVE" != 1 || -z "$SHOT" ]]; then
  STATUS="FAIL"
  REASON="进程存活或本轮截图断言失败。"
elif [[ "$WRITE_TAPPED" -eq 0 ]]; then
  STATUS="PARTIAL"
  REASON="已启动并检查数据库，未完成自动交互；详见本轮快照和交互来源。"
elif python3 -c 'import json,sys; sys.exit(0 if all(json.loads(sys.argv[1])["checks"].values()) else 1)' "$FRAG"; then
  STATUS="PASS"
  REASON="模拟器本轮自动写入两种平台的快照，已从 SQLite 读回。"
else
  STATUS="FAIL"
  REASON="自动点击后，未读到本轮新增的两种平台快照。"
fi
record "$STATUS" "$REASON" "$FRAG"
