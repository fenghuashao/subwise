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

#   $EVIDENCE_DIR/ios static/run 两份 JSON + 截图

# 退出码：

#   始终 0。失败写入 JSON 的 status/error 字段，由 CI 决定是否阻断。


set -uo pipefail


APP="${APP_PATH:-}"

OUT_DIR="${EVIDENCE_DIR:-}"


fail_json() {

  # $1 = 输出文件, $2 = status, $3 = error

  python3 - "$1" "$2" "$3" <<'PY'

import json, sys, datetime

json.dump({

  "status": sys.argv[2],

  "error": sys.argv[3],

  "generatedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),

}, open(sys.argv[1], "w"), indent=2, ensure_ascii=False)

PY

}


if [[ -z "$APP" || -z "$OUT_DIR" ]]; then

  echo "::error::APP_PATH / EVIDENCE_DIR 未设置" >&2

  exit 1

fi

mkdir -p "$OUT_DIR"


STATIC="$OUT_DIR/ios-static.json"

RUN="$OUT_DIR/ios-run.json"

SHOT="$OUT_DIR/ios-simulator.png"


########################################################################

# 一、静态核验：不依赖模拟器是否可用

########################################################################

EXE="$(plutil -extract CFBundleExecutable raw -o - "$APP/Info.plist" 2>/dev/null || echo '__Missing__')"

BIN="$APP/$EXE"


BUNDLE="$(plutil -extract CFBundleIdentifier raw -o - "$APP/Info.plist" 2>/dev/null || echo '')"

VER="$(plutil -extract CFBundleShortVersionString raw -o - "$APP/Info.plist" 2>/dev/null || echo '')"

BUILD="$(plutil -extract CFBundleVersion raw -o - "$APP/Info.plist" 2>/dev/null || echo '')"

MINOS="$(plutil -extract MinimumOSVersion raw -o - "$APP/Info.plist" 2>/dev/null || echo '')"

ARCHS="$(lipo -archs "$BIN" 2>/dev/null | tr -d '\n' | tr -s ' ' || echo '')"

EXE_BYTES="$(stat -f%z "$BIN" 2>/dev/null || echo 0)"

APP_BYTES="$(du -sk "$APP" 2>/dev/null | awk '{print $1}' || echo 0)"

SIGN="$(codesign --verify --deep --strict "$APP" 2>&1 >/dev/null | head -3 || true)"

PLATFORM="$(vtool -show-build "$BIN" 2>/dev/null | grep -iE 'platform|minos|sdk' | tr -s ' ' | paste -sd'; ' - || echo '')"

FRAMEWORKS="$(ls "$APP/Frameworks" 2>/dev/null | paste -sd, - || echo '')"


APP="$APP" BIN="$BIN" EXE="$EXE" BUNDLE="$BUNDLE" VER="$VER" BUILD="$BUILD" \

MINOS="$MINOS" ARCHS="$ARCHS" EXE_BYTES="$EXE_BYTES" APP_BYTES="$APP_BYTES" \

SIGN="$SIGN" PLATFORM="$PLATFORM" FRAMEWORKS="$FRAMEWORKS" XCODE="$(xcodebuild -version 2>/dev/null | tr '\n' ' ')" \

python3 - "$STATIC" <<'PY'

import json, os, sys, datetime

e = {k: os.environ.get(k, "") for k in

     ["APP","BIN","EXE","BUNDLE","VER","BUILD","MINOS","ARCHS","SIGN","PLATFORM","FRAMEWORKS","XCODE"]}

json.dump({

  "generatedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),

  "bundleIdentifier": e["BUNDLE"],

  "shortVersion": e["VER"],

  "bundleVersion": e["BUILD"],

  "minimumOSVersion": e["MINOS"],

  "architectures": e["ARCHS"].split(),

  "executable": e["EXE"],

  "executableBytes": int(os.environ.get("EXE_BYTES") or 0),

  "appBundleKB": int(os.environ.get("APP_BYTES") or 0),

  "codesignVerifyError": e["SIGN"].strip() or None,

  "machOBuildInfo": e["PLATFORM"],

  "embeddedFrameworks": [x for x in e["FRAMEWORKS"].split(",") if x],

  "xcodebuild": e["XCODE"].strip(),

  "note": "模拟器 Release 构建。非 IPA、非真机、非生产签名。",

}, open(sys.argv[1], "w"), indent=2, ensure_ascii=False)

PY


########################################################################

# 二、动态核验：模拟器内真实安装并启动

########################################################################

record() { # $1=status $2=error

  APP="$APP" BUNDLE="$BUNDLE" UDID="${SIM_UDID:-}" DEV="${SIM_NAME:-}" RT="${SIM_RT:-}" \

  XPID="${LAUNCH_PID:-}" SHOT_OK="${SHOT_OK:-false}" LOGLEN="${LOG_LINES:-0}" \

  python3 - "$RUN" "$1" "$2" <<'PY'

import json, os, sys, datetime

env = os.environ.get

json.dump({

  "generatedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),

  "status": sys.argv[2],

  "error": sys.argv[3] or None,

  "bundleIdentifier": env("BUNDLE"),

  "simulatorUdid": env("UDID") or None,

  "simulatorName": env("DEV") or None,

  "simulatorRuntime": env("RT") or None,

  "launchPid": int(env("XPID")) if (env("XPID") or "").isdigit() else None,

  "screenshot": env("SHOT_OK") == "true",

  "logLines": int(env("LOGLEN") or 0),

  "note": "状态 RUN 表示 App 进程在 iOS 模拟器中真实启动；未含真机、UI 自动化或功能断言。",

}, open(sys.argv[1], "w"), indent=2, ensure_ascii=False)

PY

}


if ! command -v xcrun >/dev/null 2>&1; then

  record "NOT_RUN" "xcrun 不可用，非 macOS 环境"

  exit 0

fi


# 选一台可用 iPhone（优先最高 iOS runtime）

DEV_JSON="$(xcrun simctl list devices available -j 2>/dev/null || echo '{}')"

read -r SIM_UDID SIM_NAME SIM_RT < <(DEV_JSON="$DEV_JSON" python3 - <<'PY'

import json, os, sys

try:

    d = json.loads(os.environ.get("DEV_JSON") or "{}")

except Exception:

    print("  "); sys.exit()

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


trap 'xcrun simctl shutdown "$SIM_UDID" >/dev/null 2>&1 || true' EXIT


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

INSTALLED="$(xcrun simctl get_app_container "$SIM_UDID" "$BUNDLE" 2>/dev/null || echo '')"

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
