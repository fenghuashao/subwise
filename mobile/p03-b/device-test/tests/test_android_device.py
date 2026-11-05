import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET


SCRIPT = Path(__file__).resolve().parents[1] / "verify-android-device.sh"
PKG = "dev.subwise.p03b"
BUTTONS = ["写入模拟数据", "重新读取本地 SQLite", "模拟响应损坏", "我的",
           "安全存储", "HTTPS 无凭据探针（预期 401）", "请求通知权限"]
RESULTS = ["SQLite 已打开", "模拟适配器 → SQLite → UI 完成", "已重新读取本地快照",
           "验证失败 · 已保留最后成功记录", "", "安全存储写 / 读 / 删通过",
           "HTTPS HTTP 401 · 符合预期 · 未认证", "调度 API 返回成功"]

# Each successful tap selects the *next* observed UI. Failed taps leave it alone.
FAKE_ADB = """#!/usr/bin/env bash
case "$*" in
  get-state) echo device ;;
  get-serialno) echo emulator-5554 ;;
  get-devpath) echo usb:test ;;
  'shell pidof '*) echo 1201 ;;
  'shell input tap '*)
    [[ "$3" == tap && "$4" != "$FAIL_X" && "$5" == 5 ]] || exit 1
    echo "$(( $4 / 10 ))" > "$TEST_DIR/stage" ;;
  pull*) cp "$TEST_DIR/$(cat "$TEST_DIR/stage").xml" "$3" ;;
  'exec-out screencap -p') echo image ;;
  logcat*) echo "Subwise test process log" ;;
esac
"""


class AndroidEvidenceTest(unittest.TestCase):
    def run_device(self, fail_x=""):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name, source in (("adb", FAKE_ADB), ("sleep", "#!/bin/sh\nexit 0\n")):
                tool = root / name
                tool.write_bytes(source.encode())
                tool.chmod(0o755)
            (root / "stage").write_text("0")
            for stage, status in enumerate(RESULTS):
                ui = ET.Element("hierarchy")
                values = ["Subwise · 总览", "模拟数据", "订阅", "用量", status]
                if stage in (1, 2, 3):
                    values.extend(["DeepSeek", "MiniMax", "CNY"])
                for value in values:
                    ET.SubElement(ui, "node", package=PKG, text=value)
                for index, label in enumerate(BUTTONS, 1):
                    x = index * 10
                    ET.SubElement(ui, "node", package=PKG, clickable="true",
                                  bounds=f"[{x-5},0][{x+5},10]", **{"content-desc": label})
                ET.ElementTree(ui).write(root / f"{stage}.xml", encoding="utf-8")
            env = dict(os.environ, TEST_DIR=".", EVIDENCE_DIR=".", ADB="./adb", FAIL_X=fail_x,
                       SKIP_INSTALL="1", PYTHONUTF8="1")
            completed = subprocess.run(
                [shutil.which("bash"), "-c", 'export PATH="$PWD:$PATH"; source "$1"', "_", SCRIPT.as_posix()],
                cwd=root, env=env, capture_output=True, timeout=120,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr.decode(errors="replace"))
            return json.loads((root / "android-device-evidence.json").read_text(encoding="utf-8"))

    def test_success_records_actions_and_emulator_identity(self):
        evidence = self.run_device()
        self.assertEqual((evidence["platform"], evidence["deviceKind"]), ("android", "simulator"))
        self.assertEqual(evidence["status"], "PASS", evidence.get("checks"))
        self.assertTrue(evidence["checks"]["notificationScheduled"])

    def test_unsuccessful_tap_cannot_reuse_cards_as_proof(self):
        evidence = self.run_device(fail_x="20")
        self.assertEqual(evidence["status"], "FAIL")
        self.assertTrue(evidence["checks"]["dataPersistedAfterReread"])
        self.assertFalse(evidence["checks"]["rereadClicked"])
        self.assertFalse(evidence["checks"]["rereadCompleted"])
