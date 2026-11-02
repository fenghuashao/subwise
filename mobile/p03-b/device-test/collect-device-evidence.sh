#!/usr/bin/env bash
# Subwise P03-B 设备端证据汇总器（2026-11-02）
#
# 用途：把三台设备上跑出来的证据目录合并成一份机器可读的汇总 JSON，
#       方便交给服务端（或者人）统一复核与归档。
#
# 用法：
#   bash mobile/p03-b/device-test/collect-device-evidence.sh <输出json> <证据目录...>
#
# 例：
#   bash mobile/p03-b/device-test/collect-device-evidence.sh \
#     evidence-device-summary.json \
#     evidence-android evidence-ios evidence-harmony
#
# 每个证据目录里应有一个 *-evidence.json，本脚本会：
#   * 读取其 status / reason / checks
#   * 统计三端各自 PASS/FAIL/NOT_RUN/ERROR
#   * **拒绝**把 NOT_RUN / ERROR 统计成 PASS
#   * 汇总一份总判定

set -uo pipefail

if [[ $# -lt 2 ]]; then
  echo "用法：$0 <输出json> <证据目录...>" >&2
  exit 2
fi

OUT="$1"; shift

python3 - "$OUT" "$@" <<'PY'
import datetime, glob, json, os, sys

out_path = sys.argv[1]
dirs = sys.argv[2:]

PLATFORMS = {
    "android": ("android-device-evidence.json", "Android 设备"),
    "ios":     ("ios-device-evidence.json",     "iOS 设备"),
    "harmony": ("harmony-device-evidence.json", "HarmonyOS 设备"),
}

# status → 是否算「通过」。只有 PASS 算通过，NOT_RUN / ERROR 一律不算。
PASSING = {"PASS"}

def find_evidence(d):
    for name, _ in PLATFORMS.values():
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    cands = glob.glob(os.path.join(d, "*evidence*.json"))
    return cands[0] if cands else None

result = {
    "generatedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "platforms": {},
    "summary": {},
}

statuses = []
for d in dirs:
    if not os.path.isdir(d):
        result["platforms"][d] = {"status": "MISSING", "reason": "证据目录不存在：%s" % d}
        statuses.append("MISSING")
        continue
    p = find_evidence(d)
    if not p:
        result["platforms"][d] = {"status": "MISSING", "reason": "目录里没有证据 JSON"}
        statuses.append("MISSING")
        continue
    try:
        ev = json.load(open(p, encoding="utf-8"))
    except Exception as e:
        result["platforms"][d] = {"status": "UNREADABLE", "reason": str(e), "evidenceFile": p}
        statuses.append("UNREADABLE")
        continue

    st = ev.get("status", "UNKNOWN")
    checks = ev.get("checks") or {}
    passed = ev.get("checksPassed")
    total = ev.get("checksTotal")
    if passed is None and checks:
        passed = sum(1 for v in checks.values() if v)
        total = len(checks)

    result["platforms"][d] = {
        "evidenceFile": p,
        "status": st,
        "reason": ev.get("reason"),
        "checks": checks,
        "checksPassed": passed,
        "checksTotal": total,
        "checksFailed": (total - passed) if (passed is not None and total is not None) else None,
        "device": ev.get("device"),
        "extra": {k: v for k, v in ev.items()
                  if k not in ("status", "reason", "checks", "checksPassed", "checksTotal",
                               "checksFailed", "device", "generatedAtUtc", "note")},
    }
    statuses.append(st)

n_total = len(dirs)
n_pass = sum(1 for s in statuses if s in PASSING)
n_notrun = sum(1 for s in statuses if s == "NOT_RUN")
n_error = sum(1 for s in statuses if s == "ERROR")
n_fail = sum(1 for s in statuses if s == "FAIL")
n_partial = sum(1 for s in statuses if s == "PARTIAL")
n_missing = sum(1 for s in statuses if s in ("MISSING", "UNREADABLE"))

result["summary"] = {
    "platformsTotal": n_total,
    "passed": n_pass,
    "failed": n_fail,
    "notRun": n_notrun,
    "error": n_error,
    "partial": n_partial,
    "missing": n_missing,
    "statuses": statuses,
    # 只有全部 PASS 才是 PASS。任何 NOT_RUN / ERROR / FAIL / MISSING 都不算通过。
    "overall": "PASS" if (n_total > 0 and n_pass == n_total) else "INCOMPLETE",
    "note": ("overall=PASS 要求每一端都是 PASS。"
             "PARTIAL（部分完成，如需人工点击）、NOT_RUN（环境不具备）、"
             "ERROR（脚本自身崩溃）、FAIL（断言未过）、"
             "MISSING（没跑或没给证据）一律不算通过。"),
}

json.dump(result, open(out_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

print("=== 三端设备验证汇总 ===")
for d, v in result["platforms"].items():
    line = "  %-24s %-10s" % (os.path.basename(d.rstrip("/")), v.get("status"))
    if v.get("checksPassed") is not None:
        line += " %s/%s" % (v.get("checksPassed"), v.get("checksTotal"))
    if v.get("reason"):
        line += "  — " + str(v["reason"])[:80]
    print(line)
print()
print("整体:", result["summary"]["overall"],
      "(通过 %d / 共 %d；PARTIAL %d，NOT_RUN %d，ERROR %d，FAIL %d，缺失 %d)" % (
          n_pass, n_total, n_partial, n_notrun, n_error, n_fail, n_missing))
print("已写入:", out_path)
PY
