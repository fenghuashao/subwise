"""P03-B1 汇总器的 CLI 回归。使用合成证据，不需要连接设备。"""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

COLLECT = (Path(__file__).resolve().parents[1] / "collect-device-evidence.sh").as_posix()
CHECKS = {
    "android": dict.fromkeys(("appLaunched", "dataPersistedAfterReread", "snapshotSurvivesCorrupt", "writeClicked",
                              "writeCompleted", "rereadClicked", "rereadCompleted", "corruptClicked", "corruptResponseRejected",
                              "secureStoragePassed", "httpsProbe401", "notificationScheduled", "noFatalException"), True),
    "ios": dict.fromkeys(("installed", "launched", "bothProvidersStored", "currentWriteObserved", "persistedAfterRestart"), True),
    "harmony": dict.fromkeys(("appLaunched", "writeActionAcknowledged", "bothProvidersStored", "freshWriteVerified",
                              "persistedAfterRestart", "screenshotTaken", "processAlive", "noFatalInLog"), True),
}
SIMULATOR_CHECKS = dict.fromkeys(("appLaunched", "processAlive", "screenshotTaken", "sqliteBaselineRead",
                                  "bothProvidersStored", "currentWriteObserved", "interactionWasAutomated"), True)


class CollectDeviceEvidenceTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)

    def write(self, platform, kind="physical", *, folder=None, filename=None, **changes):
        group = self.root / (folder or platform)
        group.mkdir(exist_ok=True)
        if filename is None:
            filename = {
                "android": "android-device-evidence.json",
                "ios": "ios-simulator-evidence.json" if kind == "simulator" else "ios-physical-device-evidence.json",
                "harmony": "harmony-device-evidence.json",
            }[platform]
        checks = SIMULATOR_CHECKS if platform == "ios" and kind == "simulator" else CHECKS[platform]
        evidence = {"platform": platform, "deviceKind": kind, "status": "PASS", "checks": checks, **changes}
        (group / filename).write_text(json.dumps(evidence), encoding="utf-8")
        return group

    def collect(self, *folders):
        command = [shutil.which("bash") or "bash", COLLECT, "summary.json", *(p.name for p in folders)]
        process = subprocess.run(command, cwd=self.root, capture_output=True, timeout=30)
        self.assertEqual(process.returncode, 0, process.stderr.decode("utf-8", errors="replace"))
        return json.loads((self.root / "summary.json").read_text(encoding="utf-8"))

    def test_three_unique_physical_results_pass_both_gates(self):
        result = self.collect(*(self.write(p) for p in CHECKS))
        self.assertEqual(result["summary"]["platformsTotal"], 3)
        self.assertEqual(result["summary"]["overall"], "PASS")
        self.assertEqual(result["summary"]["physicalOverall"], "PASS")

    def test_omitting_each_required_platform_is_incomplete(self):
        empty = self.collect()
        self.assertEqual(empty["summary"]["missing"], 3)
        self.assertEqual(empty["summary"]["overall"], "INCOMPLETE")
        for absent in CHECKS:
            with self.subTest(absent=absent):
                result = self.collect(*(self.write(p) for p in CHECKS if p != absent))
                self.assertEqual(result["platforms"][absent]["status"], "MISSING")
                self.assertEqual(result["summary"]["overall"], "INCOMPLETE")

    def test_single_result_and_duplicate_input_cannot_satisfy_all_platforms(self):
        android = self.write("android")
        result = self.collect(android)
        self.assertEqual(result["summary"]["passed"], 1)
        self.assertEqual(result["summary"]["missing"], 2)
        self.assertEqual(result["summary"]["overall"], "INCOMPLETE")
        result = self.collect(android, android, android)
        self.assertEqual(result["platforms"]["android"]["status"], "DUPLICATE")
        self.assertEqual(result["summary"]["overall"], "INCOMPLETE")

    def test_duplicate_in_other_directory_invalidates_a_complete_set(self):
        android, ios, harmony = (self.write(p) for p in CHECKS)
        copy = self.root / "copied"
        shutil.copytree(android, copy)
        result = self.collect(android, ios, harmony, copy)
        self.assertEqual(result["platforms"]["android"]["status"], "DUPLICATE")
        self.assertEqual(result["summary"]["overall"], "INCOMPLETE")
        self.assertEqual(result["summary"]["physicalOverall"], "INCOMPLETE")

    def test_simulator_and_physical_results_can_share_directory(self):
        android, harmony = self.write("android"), self.write("harmony")
        ios = self.write("ios", "simulator")
        self.write("ios", "physical", targetKind="physical", deviceKind=None, status="NOT_RUN", checks={})
        result = self.collect(android, ios, harmony)
        self.assertEqual(set(result["platforms"]["ios"]["evidence"]), {"simulator", "physical"})
        self.assertEqual(result["platforms"]["ios"]["physicalStatus"], "NOT_RUN")
        self.assertEqual(result["summary"]["overall"], "PASS")
        self.assertEqual(result["summary"]["physicalOverall"], "INCOMPLETE")
        self.write("ios", "physical")
        self.assertEqual(self.collect(android, ios, harmony)["summary"]["physicalOverall"], "PASS")

    def test_non_pass_and_unreadable_inputs_remain_incomplete(self):
        android, harmony = self.write("android"), self.write("harmony")
        for status in ("PARTIAL", "ERROR", "NOT_RUN", "FAIL"):
            with self.subTest(status=status):
                ios = self.write("ios", status=status, checks={})
                result = self.collect(android, ios, harmony)
                self.assertEqual(result["platforms"]["ios"]["status"], status)
                self.assertEqual(result["summary"]["overall"], "INCOMPLETE")
        ios = self.write("ios")
        result = self.collect(android, ios, harmony, self.root / "missing-folder")
        self.assertTrue(result["inputIssues"])
        self.assertEqual(result["summary"]["overall"], "INCOMPLETE")

    def test_a_failing_ios_target_is_visible_despite_other_target_passing(self):
        android, harmony = self.write("android"), self.write("harmony")
        ios = self.write("ios", "simulator")
        for status in ("FAIL", "ERROR"):
            with self.subTest(status=status):
                self.write("ios", "physical", status=status, checks={})
                result = self.collect(android, ios, harmony)
                self.assertEqual(result["platforms"]["ios"]["status"], status)
                self.assertEqual(result["summary"]["overall"], "INCOMPLETE")

    def test_current_pass_requires_device_kind_and_platform_specific_functional_checks(self):
        for platform, kind, strip in [("android", "physical", "writeCompleted"),
                                     ("ios", "simulator", "currentWriteObserved"),
                                     ("ios", "physical", "installed"), ("harmony", "physical", "freshWriteVerified")]:
            with self.subTest(platform=platform, kind=kind):
                checks = (SIMULATOR_CHECKS if kind == "simulator" else CHECKS[platform]).copy()
                del checks[strip]
                folder = self.write(platform, kind, checks=checks, folder=platform + kind)
                self.assertEqual(self.collect(folder)["platforms"][platform]["status"], "INVALID")
        android = self.write("android", deviceKind=None)
        self.assertEqual(self.collect(android)["platforms"]["android"]["status"], "INVALID")
        physical = self.write("ios", checks={"installed": True, "launched": True})
        self.assertEqual(self.collect(physical)["platforms"]["ios"]["physicalStatus"], "INVALID")

    def test_malformed_or_mislabeled_evidence_never_passes(self):
        android, harmony = self.write("android"), self.write("harmony")
        ios = self.write("ios")
        filename = ios / "ios-physical-device-evidence.json"
        for contents in [
            "{", "null", json.dumps({"status": "PASS"}),
            json.dumps({"platform": "android", "status": "PASS", "checks": CHECKS["android"]}),
            json.dumps({"platform": "ios", "deviceKind": "simulator", "status": "PASS", "checks": CHECKS["ios"]}),
            json.dumps({"platform": "ios", "deviceKind": "physical", "status": "PASS", "checks": {}}),
            json.dumps({"platform": "ios", "deviceKind": "physical", "status": "PASS", "checks": {"bothProvidersStored": False}}),
        ]:
            with self.subTest(contents=contents):
                filename.write_text(contents, encoding="utf-8")
                result = self.collect(android, ios, harmony)
                self.assertEqual(result["platforms"]["ios"]["status"], "INVALID")
                self.assertEqual(result["summary"]["overall"], "INCOMPLETE")
        filename.unlink()
        (ios / "copied-evidence.json").write_text('{"status":"PASS"}', encoding="utf-8")
        self.assertEqual(self.collect(android, ios, harmony)["platforms"]["ios"]["status"], "MISSING")

    def test_legacy_results_preserve_only_supported_claims(self):
        android = self.write("android")
        ios = self.write("ios", filename="ios-device-evidence.json")
        harmony = self.write("harmony")
        fixtures = [
            (android / "android-device-evidence.json", {"status": "PASS", "checks": {"dataPersistedAfterReread": True, "snapshotSurvivesCorrupt": True}}),
            (ios / "ios-device-evidence.json", {"status": "PASS", "isRealDevice": False, "checks": {"bothProvidersStored": True}}),
            (harmony / "harmony-device-evidence.json", {"status": "PASS", "checks": {"bothProvidersStored": True}}),
        ]
        for path, record in fixtures:
            path.write_text(json.dumps(record), encoding="utf-8")
        result = self.collect(android, ios, harmony)
        self.assertEqual(result["platforms"]["android"]["physicalStatus"], "MISSING")
        self.assertEqual(result["platforms"]["android"]["status"], "PARTIAL")
        legacy_ios = result["platforms"]["ios"]["evidence"]["simulator"][0]
        self.assertEqual(legacy_ios["status"], "PARTIAL")
        self.assertEqual(legacy_ios["reportedStatus"], "PASS")
        self.assertEqual(result["platforms"]["harmony"]["status"], "PARTIAL")
        self.assertEqual(result["summary"]["overall"], "INCOMPLETE")
        self.assertEqual(result["summary"]["physicalOverall"], "INCOMPLETE")


if __name__ == "__main__":
    unittest.main()
