#!/usr/bin/env bash
# HarmonyOS 原生探针 —— Linux 本机编译校验
#
# 背景：HARMONY-TRACK 记录「未定位可执行的 DevEco/Hvigor/Harmony SDK」，
#       鸿蒙端长期 NOT_RUN。本脚本自助获取华为官方 Linux 命令行工具链，
#       在无 DevEco GUI 的 Linux 主机上完成真实 ArkTS 编译，并产出机器可读证据。
#
# 说明很重要，以免过读结果：
#   * 本脚本使用的是官方 HarmonyOS SDK（非第三方移植、非 Android 兼容层）。
#   * 产出是**未签名** HAP。signed/安装/运行/通知送达一概 NOT_RUN，
#     本脚本不会也不应把它们标成通过。
#
# 环境变量：
#   OHOS_CLT_HOME  命令行工具链解压根目录      默认 /opt/ohos-clt
#   CLT_VERSION    工具链版本                  默认 5.1.0.840
#   EVIDENCE_DIR   证据输出目录                默认 工程根/.local/evidence
#   SKIP_DOWNLOAD  已有工具链时跳过下载，设为 1
#
# 依赖：unzip、java(JRE 17+)、curl、python3

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ="$(cd "$HERE/.." && pwd)"

CLT_VERSION="${CLT_VERSION:-5.1.0.840}"
OHOS_CLT_HOME="${OHOS_CLT_HOME:-/opt/ohos-clt}"
# 下载包固定 SHA-256；下载后必须比对，避免用来源不明的工具链产出"通过"结论。
CLT_ZIP_SHA256="${CLT_ZIP_SHA256:-1dcefa4741dc289277560b2802040e0c45b433898d8db453d711d5376e0478f1}"
CLT_ZIP_SIZE="${CLT_ZIP_SIZE:-2153496473}"
CLT_URL="https://repo.huaweicloud.com/harmonyos/ohpm/5.1.0/commandline-tools-linux-x64-${CLT_VERSION}.zip"
EVIDENCE_DIR="${EVIDENCE_DIR:-$PROJ/.local/evidence}"
SKIP_DOWNLOAD="${SKIP_DOWNLOAD:-0}"

CLT="$OHOS_CLT_HOME/command-line-tools"
LOG="$EVIDENCE_DIR/build.log"
mkdir -p "$EVIDENCE_DIR"

write_evidence() { # $1=status $2=reason $3=hap $4=errorcount
  STATUS="$1" REASON="$2" HAP="$3" ERRS="$4" WARN="${WARN_COUNT:-0}" \
  GLOG="$LOG" python3 - "$EVIDENCE_DIR/harmony-build.json" <<'PY'
import json, os, sys, hashlib, datetime
from pathlib import Path
env = os.environ.get
hap = env("HAP", "")
d = {
  "generatedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "status": env("STATUS"),
  "reason": env("REASON") or None,
  "buildLog": env("GLOG"),
}
if hap and Path(hap).exists():
    raw = Path(hap).read_bytes()
    d["hap"] = {
      "path": str(Path(hap)),
      "bytes": len(raw),
      "sha256": hashlib.sha256(raw).hexdigest(),
      "signed": "unsigned" not in Path(hap).name,
    }
d["diagnostics"] = {"errors": int(env("ERRS") or 0), "warnings": int(env("WARN") or 0)}
json.dump(d, open(sys.argv[1], "w"), indent=2, ensure_ascii=False)
print(json.dumps(d, indent=2, ensure_ascii=False))
PY
}

echo "== Subwise HarmonyOS 编译校验 =="
echo "工程: $PROJ"
echo "证据: $EVIDENCE_DIR"

for tool in python3 curl unzip java; do
  command -v "$tool" >/dev/null 2>&1 || { echo "缺少依赖: $tool"; write_evidence "NOT_RUN" "缺少依赖 $tool" "" 0; exit 0; }
done

if [[ "$SKIP_DOWNLOAD" != "1" && ! -f "$CLT/bin/hvigorw" ]]; then
  ZIP="$OHOS_CLT_HOME/clt.zip"
  mkdir -p "$OHOS_CLT_HOME"
  echo "-- 下载命令行工具链 $CLT_VERSION"
  if ! curl -fSL -o "$ZIP" "$CLT_URL"; then
    write_evidence "NOT_RUN" "工具链下载失败" "" 0; exit 0
  fi
  SIZE=$(stat -c%s "$ZIP")
  SHA=$(python3 -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$ZIP")
  echo "   size=$SIZE sha256=$SHA"
  if [[ "$SHA" != "$CLT_ZIP_SHA256" || "$SIZE" != "$CLT_ZIP_SIZE" ]]; then
    echo "   !! 与记录值不一致，拒绝使用"
    write_evidence "NOT_RUN" "工具链包校验不通过" "" 0; exit 0
  fi
  echo "-- 解压"
  unzip -q -o "$ZIP" -d "$OHOS_CLT_HOME" && rm -f "$ZIP"
fi

[[ -f "$CLT/bin/hvigorw" ]] || { write_evidence "NOT_RUN" "未找到 hvigorw" "" 0; exit 0; }
chmod +x "$CLT/bin/hvigorw" "$CLT/tool/node/bin/node" 2>/dev/null || true

export PATH="$CLT/bin:$CLT/tool/node/bin:$CLT/sdk/default/openharmony/toolchains:$PATH"
export OHOS_BASE_SDK_HOME="$CLT/sdk"

echo "-- 工具链版本"
sed 's/^/   /' "$CLT/version.txt"
echo "   hvigorw: $(hvigorw --version 2>&1 | head -1)"

# 干净构建：清掉上次产物，避免"看起来通过"其实是残留
rm -rf "$PROJ/.hvigor" "$PROJ/build" "$PROJ/entry/build" "$PROJ/entry/.preview" 2>/dev/null

echo "-- 编译 assembleHap"
cd "$PROJ"
hvigorw assembleHap --mode module -p product=default --no-daemon > "$LOG" 2>&1
RC=$?
tail -20 "$LOG" | sed 's/^/   /'

ERRS=$(python3 - "$LOG" <<'PY'
import re, sys
# 先剥掉 hvigor 日志里的 ANSI 颜色转义码再做正则，否则 "> hvigor \x1b[33mWARN\x1b[0m:"
# 这类行会匹配不上，导致把有告警的构建误记成零告警。
ANSI = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')
t = ANSI.sub('', open(sys.argv[1], errors='replace').read())
m = re.search(r'COMPILE RESULT:\s*(.+)', t)
n = 0
if m:
    mm = re.search(r'ERROR:(\d+)', m.group(1))
    if mm: n = int(mm.group(1))
else:
    n = len(re.findall(r'^\s*\d+\s+ERROR:', t, re.M))
print(n)
PY
)
WARN_COUNT=$(python3 - "$LOG" <<'PY'
import re, sys
ANSI = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')
t = ANSI.sub('', open(sys.argv[1], errors='replace').read())
# 统计两类告警：ArkTS 编号诊断(N WARN:) 与 hvigor 工程告警(> hvigor WARN:)。
# 只统计前者会漏掉 SemVer / 未配置签名等工程级告警，导致证据失真。
print(len(re.findall(r'^\s*\d+\s+WARN:', t, re.M)) +
      len(re.findall(r'>\s*hvigor\s+WARN:', t, re.M)))
PY
)
echo "   诊断: ERROR=$ERRS WARN=$WARN_COUNT"

if [[ $RC -ne 0 || $ERRS -ne 0 ]]; then
  echo "-- 编译未通过"
  write_evidence "FAIL" "hvigor 退出码 $RC / 编译错误 $ERRS" "" "$ERRS"
  exit 0
fi

HAP=$(find "$PROJ" -name '*.hap' | head -1)
[[ -n "$HAP" ]] || { write_evidence "FAIL" "编译报成功但未找到 hap 产物" "" "$ERRS"; exit 0; }

echo "-- 产物核验"
write_evidence "COMPILE_OK" "" "$HAP" "$ERRS"
echo
echo "状态：ArkTS 编译通过，产出未签名 HAP。"
echo "安装 / 运行 / 通知送达 / 签名发布 仍为 NOT_RUN。"
