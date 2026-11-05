#!/usr/bin/env bash
# 用法：collect-device-evidence.sh <输出 JSON> [证据目录...]
# 每个目录可以放多个目标的证据，例如同一目录里的 iOS 模拟器和真机结果。
set -eu

if [[ $# -lt 1 ]]; then
  echo "用法：$0 <输出json> [证据目录...]" >&2
  exit 2
fi

python3 - "$@" <<'PY'
import datetime
import json
import sys
import tempfile
from collections import Counter
from pathlib import Path

PLATFORMS = ("android", "ios", "harmony")
FILES = {
    "android-device-evidence.json": ("android", None),
    "ios-simulator-evidence.json": ("ios", "simulator"),
    "ios-physical-device-evidence.json": ("ios", "physical"),
    "ios-device-evidence.json": ("ios", None),  # 旧版只执行 simctl
    "harmony-device-evidence.json": ("harmony", None),
}
PASSING = {"PASS"}
STATUSES = PASSING | {"PARTIAL", "FAIL", "NOT_RUN", "ERROR"}
ANDROID_LEGACY = {"dataPersistedAfterReread", "snapshotSurvivesCorrupt"}
ANDROID_CHECKS = ANDROID_LEGACY | {
    "appLaunched", "writeClicked", "writeCompleted", "rereadClicked", "rereadCompleted", "corruptClicked",
    "corruptResponseRejected", "secureStoragePassed", "httpsProbe401", "notificationScheduled", "noFatalException",
}
HARMONY_CHECKS = {"appLaunched", "writeActionAcknowledged", "bothProvidersStored", "freshWriteVerified",
                  "persistedAfterRestart", "screenshotTaken", "processAlive", "noFatalInLog"}
IOS_SIMULATOR_CHECKS = {"appLaunched", "processAlive", "screenshotTaken", "sqliteBaselineRead",
                        "bothProvidersStored", "currentWriteObserved", "interactionWasAutomated"}
# 现有 devicectl 路径只验证 installed/launched，给出 PARTIAL。
IOS_PHYSICAL_CHECKS = {"installed", "launched", "bothProvidersStored", "currentWriteObserved", "persistedAfterRestart"}


def read_record(path, platform, target):
    with path.open(encoding="utf-8") as stream:
        ev = json.load(stream)
    if not isinstance(ev, dict) or ev.get("status") not in STATUSES:
        raise ValueError("证据缺少有效 status")
    status = ev["status"]
    legacy = "platform" not in ev
    if ev.get("platform", platform) != platform or (legacy and target):
        raise ValueError("platform 与固定证据文件名不符")

    kind = ev.get("deviceKind")
    if kind is not None and kind not in ("simulator", "physical", "unknown"):
        raise ValueError("deviceKind 无效")
    if not legacy and status in PASSING and kind is None:
        raise ValueError("新版 PASS 缺少 deviceKind")
    if target:
        if ev.get("targetKind", target) != target or (kind is not None and kind != target):
            raise ValueError("文件名、targetKind 与实际 deviceKind 不一致")
        if kind is None and (status not in ("NOT_RUN", "ERROR") or ev.get("targetKind") != target):
            raise ValueError("未识别设备须记录明确目标及 NOT_RUN/ERROR")
    elif platform == "ios":
        # 旧版 isRealDevice 只是 devicectl 列表探测，后续安装/启动/查库一律使用 simctl。
        if not legacy:
            raise ValueError("新版 iOS 证据须使用目标专属文件名")
        kind = "simulator" if ev.get("isRealDevice") is False else "unknown"
    elif legacy:
        kind = "unknown"
    if "isRealDevice" in ev and kind in ("simulator", "physical"):
        if ev["isRealDevice"] is not (kind == "physical"):
            raise ValueError("isRealDevice 与实际 deviceKind 冲突")

    checks = ev.get("checks", {})
    if not isinstance(checks, dict) or any(type(value) is not bool for value in checks.values()):
        raise ValueError("checks 必须是布尔断言")
    passed, total = sum(checks.values()), len(checks)
    counts = {"checksPassed": passed, "checksTotal": total, "checksFailed": total - passed}
    for key, count in counts.items():
        if key in ev and (type(ev[key]) is not int or ev[key] != count):
            raise ValueError(f"{key} 与 checks 不一致")
    record = dict(ev, evidenceFile=str(path), deviceKind=kind, **counts)
    if status in PASSING:
        if not total or passed != total:
            raise ValueError("PASS 要求有功能断言且全部通过")
        if legacy:
            markers = ANDROID_LEGACY if platform == "android" else {"bothProvidersStored"}
            if not markers.issubset(checks):
                raise ValueError("旧版 PASS 缺少可识别的功能断言")
            record.update(status="PARTIAL", reportedStatus=status,
                          reason="旧版证据缺少本轮操作验证，保留原判定供复核")
        else:
            required = {"android": ANDROID_CHECKS,
                        "harmony": HARMONY_CHECKS,
                        "ios": IOS_SIMULATOR_CHECKS if target == "simulator" else IOS_PHYSICAL_CHECKS}[platform]
            if not required.issubset(checks):
                raise ValueError("PASS 缺必测断言：" + ", ".join(sorted(required.difference(checks))))
    return target or kind or "unknown", record


out = Path(sys.argv[1])
groups = {platform: {} for platform in PLATFORMS}
issues = []
for arg in sys.argv[2:]:
    folder = Path(arg)
    recognized = False
    for filename, (platform, target) in FILES.items():
        path = folder / filename
        if not path.is_file():
            continue
        if path.resolve() == out.resolve():
            sys.exit("输出路径与输入证据相同")
        recognized = True
        try:
            slot, record = read_record(path, platform, target)
        except (OSError, ValueError, TypeError) as exc:
            slot = target or "unknown"
            record = {"evidenceFile": str(path), "status": "INVALID", "reason": str(exc)}
            issues.append(f"{path}: {exc}")
        groups[platform].setdefault(slot, []).append(record)
    if not recognized:
        issues.append(f"{folder}: 缺少可识别的证据文件")


def group_status(records):
    if not records:
        return "MISSING"
    if len(records) > 1:
        return "DUPLICATE"
    return records[0]["status"]


platforms = {}
for platform, targets in groups.items():
    by_kind = {slot: group_status(records) for slot, records in targets.items()}
    for slot, status in by_kind.items():
        if status == "DUPLICATE":
            issues.append(f"{platform}/{slot}: 同一目标提交了多份证据")
    statuses = set(by_kind.values())
    # 尚未测完另一目标时保留已有验证；任一目标的明确失败须在平台层可见。
    priority = ("INVALID", "DUPLICATE", "FAIL", "ERROR", "PASS", "PARTIAL", "NOT_RUN")
    platforms[platform] = {
        "status": next((s for s in priority if s in statuses), "MISSING"),
        "physicalStatus": by_kind.get("physical", "MISSING"),
        "evidence": targets,
    }

statuses = [p["status"] for p in platforms.values()]
counts = Counter(statuses)
overall = "PASS" if not issues and all(s in PASSING for s in statuses) else "INCOMPLETE"
physical = "PASS" if not issues and all(p["physicalStatus"] in PASSING for p in platforms.values()) else "INCOMPLETE"
summary = {
    "platformsTotal": len(PLATFORMS), "statuses": statuses,
    "passed": counts["PASS"], "failed": counts["FAIL"], "partial": counts["PARTIAL"],
    "notRun": counts["NOT_RUN"], "error": counts["ERROR"], "missing": counts["MISSING"],
    "invalid": counts["INVALID"], "duplicate": counts["DUPLICATE"],
    "overall": overall, "physicalOverall": physical,
    "note": "overall 要求每个平台至少一个目标功能 PASS 且无 FAIL/ERROR，physicalOverall 仅统计明确的真机 PASS。输入错误或同目标重复会阻断两项。",
}
result = {"generatedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "platforms": platforms, "inputIssues": issues, "summary": summary}
with tempfile.TemporaryDirectory(dir=out.parent) as scratch:
    temporary = Path(scratch) / "summary.json"
    temporary.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(out)
for platform, info in platforms.items():
    print(f"{platform}: 功能 {info['status']} / 真机 {info['physicalStatus']}")
for issue in issues:
    print(issue)
print(f"三端功能: {overall} / 三端真机: {physical}")
print("已写入:", out)
PY
