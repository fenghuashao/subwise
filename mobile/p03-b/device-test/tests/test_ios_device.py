"""Exercise the iOS evidence producer with isolated SQLite and fake Xcode commands."""
import json
import os
import shlex
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "verify-ios-device.sh"
BASH = shutil.which("bash") if os.name != "nt" else str(Path(os.environ["ProgramFiles"]) / "Git/bin/bash.exe")

XCRUN = """#!/bin/sh
echo "$*" >> calls
case "$1 $2 $3" in
'simctl list devices')
  cat sim.json ;;
'devicectl list devices')
  cp physical.json "$5" ;;
'devicectl device install'|'devicectl device process')
  exit 0 ;;
'simctl boot sim'|'simctl bootstatus sim'|'simctl terminate sim')
  exit 0 ;;
'simctl install sim')
  [ "$MODE" != bad-install ] ;;
'simctl launch sim')
  echo "dev.subwise.test: 72" ;;
'simctl spawn sim')
  echo "72 0 UIKitApplication:dev.subwise.test" ;;
'simctl get_app_container sim')
  echo data ;;
'simctl io sim')
  if [ "$MODE" = no-shot ]; then exit 1; fi
  echo current > "$5" ;;
*) exit 1 ;;
esac
"""
IDB = """#!/bin/sh
case "$2" in
  describe-all)
    if [ "$MODE" = duplicate-ok ] && [ -e tapped ]; then
      echo '[{"AXLabel":"模拟适配器 → SQLite → UI 完成；非平台同步"}]'
    else
      cat <<'JSON'
[
  {"AXLabel":"SQLite 已打开 · 已读取本地记录"},
  {"AXLabel":"本地暂无快照；点击写入模拟数据开始验证。","frame":{"x":0,"y":0,"width":10,"height":10}},
  {"AXLabel":"写入模拟数据并从 SQLite 读取","type":"StaticText","frame":{"x":10,"y":10,"width":10,"height":10}},
  {"AXLabel":"写入模拟数据并从 SQLite 读取","type":"Button","frame":{"x":20,"y":20,"width":0,"height":10}},
  {"AXLabel":"写入模拟数据并从 SQLite 读取","type":"Button","frame":{"x":40,"y":10,"width":20,"height":10}}
]
JSON
    fi ;;
  tap)
    [ "$3 $4 $5 $6" = "--udid sim 50 15" ] || exit 1
    touch tapped
    if [ "$MODE" = first-write ]; then python3 seed.py; fi ;;
esac
"""


class IosProducerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name in ("bin", "Probe.app", "data", "out"):
            (self.root / name).mkdir()
        self.command("python3", "#!/bin/sh\nexec " + shlex.quote(Path(sys.executable).as_posix()) + ' "$@"\n')
        self.command("xcrun", XCRUN)
        self.command("idb", IDB)
        self.command("sleep", "#!/bin/sh\nexit 0\n")
        (self.root / "sim.json").write_text(json.dumps({
            "devices": {"com.apple.CoreSimulator.SimRuntime.iOS-26-0": [
                {"name": "iPhone 17", "udid": "sim", "isAvailable": True},
            ]}}), encoding="utf-8")
        (self.root / "physical.json").write_text(json.dumps({"result": {"devices": [{
            "identifier": "core-id", "hardwareProperties": {
                "reality": "physical", "platform": "iOS", "udid": "physical-id"}}]}}), encoding="utf-8")
        self.db = self.root / "data/subwise-p03b.db"
        with sqlite3.connect(self.db) as db:
            db.execute("CREATE TABLE snapshots(id TEXT PRIMARY KEY, provider TEXT, payload TEXT)")
        (self.root / "seed.py").write_text(
            'import sqlite3,json\nwith sqlite3.connect("data/subwise-p03b.db") as db:\n'
            '    for p in ("deepseek","minimax"):\n'
            '        db.execute("INSERT OR IGNORE INTO snapshots VALUES(?,?,?)",'
            ' (p,p,json.dumps({"provider":p,"items":[1]})))\n', encoding="utf-8")

    def command(self, name, body):
        path = self.root / "bin" / name
        path.write_bytes(body.encode("utf-8"))
        path.chmod(0o755)

    def invoke(self, *args, mode="first-write", expected_code=0):
        env = dict(os.environ, MODE=mode, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
        # Let Bash prepend the relative shim path (also works with MSYS path conversion).
        result = subprocess.run([BASH, "-c", 'export PATH="$PWD/bin:$PATH"; exec bash "$@"', "--",
                                 SCRIPT.as_posix(), "--out", "out", "--app", "Probe.app",
                                 "--bundle", "dev.subwise.test", *args], cwd=self.root,
                                env=env, capture_output=True, encoding="utf-8", timeout=30,
                                stdin=subprocess.DEVNULL)
        self.assertEqual(result.returncode, expected_code, result.stdout + result.stderr)
        return sorted(p.name for p in (self.root / "out").glob("*-evidence.json"))

    def evidence(self, kind):
        name = "simulator" if kind == "simulator" else "physical-device"
        return json.loads((self.root / f"out/ios-{name}-evidence.json").read_text(encoding="utf-8"))

    def test_separate_outputs_and_distinct_drivers(self):
        self.invoke("--device", "sim")
        sim = self.evidence("simulator")
        self.assertEqual((sim["platform"], sim["deviceKind"], sim["status"]), ("ios", "simulator", "PASS"))
        self.assertEqual(sim["launchPid"], 72)
        self.assertEqual(sim["sqlite"]["newProviders"], ["deepseek", "minimax"])
        (self.root / "calls").write_text("", encoding="utf-8")
        self.invoke("--kind", "physical", "--device", "physical-id")
        phy = self.evidence("physical")
        self.assertEqual((phy["platform"], phy["deviceKind"], phy["status"]), ("ios", "physical", "PARTIAL"))
        calls = (self.root / "calls").read_text()
        self.assertIn("devicectl device install app --device physical-id", calls)
        self.assertNotIn("simctl", calls)
        self.assertEqual(self.evidence("simulator"), sim)

    def test_unknown_device_cannot_be_promoted(self):
        self.assertEqual(self.invoke("--device", "phys", expected_code=2), [])
        self.invoke("--kind", "physical", "--device", "sim")
        result = self.evidence("physical")
        self.assertEqual((result["targetKind"], result["deviceKind"], result["status"]),
                         ("physical", None, "NOT_RUN"))
        self.assertNotIn(" install ", (self.root / "calls").read_text())

    def test_failed_install_cannot_reuse_existing_app(self):
        self.invoke(mode="bad-install")
        self.assertEqual(self.evidence("simulator")["status"], "FAIL")
        self.assertNotIn("simctl launch", (self.root / "calls").read_text())

    def test_stale_rows_and_screenshot_cannot_pass(self):
        self.invoke()
        self.invoke(mode="stale")
        stale = self.evidence("simulator")
        self.assertEqual(stale["status"], "FAIL")
        self.assertFalse(stale["checks"]["currentWriteObserved"])
        (self.root / "tapped").unlink()
        self.invoke(mode="duplicate-ok")
        self.assertEqual(self.evidence("simulator")["status"], "PASS")
        self.invoke(mode="no-shot")
        result = self.evidence("simulator")
        self.assertEqual(result["status"], "FAIL")
        self.assertIsNone(result["screenshot"])


if __name__ == "__main__":
    unittest.main()
