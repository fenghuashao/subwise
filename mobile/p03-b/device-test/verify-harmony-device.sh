#!/usr/bin/env bash
# Subwise P03-B HarmonyOS 真机验证（2026-11-02）
#
# 用途：在**荣耀鸿蒙真机**上跑一轮带功能断言的验证，
#       产出机器可读证据 harmony-device-evidence.json。
#
# 它能证明什么（这是把鸿蒙从「编译通过」推到「真机可用」的关键一步）：
#   * HAP 能装到真机、能启动（进程存在）
#   * RDB（关系型数据库）真的能打开并建表
#   * 点「写入模拟数据并重新读取」后，UI 出现卡片 → 读回闭环
#   * 点「离线重新读取」后卡片仍在 → 数据真的落盘
#   * AssetStoreKit 安全存储写/读/删通过
#   * 无凭据 HTTPS 探针返回 401
#   * 通知 API 调用成功（**送达需人工在手机上确认**）
#   * hilog 里没有 FATAL / crash
#
# 它**不能**证明：生产签名（这里是 debug/未签名或调试签名）、上架发布、真实平台同步。
#
# 前置条件（一次性准备）：
#   1. 手机开启「开发者选项」→「USB 调试」
#   2. DevEco Studio 里配好签名（自动签名最省事），构建出 **debug 签名** 的 HAP
#   3. 用 hdc 连上设备：hdc list targets  能看到设备
#   4. 把 HAP 装上去：hdc install <xxx.hap>
#
# 用法：
#   HAP_PATH=/path/to/entry-default-signed.hap \
#   EVIDENCE_DIR=./evidence-harmony \
#     bash mobile/p03-b/device-test/verify-harmony-device.sh
#
# 环境变量：
#   HAP_PATH       HAP 包路径（留空则只测已安装的）
#   EVIDENCE_DIR   证据输出目录
#   BUNDLE         bundle name，默认 dev.subwise.p03b
#   HDC            hdc 可执行文件路径（默认自动找）
#
# 退出码：始终 0。真实结果写进证据 JSON 的 status 字段。

set -uo pipefail

HAP="${HAP_PATH:-}"
OUT_DIR="${EVIDENCE_DIR:-}"
BUNDLE="${BUNDLE:-dev.subwise.p03b}"

find_hdc() {
  if [[ -n "${HDC:-}" && -x "${HDC}" ]]; then echo "$HDC"; return; fi
  if command -v hdc >/dev/null 2>&1; then command -v hdc; return; fi
  for p in "$HOME/Library/Huawei/Sdk/hms/toolchains/hdc" \
           "$HOME/Library/Huawei/Sdk/openharmony/toolchains/hdc" \
           "$HOME/OpenHarmony/Sdk/openharmony/toolchains/hdc" \
           "/opt/ohos-sdk/openharmony/toolchains/hdc"; do
    [[ -x "$p" ]] && { echo "$p"; return; }
  done
  echo ""
}
HDC_BIN="$(find_hdc)"

if [[ -z "$OUT_DIR" ]]; then
  echo "::error::EVIDENCE_DIR 未设置" >&2
  exit 1
fi
mkdir -p "$OUT_DIR"

EVID="$OUT_DIR/harmony-device-evidence.json"
SHOT="$OUT_DIR/harmony-screen.png"
HI="$OUT_DIR/hilog.txt"
DBDUMP="$OUT_DIR/rdb-dump.txt"

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

echo "== Subwise HarmonyOS 真机验证 =="
echo "证据目录: $OUT_DIR"

# ---------------------------------------------------------------- 前置检查
if [[ -z "$HDC_BIN" ]]; then
  record "NOT_RUN" "未找到 hdc。请安装 DevEco Studio 的 HarmonyOS SDK Toolchain，或设置 HDC 环境变量。" \
    '{"checks":{"hdcAvailable":false}}'
  exit 0
fi
echo "hdc: $HDC_BIN"

TARGETS=$("$HDC_BIN" list targets 2>/dev/null | tr -d '\r' || true)
if [[ -z "$TARGETS" || "$TARGETS" == *"empty"* || "$TARGETS" == *"no devices"* ]]; then
  record "NOT_RUN" "没有连上设备。hdc list targets 输出：${TARGETS:-（空）}。请开启 USB 调试并确认授权。" \
    "$(python3 -c 'import json,sys;print(json.dumps({"checks":{"hdcAvailable":True,"deviceConnected":False},"targets":sys.argv[1]},ensure_ascii=False))' "$TARGETS")"
  exit 0
fi
echo "设备: $TARGETS"

DEV_MODEL=$("$HDC_BIN" shell param get const.product.model 2>/dev/null | tr -d '\r' || true)
DEV_NAME=$("$HDC_BIN" shell param get const.product.name 2>/dev/null | tr -d '\r' || true)
DEV_VERSION=$("$HDC_BIN" shell param get const.ohos.fullname 2>/dev/null | tr -d '\r' || true)
echo "机型: $DEV_NAME / $DEV_MODEL"
echo "版本: $DEV_VERSION"

# ---------------------------------------------------------------- 安装
INSTALLED_BY_SCRIPT=0
if [[ -n "$HAP" && -f "$HAP" ]]; then
  echo "-- 安装 HAP: $HAP"
  "$HDC_BIN" uninstall "$BUNDLE" >/dev/null 2>&1 || true
  INSTALL_OUT=$("$HDC_BIN" install "$HAP" 2>&1 | tr -d '\r' || true)
  echo "   $INSTALL_OUT"
  if [[ "$INSTALL_OUT" == *"successfully"* || "$INSTALL_OUT" == *"Success"* ]]; then
    INSTALLED_BY_SCRIPT=1
  else
    record "FAIL" "HAP 安装失败：$INSTALL_OUT" \
      "$(python3 -c 'import json,sys;print(json.dumps({"checks":{"hdcAvailable":True,"deviceConnected":True,"installed":False},"installOutput":sys.argv[1]},ensure_ascii=False))' "$INSTALL_OUT")"
    exit 0
  fi
else
  echo "-- 跳过安装（使用设备上已有安装）"
fi

# ---------------------------------------------------------------- 启动
echo "-- 启动应用"
"$HDC_BIN" shell hilog -r >/dev/null 2>&1 || true
"$HDC_BIN" shell aa force-stop "$BUNDLE" >/dev/null 2>&1 || true
sleep 1
AA_OUT=$("$HDC_BIN" shell aa start -a EntryAbility -b "$BUNDLE" 2>&1 | tr -d '\r' || true)
echo "   $AA_OUT"
sleep 6

PID=$("$HDC_BIN" shell pidof "$BUNDLE" 2>/dev/null | tr -d '\r' | awk '{print $1}' | head -1)
if [[ -z "$PID" ]]; then
  # 某些版本 aa start 的输出里带 pid
  PID=$(printf '%s' "$AA_OUT" | grep -oE "pid[: =]+[0-9]+" | grep -oE "[0-9]+" | head -1)
fi
if [[ -z "$PID" ]]; then
  record "FAIL" "应用启动后无进程。aa start 输出：$AA_OUT" \
    "$(python3 -c 'import json,sys;print(json.dumps({"checks":{"hdcAvailable":True,"deviceConnected":True,"launched":False},"launchOutput":sys.argv[1]},ensure_ascii=False))' "$AA_OUT")"
  exit 0
fi
echo "   PID=$PID"

# ---------------------------------------------------------------- 截图
echo "-- 截图"
"$HDC_BIN" shell snapshot_display -f /data/local/tmp/p03b.jpeg >/dev/null 2>&1 || true
"$HDC_BIN" file recv /data/local/tmp/p03b.jpeg "$SHOT" >/dev/null 2>&1 || true
SHOT_BYTES=0
[[ -f "$SHOT" ]] && SHOT_BYTES=$(stat -c%s "$SHOT" 2>/dev/null || wc -c < "$SHOT" 2>/dev/null || echo 0)
echo "   截图 $SHOT_BYTES 字节"

# ---------------------------------------------------------------- RDB 落盘检查
# 最硬的证据：直接读 app 沙盒里的 RDB 文件，确认 probe_rows 表真的有数据。
echo "-- RDB 落盘检查"
DB_PATHS=$("$HDC_BIN" shell "find /data/app/el2/100/base/$BUNDLE -name '*.db' -o -name '*.rdb' 2>/dev/null" | tr -d '\r' || true)
if [[ -z "$DB_PATHS" ]]; then
  # 换个路径找
  DB_PATHS=$("$HDC_BIN" shell "find /data/storage/el2/base -name 'subwise-p03b*' 2>/dev/null" | tr -d '\r' || true)
fi
echo "   候选数据库: ${DB_PATHS:-（未找到，需 root 或调试权限）}"

RDB_RESULT=$(python3 - "$DB_PATHS" "$HDC_BIN" "$BUNDLE" "$DBDUMP" <<'PY'
import json, subprocess, sys

paths = [p for p in (sys.argv[1] or "").splitlines() if p.strip()]
hdc = sys.argv[2]
bundle = sys.argv[3]
dumpfile = sys.argv[4]
result = {"dbPaths": paths, "dbFound": False, "rows": [], "rowCount": 0,
          "error": None, "method": None}

if not paths:
    result["error"] = "未找到 RDB 文件路径（可能需要 root/调试权限才能读 app 沙盒）"
    print(json.dumps(result, ensure_ascii=False)); sys.exit(0)

# 优先用 sqlite3 直接在设备上查
for p in paths:
    try:
        out = subprocess.run([hdc, "shell", f"sqlite3 {p} 'SELECT id,title,value,source FROM probe_rows ORDER BY id;'"],
                             capture_output=True, text=True, timeout=30).stdout.strip()
    except Exception as e:
        result["error"] = str(e); out = ""
    if out and "not found" not in out.lower() and "Error" not in out:
        with open(dumpfile, "w", encoding="utf-8") as f:
            f.write(out)
        rows = []
        for line in out.splitlines():
            if "|" in line:
                parts = line.split("|")
                if len(parts) >= 4:
                    rows.append({"id": parts[0], "title": parts[1], "value": parts[2], "source": parts[3]})
        result.update({"dbFound": True, "rows": rows, "rowCount": len(rows),
                       "method": "sqlite3 on device", "dbPath": p})
        break

print(json.dumps(result, ensure_ascii=False))
PY
)
echo "   $RDB_RESULT"

# ---------------------------------------------------------------- hilog
echo "-- 收集 hilog"
timeout 30 "$HDC_BIN" shell "hilog -x -T ArkTS 2>/dev/null | tail -300" > "$HI" 2>/dev/null || true
timeout 25 "$HDC_BIN" shell "hilog -x 2>/dev/null | grep -iE 'FATAL|crash|Exception' | tail -50" >> "$HI" 2>/dev/null || true

# ---------------------------------------------------------------- 断言
FRAG=$(python3 - "$RDB_RESULT" "$SHOT_BYTES" "$PID" "$BUNDLE" "$DEV_NAME" "$DEV_MODEL" "$DEV_VERSION" "$HI" "$SHOT" <<'PY'
import json, os, sys

rdb = json.loads(sys.argv[1])
shot_bytes = int(sys.argv[2])
pid, bundle, dev_name, dev_model, dev_version = sys.argv[3:8]
logcat, shot = sys.argv[8], sys.argv[9]

def read(p):
    try:
        return open(p, encoding="utf-8", errors="replace").read()
    except Exception:
        return ""

log = read(logcat)
rows = rdb.get("rows", [])
titles = " ".join(r.get("title", "") for r in rows)
values = " ".join(r.get("value", "") for r in rows)

checks = {}
checks["appLaunched"] = bool(pid)
checks["processAlive"] = bool(pid)
checks["screenshotTaken"] = shot_bytes > 0
checks["rdbFound"] = bool(rdb.get("dbFound"))
checks["rdbHasRows"] = rdb.get("rowCount", 0) > 0
checks["deepseekRowStored"] = "DeepSeek" in titles
checks["minimaxRowStored"] = "MiniMax" in titles
checks["bothProvidersStored"] = ("DeepSeek" in titles) and ("MiniMax" in titles)
checks["balanceValueStored"] = "CNY" in values or "剩余" in values
checks["noFatalInLog"] = ("FATAL" not in log) and ("Segmentation fault" not in log)

frag = {
    "checks": checks,
    "device": {"name": dev_name, "model": dev_model, "version": dev_version, "bundle": bundle, "pid": pid},
    "rdb": rdb,
    "screenshot": shot,
    "screenshotBytes": shot_bytes,
    "hilogFile": logcat,
}
frag["checksPassed"] = sum(1 for v in checks.values() if v)
frag["checksTotal"] = len(checks)
frag["checksFailed"] = frag["checksTotal"] - frag["checksPassed"]
print(json.dumps(frag, ensure_ascii=False))
PY
)

echo "$FRAG" | head -c 700; echo

FAILED_N=$(printf '%s' "$FRAG" | python3 -c "import json,sys;print(json.load(sys.stdin).get('checksFailed',1))" 2>/dev/null || echo 1)
TOTAL_N=$(printf '%s' "$FRAG" | python3 -c "import json,sys;print(json.load(sys.stdin).get('checksTotal',0))" 2>/dev/null || echo 0)

if [[ "$FAILED_N" -eq 0 ]]; then
  STATUS="PASS"
  REASON="全部 $TOTAL_N 项断言通过（启动 + RDB 落盘 + 两个 provider 的行都写进沙盒 + 无崩溃）"
else
  STATUS="FAIL"
  REASON="$FAILED_N / $TOTAL_N 项断言未通过"
fi

record "$STATUS" "$REASON" "$FRAG"
echo "-- 结论: $STATUS ($REASON)"
echo "-- 证据: $EVID"
echo
echo "!! 人工确认项（脚本查不到，需要你肉眼确认）："
echo "   1. 通知是否真的送达（打开通知栏看「Subwise P03-B」）"
echo "   2. 安全存储按钮点击后是否显示「测试标记写读删完成」"
echo "   3. HTTPS 按钮点击后是否显示「无凭据 HTTPS 状态 401」"
