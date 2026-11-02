#!/usr/bin/env bash
# iOS 模拟器实跑校验
#
# 目的：把 iOS 从「构建通过」推进到「在 iOS 模拟器内真实启动」，
#       并产出机器可读证据。不以脚本自述作为通过依据。
#
# 只用 Xcode 命令行工具（xcrun / simctl / lipo / vtool / plutil），
# 不需要真实设备、Apple 开发者账号或生产签名。
#
# 输入环境变量：
#   APP_PATH      必填  .app 产物路径
#   EVIDENCE_DIR  必填  证据输出目录
# 输出：
#   $EVIDENCE_DIR/ios-static.json / ios-run.json / ios-simulator.png
# 退出码：
#   始终 0。失败写入 JSON 的 status/error 字段，由 CI 决定是否阻断。
#
# JSON 的 status 取值：
#   RUN       App 进程在 iOS 模拟器中真实启动
#   NOT_RUN   环境不具备，本次未执行（附原因）
#   ERROR     脚本自身异常终止（崩溃 / 被 kill / 证据写入失败）
#
# 实现注意（2026-11-01 修复）：不要在「VAR=val ... \ 续行」块中插入空行——
# 反斜杠续行会先接上空行、随后空行的换行即终止命令，赋值与后续命令被拆开，
# 变量无法进入 python 的 os.environ（表现为证据 JSON 全空壳）。
# 本版一律把数据经 argv 传给 python，不再依赖环境变量接力。
#
# 实现注意（2026-11-02 补充）：EXIT 兜底保证「文件不存在」不再是可能状态。
# 之前脚本崩溃时 ios-run.json 整个不产出，而上传步骤用 if-no-files-found: warn，
# 于是「脚本崩了」与「环境不具备（文件里写着 NOT_RUN）」在 CI 上表现完全一样，
# 无法区分。现在任何原因提前退出都会补写一份 status=ERROR 的记录。

set -uo pipefail

APP="${APP_PATH:-}"
OUT_DIR="${EVIDENCE_DIR:-}"

if [[ -z "$APP" || -z "$OUT_DIR" ]]; then
  echo "::error::APP_PATH / EVIDENCE_DIR 未设置" >&2
  exit 1
fi
mkdir -p "$OUT_DIR"

STATIC="$OUT_DIR/ios-static.json"
RUN="$OUT_DIR/ios-run.json"
SHOT="$OUT_DIR/ios-simulator.png"

# EXIT 兜底（2026-11-02 新增）
#
# 目的：让「证据文件不存在」不再是可能状态。
# 之前脚本崩溃时 ios-run.json 整个不产出，上传步骤又是 if-no-files-found: warn，
# 于是「脚本崩了」与「环境不具备（文件里写着 NOT_RUN）」在 CI 上完全一样，看不出区别。
# 现在任何非正常结束都会补写一份 status=ERROR 的记录。
#
# 实现要点：
#   * 用 FINAL_RECORDED 标记区分「已经由 record() 正常写过」与「异常中止」。
#   * trap 在静态核验之前就安装 —— 静态核验段本身也可能崩
#     （如 python heredoc 失败、.app 路径非法），晚装就覆盖不到。
#   * 兜底自身失败（如 python 不可用）只打印警告，不改变退出码，也不掩盖原始失败。
FINAL_RECORDED=0

# 用法: write_json <file> <payload-json-string>
write_json() {
  python3 -c 'import sys; open(sys.argv[1], "w").write(sys.argv[2])' "$1" "$2"
}

utcnow() { date -u +%Y-%m-%dT%H:%M:%S+00:00; }

json_escape() { python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.argv[1]))' "$1"; }

# EXIT 兜底：脚本非正常结束时补写 status=ERROR。
# 只在「尚未由 record() 写过结论」时才写，避免覆盖真实结论。
# 兜底自身出错（例如 python 不可用）只打印警告，不改变退出码，也不掩盖原始失败。
on_exit() {
  local rc=$?
  if [[ "$FINAL_RECORDED" -eq 0 ]]; then
    echo "::error::脚本在未产出结论的情况下结束（exit=$rc），补写 status=ERROR 证据" >&2
    python3 - "$RUN" "$rc" <<'PY' || echo "::error::兜底写入失败：$RUN 仍不存在" >&2
import json, sys, datetime
out, rc = sys.argv[1], sys.argv[2]
json.dump({
  "generatedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "status": "ERROR",
  "error": "脚本异常终止，未能完成核验（exit=%s）。这是脚本自身失败，不等于环境不具备。" % rc,
  "bundleIdentifier": None,
  "simulatorUdid": None,
  "simulatorName": None,
  "simulatorRuntime": None,
  "launchPid": None,
  "screenshot": False,
  "logLines": 0,
  "note": "status=ERROR 表示校验脚本自身崩溃或被中断；status=NOT_RUN 才表示环境不具备、本次未执行。",
}, open(out, "w"), indent=2, ensure_ascii=False)
PY
  fi
  # 已有的模拟器 shutdown 收尾（SIM_UDID 只在动态核验段才有值）
  [[ -n "${SIM_UDID:-}" ]] && xcrun simctl shutdown "$SIM_UDID" >/dev/null 2>&1 || true
  return $rc
}
trap on_exit EXIT

########################################################################
# 一、静态核验：不依赖模拟器是否可用
########################################################################
PLIST="$APP/Info.plist"
EXE="$(plutil -extract CFBundleExecutable raw -o - "$PLIST" 2>/dev/null || true)"
BUNDLE="$(plutil -extract CFBundleIdentifier raw -o - "$PLIST" 2>/dev/null || true)"
VER="$(plutil -extract CFBundleShortVersionString raw -o - "$PLIST" 2>/dev/null || true)"
BUILD="$(plutil -extract CFBundleVersion raw -o - "$PLIST" 2>/dev/null || true)"
MINOS="$(plutil -extract MinimumOSVersion raw -o - "$PLIST" 2>/dev/null || true)"
BIN="$APP/${EXE:-__missing__}"
ARCHS="$(lipo -archs "$BIN" 2>/dev/null | tr -s ' ' || true)"
EXE_BYTES="$(stat -f%z "$BIN" 2>/dev/null || echo 0)"
APP_BYTES="$(du -sk "$APP" 2>/dev/null | awk '{print $1}' || echo 0)"
SIGN="$(codesign --verify --deep --strict "$APP" 2>&1 >/dev/null | head -3 || true)"
PLATFORM="$(vtool -show-build "$BIN" 2>/dev/null | grep -iE 'platform|minos|sdk' | tr -s ' ' | paste -sd'; ' - || true)"
FRAMEWORKS="$(ls "$APP/Frameworks" 2>/dev/null | paste -sd, - || true)"
XCODE="$(xcodebuild -version 2>/dev/null | tr '\n' ' ' || true)"

STATIC_PAYLOAD="$(python3 - "$STATIC" \
  "$APP" "$BIN" "$EXE" "$BUNDLE" "$VER" "$BUILD" "$MINOS" \
  "$ARCHS" "$EXE_BYTES" "$APP_BYTES" "$SIGN" "$PLATFORM" "$FRAMEWORKS" "$XCODE" <<'PY'
import json, sys, datetime
_, out, app, bin_, exe, bundle, ver, build, minos, archs, exe_bytes, app_bytes, sign, platform, frameworks, xcode = sys.argv
json.dump({
  "generatedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "appPath": app,
  "bundleIdentifier": bundle.strip(),
  "shortVersion": ver.strip(),
  "bundleVersion": build.strip(),
  "minimumOSVersion": minos.strip(),
  "architectures": archs.split(),
  "executable": exe.strip(),
  "executableBytes": int(exe_bytes or 0),
  "appBundleKB": int(app_bytes or 0),
  "codesignVerifyError": sign.strip() or None,
  "machOBuildInfo": platform.strip(),
  "embeddedFrameworks": [x for x in frameworks.split(",") if x.strip()],
  "xcodebuild": xcode.strip(),
  "note": "模拟器 Release 构建。非 IPA、非真机、非生产签名。",
}, open(out, "w"), indent=2, ensure_ascii=False)
PY
)"
# 静态核验若连 bundle id 都拿不到，明确标记，不静默放过
if [[ -z "$(python3 -c "import json;print(json.load(open('$STATIC'))['bundleIdentifier'])")" ]]; then
  python3 - "$STATIC" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["staticStatus"] = "FAILED"
d["staticError"] = "Info.plist 不可读或 .app 路径无效：静态核验字段为空"
json.dump(d, open(p, "w"), indent=2, ensure_ascii=False)
PY
fi

########################################################################
# 二、动态核验：模拟器内真实安装并启动
########################################################################
# 用法: record <status> <error>
record() {
  python3 - "$RUN" "$1" "$2" \
    "$BUNDLE" "${SIM_UDID:-}" "${SIM_NAME:-}" "${SIM_RT:-}" \
    "${LAUNCH_PID:-}" "${SHOT_OK:-false}" "${LOG_LINES:-0}" <<'PY'
import json, sys, datetime
(out, status, error, bundle, udid, dev, rt, xpid, shot, loglen) = sys.argv[1:11]
json.dump({
  "generatedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "status": status,
  "error": error or None,
  "bundleIdentifier": bundle or None,
  "simulatorUdid": udid or None,
  "simulatorName": dev or None,
  "simulatorRuntime": rt or None,
  "launchPid": int(xpid) if xpid.isdigit() else None,
  "screenshot": shot == "true",
  "logLines": int(loglen or 0),
  "note": "状态 RUN 表示 App 进程在 iOS 模拟器中真实启动；未含真机、UI 自动化或功能断言。",
}, open(out, "w"), indent=2, ensure_ascii=False)
PY
  FINAL_RECORDED=1
}

if ! command -v xcrun >/dev/null 2>&1; then
  record "NOT_RUN" "xcrun 不可用，非 macOS 环境"
  exit 0
fi

# 选一台可用 iPhone（优先最高 iOS runtime）
DEV_JSON="$(xcrun simctl list devices available -j 2>/dev/null || echo '{}')"
read -r SIM_UDID SIM_NAME SIM_RT < <(DEV_JSON="$DEV_JSON" python3 - <<'PY'
import json, os
try:
    d = json.loads(os.environ.get("DEV_JSON") or "{}")
except Exception:
    print("  "); raise SystemExit
best = None
for runtime, devs in (d.get("devices") or {}).items():
    if "iOS" not in runtime:
        continue
    for dev in devs:
        if not dev.get("isAvailable") or not dev["name"].startswith("iPhone"):
            continue
        key = (runtime, dev["name"])
        if best is None or key > best[0]:
            best = (key, dev["udid"], dev["name"], runtime)
print("  " if not best else " ".join(best[1:]))
PY
)
SIM_UDID="${SIM_UDID:-}"
if [[ -z "$SIM_UDID" ]]; then
  record "NOT_RUN" "没有可用的 iPhone 模拟器 runtime"
  exit 0
fi
echo "选用模拟器：$SIM_NAME ($SIM_RT) $SIM_UDID"

# 模拟器 shutdown 已并入 on_exit 的 EXIT trap（2026-11-02），
# 不再单独设 trap，避免覆盖兜底逻辑。

if ! xcrun simctl boot "$SIM_UDID" >/dev/null 2>&1; then
  xcrun simctl erase "$SIM_UDID" >/dev/null 2>&1 || true
  if ! xcrun simctl boot "$SIM_UDID" >/dev/null 2>&1; then
    record "NOT_RUN" "模拟器启动失败（boot/erase 均未成功）"
    exit 0
  fi
fi
if ! xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null 2>&1; then
  record "NOT_RUN" "等待模拟器 boot 就绪超时"
  exit 0
fi

if ! xcrun simctl install "$SIM_UDID" "$APP" >/dev/null 2>&1; then
  record "NOT_RUN" "安装 App 到模拟器失败"
  exit 0
fi
INSTALLED="$(xcrun simctl get_app_container "$SIM_UDID" "$BUNDLE" 2>/dev/null || true)"
if [[ -z "$INSTALLED" ]]; then
  record "NOT_RUN" "已执行 install 但 get_app_container 查不到包"
  exit 0
fi

if ! xcrun simctl launch "$SIM_UDID" "$BUNDLE" 2>/dev/null; then
  record "NOT_RUN" "App 启动失败"
  exit 0
fi

sleep 6
LAUNCH_PID="$(xcrun simctl spawn "$SIM_UDID" launchctl list 2>/dev/null | grep -F "$BUNDLE" | awk '{print $1}' | head -1)"
if [[ -z "$LAUNCH_PID" ]]; then
  record "NOT_RUN" "已执行 launch 但进程表中查不到该 bundle 的 PID"
  exit 0
fi

LOG_LINES="$(xcrun simctl spawn "$SIM_UDID" log show --last 2m --predicate "process == '${EXE}'" --style compact 2>/dev/null | wc -l | tr -d ' ')"
SHOT_OK=false
if xcrun simctl io "$SIM_UDID" screenshot "$SHOT" >/dev/null 2>&1 && [[ -s "$SHOT" ]]; then
  SHOT_OK=true
fi

record "RUN" ""
echo "iOS 模拟器实跑完成：PID=$LAUNCH_PID 日志行=$LOG_LINES 截图=$SHOT_OK"
