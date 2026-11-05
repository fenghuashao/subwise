"""Drive the Harmony verifier with a stateful hdc double and a real SQLite DB."""
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'verify-harmony-device.sh'
code = SCRIPT.read_text(encoding='utf-8').split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]
verifier = {'__name__': 'harmony_probe'}
exec(compile(code, str(SCRIPT), 'exec'), verifier)


class FakeHdc:
    def __init__(self, root):
        self.db = root / 'fixture.db'
        self.con = sqlite3.connect(self.db)
        self.con.execute('PRAGMA journal_mode=WAL')
        self.con.execute('CREATE TABLE probe_rows(id TEXT PRIMARY KEY,title,value,source)')
        self.con.commit()
        self.click_effect = 'write'
        self.can_read = True
        self.direct_sqlite = False
        self.wal_transfer_error = False
        self.transport = 'USB'
        self.model = 'Model-42'
        self.pid = ''
        self.starts = 0
        self.ack = False
        self.events = []
        self.drop_after_restart = False

    def seed(self):
        self.con.executemany('INSERT OR REPLACE INTO probe_rows VALUES(?,?,?,?)', [
            ('deepseek-CNY', 'DeepSeek · 模拟 API 余额', 'CNY 110.00', 'mock'),
            ('minimax-coding', 'MiniMax · 模拟窗口', '剩余 62 / 100', 'mock')])
        self.con.commit()

    def run(self, cmd, **_kwargs):
        args = cmd[1:]
        if args == ['list', 'targets', '-v']:
            return subprocess.CompletedProcess(cmd, 0, f'test-device {self.transport} Connected localhost hdc')
        assert args[:2] == ['-t', 'test-device'], args
        args = args[2:]
        output = ''
        if args[:3] == ['shell', 'param', 'get']:
            output = {'model': self.model, 'name': 'Test', 'devicetype': 'phone',
                      'fullname': 'OpenHarmony'}[args[-1].split('.')[-1]]
        elif args[:3] == ['shell', 'aa', 'force-stop']:
            self.pid = ''
        elif args[:2] == ['shell', 'pidof']:
            output = self.pid
        elif args[:3] == ['shell', 'aa', 'start']:
            self.starts += 1
            self.pid = str(100 + self.starts)
            self.ack = False
            if self.drop_after_restart and self.starts == 2:
                self.con.execute('DELETE FROM probe_rows')
                self.con.commit()
            self.events.append('start')
        elif args[:3] == ['shell', 'uitest', 'dumpLayout']:
            pass
        elif args[:2] == ['shell', 'cat']:
            labels = ['Subwise · 总览', verifier['WRITE_ACK'] if self.ack else verifier['READ_ACK'],
                      verifier['WRITE_BUTTON']]
            output = json.dumps({'attributes': {}, 'children': [
                {'attributes': {'text': label, 'bounds': '[10,20][30,40]'}} for label in labels]})
        elif args[:4] == ['shell', 'uitest', 'uiInput', 'click']:
            assert args[4:] == ['20', '30'], args
            self.events.append('click')
            self.ack = self.click_effect != 'untapped'
            if self.click_effect == 'write':
                self.seed()
        elif args[:2] == ['shell', '-b'] and args[3] == 'ls':
            output = 'subwise-p03b.db\nsubwise-p03b.db-wal' if self.can_read else '[Fail]Permission denied'
        elif args[0] == 'shell' and args[1].startswith('find '):
            if self.direct_sqlite:
                output = '/data/app/el2/100/database/dev.subwise.p03b/entry/rdb/subwise-p03b.db'
        elif args[0] == 'shell' and args[1].startswith('sqlite3 -readonly '):
            self.events.append('db')
            data = ['|'.join(map(str, row)) for row in self.con.execute(verifier['SQL'])]
            output = '\n'.join([*data, 'P03B_QUERY_OK'])
        elif args[:3] == ['file', 'recv', '-b']:
            if args[-2].endswith('-wal'):
                shutil.copyfile(str(self.db) + '-wal', args[-1])
                if self.wal_transfer_error:
                    return subprocess.CompletedProcess(cmd, 1, 'transfer failed')
            else:
                self.events.append('db')
                shutil.copyfile(self.db, args[-1])
        elif args[:2] == ['shell', 'snapshot_display']:
            pass
        elif args[:2] == ['file', 'recv']:
            Path(args[-1]).write_bytes(b'jpeg fixture')
        elif args[:2] == ['shell', 'hilog']:
            output = f'11-05 12:00:00.000 {args[4]} 101 I A01234/Subwise: started'
        elif args[:2] == ['install', '-r']:
            self.events.append('install-replace')
            output = 'install bundle successfully.'
        elif not args[:3] == ['shell', 'rm', '-f']:
            raise AssertionError(args)
        return subprocess.CompletedProcess(cmd, 0, output)


class HarmonyDeviceTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.hdc = FakeHdc(self.root)
        self.addCleanup(self.hdc.con.close)

    def verify(self, hap=''):
        path = self.root / 'harmony-device-evidence.json'
        with patch.dict(os.environ, {'HDC': 'hdc', 'HDC_TARGET': '', 'HAP_PATH': str(hap)}), \
             patch('shutil.which', return_value='hdc'), patch('time.sleep'), \
             patch('subprocess.run', side_effect=self.hdc.run), contextlib.redirect_stdout(io.StringIO()):
            verifier['main'](path)
        return json.loads(path.read_text(encoding='utf-8'))

    def test_clean_install(self):
        ev = self.verify()
        self.assertEqual(ev['status'], 'PASS', ev)
        self.assertEqual(ev['platform'], 'harmony')
        self.assertEqual(ev['deviceKind'], 'physical')
        self.assertTrue(ev['checks']['freshWriteVerified'])
        self.assertTrue(ev['checks']['persistedAfterRestart'])
        self.assertEqual(self.hdc.events, ['start', 'db', 'click', 'db', 'start', 'db'])

    def test_existing_fixture_must_be_replaced(self):
        self.hdc.seed()
        self.assertEqual(self.verify()['status'], 'PASS')
        self.hdc.click_effect = 'noop'
        ev = self.verify()
        self.assertEqual(ev['status'], 'FAIL')
        self.assertFalse(ev['checks']['freshWriteVerified'])

    def test_missing_click_ack_even_with_old_rows(self):
        self.hdc.seed()
        self.hdc.click_effect = 'untapped'
        self.assertEqual(self.verify()['status'], 'FAIL')

    def test_restart_loses_rows(self):
        self.hdc.drop_after_restart = True
        ev = self.verify()
        self.assertEqual(ev['status'], 'FAIL')
        self.assertFalse(ev['checks']['persistedAfterRestart'])

    def test_no_sandbox_permission(self):
        self.hdc.can_read = False
        self.assertEqual(self.verify()['status'], 'PARTIAL')
        self.assertNotIn('click', self.hdc.events)

    def test_older_hdc_with_scoped_read_only_sqlite(self):
        self.hdc.can_read = False
        self.hdc.direct_sqlite = True
        self.assertEqual(self.verify()['status'], 'PASS')
        self.assertEqual(self.hdc.events, ['start', 'db', 'click', 'db', 'start', 'db'])

    def test_update_existing_install_keeps_old_data_for_baseline(self):
        self.hdc.seed()
        hap = self.root / 'test.hap'
        hap.touch()
        ev = self.verify(hap)
        self.assertEqual(ev['status'], 'PASS', ev)
        self.assertEqual(self.hdc.events[0], 'install-replace')
        self.assertIn('deepseek-CNY', ev['rdb']['before'])

    def test_incomplete_wal_transfer(self):
        self.hdc.wal_transfer_error = True
        self.assertEqual(self.verify()['status'], 'PARTIAL')
        self.assertNotIn('click', self.hdc.events)

    def test_unproven_hardware(self):
        self.hdc.transport = 'TCP'
        self.assertEqual(self.verify()['deviceKind'], 'unknown')
        self.hdc.transport, self.hdc.model = 'USB', 'HarmonyOS Emulator'
        self.assertEqual(self.verify()['deviceKind'], 'simulator')


if __name__ == '__main__':
    unittest.main()
