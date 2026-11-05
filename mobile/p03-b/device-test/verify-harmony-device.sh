#!/usr/bin/env bash
# Subwise P03-B HarmonyOS 设备探针。HAP_PATH 可选，留空复用已安装版本。
# EVIDENCE_DIR 必填，HDC 可指定命令路径，HDC_TARGET 可在连接多台设备时选定目标。
# 安全存储、HTTPS、通知送达仍需人工确认。证据 JSON 的 status 表示本轮结果。
set -uo pipefail
: "${EVIDENCE_DIR:?请设置 EVIDENCE_DIR}"
mkdir -p "$EVIDENCE_DIR" || exit 1
EVID="$EVIDENCE_DIR/harmony-device-evidence.json"
FINAL_RECORDED=0
on_exit() {
  if [[ "$FINAL_RECORDED" == 0 ]]; then
    printf '%s\n' '{"platform":"harmony","deviceKind":"unknown","status":"ERROR","reason":"脚本异常终止，不等于环境不具备。"}' > "$EVID"
  fi
}
trap on_exit EXIT

# Run from Bash for compatibility with the device kit. Python handles timeouts,
# SQLite and Unicode UI text identically on Linux and macOS.
python3 - "$EVID" <<'PY'
import datetime
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from contextlib import closing
from pathlib import Path

WRITE_BUTTON = '写入模拟数据并重新读取'
WRITE_ACK = '模拟适配器 → RDB → UI'
READ_ACK = '已读取本地数据库'
SQL = ("SELECT rowid,id,title,value,source FROM probe_rows WHERE source='mock' "
       "AND (id LIKE 'deepseek-%' OR id LIKE 'minimax-%') ORDER BY id")
DB_NAME = 'subwise-p03b.db'
DB_DIR = 'data/storage/el2/database/entry/rdb'


class Result(Exception):
    def __init__(self, status, reason):
        super().__init__(reason)
        self.status = status


def verify(ev, output_dir):
    hdc = os.environ.get('HDC') or shutil.which('hdc')
    if not hdc:
        sdk_dirs = ('~/Library/Huawei/Sdk/hms', '~/Library/Huawei/Sdk/openharmony',
                    '~/OpenHarmony/Sdk/openharmony', '/opt/ohos-sdk/openharmony')
        hdc = next((str(Path(d).expanduser() / 'toolchains/hdc') for d in sdk_dirs
                    if (Path(d).expanduser() / 'toolchains/hdc').is_file()), None)
    if not hdc or not shutil.which(hdc):
        raise Result('NOT_RUN', '未找到 hdc，请安装 DevEco Studio 工具链或设置 HDC。')
    bundle = os.environ.get('BUNDLE', 'dev.subwise.p03b')
    if not re.fullmatch(r'[a-zA-Z][.\w]*', bundle, re.ASCII):
        raise Result('ERROR', 'BUNDLE 格式无效。')

    command = [hdc]

    def run(*args, required=True):
        try:
            p = subprocess.run([*command, *map(str, args)], stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, encoding='utf-8', errors='replace', timeout=45)
        except subprocess.TimeoutExpired as e:
            raise Result('PARTIAL', f'hdc {args[0]} 超时。') from e
        out = p.stdout.strip()
        # Some hdc versions signal failure on stdout with exit code zero.
        failed = p.returncode or re.search(r'^\s*(?:\[Fail\]|error:|permission denied)', out, re.I | re.M)
        if failed:
            if required:
                raise Result('FAIL', f'hdc {args[0]} 失败：{out[:200]}')
            return ''
        return out

    candidates = [s.split() for s in run('list', 'targets', '-v').splitlines()]
    devices = {r[0]: r[1].upper() for r in candidates if len(r) >= 3 and r[2].lower() == 'connected'}
    target = os.environ.get('HDC_TARGET') or (next(iter(devices)) if len(devices) == 1 else None)
    if target not in devices:
        raise Result('NOT_RUN', '需要一台已连接并授权的目标；连接多台时请设置 HDC_TARGET。')
    command.extend(['-t', target])
    device = {'transport': devices[target], 'bundle': bundle}
    for name, key in [('name', 'const.product.name'), ('model', 'const.product.model'),
                      ('type', 'const.product.devicetype'), ('version', 'const.ohos.fullname')]:
        device[name] = run('shell', 'param', 'get', key, required=False)
    if re.search(r'emulator|simulator|qemu|goldfish|ranchu|\bgeneric\b',
                 device['model'] + ' ' + device['name'], re.I):
        ev['deviceKind'] = 'simulator'
    elif (devices[target] == 'USB' and device['type'].lower() == 'phone'
          and device['model'].lower() not in ('', 'unknown', 'default', 'null', 'fail')
          and re.fullmatch(r'[\w .()+-]+', device['model'])):
        ev['deviceKind'] = 'physical'
    ev['device'] = device
    checks = ev['checks']
    hap = os.environ.get('HAP_PATH')
    if hap:
        if not Path(hap).is_file():
            raise Result('NOT_RUN', '指定的 HAP_PATH 文件不存在。')
        if not re.search(r'\bsuccess(?:ful(?:ly)?)?\b', run('install', '-r', hap), re.I):
            raise Result('FAIL', '未确认调试 HAP 安装成功。')
        checks['installedRequestedHap'] = True

    def pid():
        value = run('shell', 'pidof', bundle, required=False)
        return value if re.fullmatch(r'[1-9]\d*', value) else ''

    def restart():
        run('shell', 'aa', 'force-stop', bundle)
        for _ in range(10):
            if not pid():
                break
            time.sleep(0.3)
        else:
            raise Result('FAIL', '旧进程仍在运行，无法验证冷启动。')
        run('shell', 'aa', 'start', '-a', 'EntryAbility', '-b', bundle)
        for _ in range(20):
            new_pid = pid()
            if new_pid:
                return new_pid
            time.sleep(0.3)
        raise Result('FAIL', '启动后未观察到应用 PID。')

    # Scoped debug sandbox access preserves application data and works without
    # device-side sqlite3. Copy only the probe DB and its WAL in a temporary
    # directory. If the WAL is listed, it must be transferred successfully.
    def device_rows():
        # Older debuggable builds may expose the bundle's RDB directly but
        # lack hdc's -b transfer. Preserve that read-only route, scoped to this
        # bundle and filename; an error or an unreadable DB is never "empty".
        base = f'/data/app/el2/100/base/{bundle}'
        database = f'/data/app/el2/100/database/{bundle}'
        paths = run('shell', f"find {database} {base} -name {DB_NAME} 2>/dev/null",
                    required=False).splitlines()
        for path in paths:
            if (not re.fullmatch(r'[\w./-]+', path) or '..' in path.split('/')
                    or not path.startswith((base + '/', database + '/'))
                    or not path.endswith('/' + DB_NAME)):
                continue
            query = f"{SQL}; SELECT 'P03B_QUERY_OK';"
            lines = run('shell', f'''sqlite3 -readonly {path} "{query}"''', required=False).splitlines()
            if not lines or lines[-1] != 'P03B_QUERY_OK':
                continue
            rows = {}
            for line in lines[:-1]:
                parts = line.split('|')
                if len(parts) != 5 or not parts[0].isdigit():
                    raise Result('PARTIAL', '设备 sqlite3 返回了无法核验的行。')
                rowid, key, title, value, source = parts
                rows[key] = {'rowid': int(rowid), 'title': title, 'value': value, 'source': source}
            return rows
        raise Result('PARTIAL', '无法读取探针 RDB；请核对调试签名、hdc 沙盒支持和读取权限。')

    def rows():
        files = run('shell', '-b', bundle, 'ls', DB_DIR, required=False).split()
        if DB_NAME not in files:
            return device_rows()
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / DB_NAME
            names = [DB_NAME] + ([DB_NAME + '-wal'] if DB_NAME + '-wal' in files else [])
            for name in names:
                local = db.with_name(name)
                try:
                    run('file', 'recv', '-b', bundle, f'{DB_DIR}/{name}', local)
                except Result as e:
                    raise Result('PARTIAL', '调试沙盒传输探针 RDB 或 WAL 失败。') from e
                if not local.is_file() or (name == DB_NAME and local.stat().st_size == 0):
                    raise Result('PARTIAL', '未能读取探针 RDB 或 WAL，无法验证本轮落盘。')
            try:
                with closing(sqlite3.connect(db.as_uri() + '?mode=ro', uri=True)) as con:
                    result = {r[1]: {'rowid': r[0], 'title': r[2], 'value': r[3], 'source': r[4]}
                              for r in con.execute(SQL)}
            except sqlite3.Error as e:
                raise Result('PARTIAL', f'探针 RDB 查询失败：{e}') from e
        return result

    layout_files = []
    def layout():
        # Use fresh names: a failed dump must never reuse a previous screen.
        path = f'/data/local/tmp/subwise-{uuid.uuid4().hex}.json'
        layout_files.append(path)
        run('shell', 'uitest', 'dumpLayout', '-p', path)
        try:
            tree = json.loads(run('shell', 'cat', path))
        except ValueError as e:
            raise Result('PARTIAL', 'uitest 未能读取可解析的界面树。') from e
        def nodes(node):
            if isinstance(node, dict):
                yield node.get('attributes', {})
                for child in node.get('children', []):
                    yield from nodes(child)
        return list(nodes(tree))

    def wait_ui(label):
        for _ in range(12):
            nodes = layout()
            if any(n.get('text') == label for n in nodes):
                return nodes
            time.sleep(0.5)
        raise Result('FAIL', f'界面未出现「{label}」。')

    def screenshot():
        remote = f'/data/local/tmp/subwise-{uuid.uuid4().hex}.jpeg'
        layout_files.append(remote)
        run('shell', 'snapshot_display', '-f', remote)
        with tempfile.TemporaryDirectory(dir=output_dir) as tmp:
            path = Path(tmp) / 'screen.jpeg'
            run('file', 'recv', remote, path)
            if not path.is_file() or path.stat().st_size == 0:
                raise Result('FAIL', '本轮截图缺失。')
            path.replace(output_dir / 'harmony-screen.jpeg')
        ev['screenshot'] = 'harmony-screen.jpeg'
        checks['screenshotTaken'] = True

    try:
        first = restart()
        ev['device']['pidBefore'] = first
        nodes = wait_ui(READ_ACK)
        checks['appLaunched'] = True
        before = rows()
        ev['rdb'] = {'before': before}
        # Existing fixture cards can push the write button below the viewport.
        for attempt in range(5):
            if not any(n.get('text') == 'Subwise · 总览' for n in nodes):
                raise Result('FAIL', '没有观察到探针总览界面，未发送点击。')
            matches = [n for n in nodes if n.get('text') == WRITE_BUTTON]
            bounds = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]',
                                  str(matches[0].get('bounds', ''))) if matches else None
            if bounds:
                x, y, right, bottom = map(int, bounds.groups())
                if x < right and y < bottom:
                    run('shell', 'uitest', 'uiInput', 'click', (x + right) // 2, (y + bottom) // 2)
                    break
            if attempt < 4:
                run('shell', 'uitest', 'uiInput', 'dircFling', 2)
                time.sleep(0.5)
                nodes = layout()
        else:
            raise Result('PARTIAL', '无法在总览定位写入按钮。')
        wait_ui(WRITE_ACK)
        checks['writeActionAcknowledged'] = True
        after = rows()
        ev['rdb']['afterWrite'] = after
        checks['bothProvidersStored'] = (
            any(k.startswith('deepseek-') and 'DeepSeek' in r['title'] and 'CNY' in r['value'] for k,r in after.items())
            and any(k.startswith('minimax-') and 'MiniMax' in r['title'] and '剩余' in r['value'] for k,r in after.items())
        )
        # Probe.seed uses INSERT OR REPLACE on a TEXT PRIMARY KEY; SQLite
        # allocates new rowids even when the fixture contents are identical.
        newest_before = max((r['rowid'] for r in before.values()), default=0)
        checks['freshWriteVerified'] = bool(after) and all(r['rowid'] > newest_before for r in after.values())
        if not checks['bothProvidersStored'] or not checks['freshWriteVerified']:
            raise Result('FAIL', '未观察到本轮重新写入两类 fixture 的 RDB 行。')
        second = restart()
        ev['device']['pidAfter'] = second
        if first == second:
            raise Result('FAIL', '重启后的 PID 未改变。')
        wait_ui(READ_ACK)
        persisted = rows()
        ev['rdb']['afterRestart'] = persisted
        checks['persistedAfterRestart'] = after == persisted
        if not checks['persistedAfterRestart']:
            raise Result('FAIL', '重启后 RDB 回读与本轮写入不一致。')
        screenshot()
        logs = [run('shell', 'hilog', '-x', '-P', p, '-z', '300', required=False) for p in (first, second)]
        # A help/error banner is not a successful capture even if hdc exits 0.
        if not all(re.search(rf'\b{p}\s+\d+\s+[DIWEF]\s', log) for p, log in zip((first, second), logs)):
            raise Result('PARTIAL', '未取得两次进程的 hilog。')
        combined = '\n'.join(logs)
        (output_dir / 'hilog.txt').write_text(combined, encoding='utf-8')
        ev['hilogFile'] = 'hilog.txt'
        checks['noFatalInLog'] = not re.search(r'\bFATAL\b|segmentation fault|\bF\s+[A-Z][0-9a-f]+/', combined, re.I)
        checks['processAlive'] = pid() == second
        if not checks['processAlive'] or not checks['noFatalInLog']:
            raise Result('FAIL', '重启进程终止或其日志出现致命错误。')
    finally:
        for remote in layout_files:
            run('shell', 'rm', '-f', remote, required=False)


def main(path):
    ev = {'platform': 'harmony', 'deviceKind': 'unknown', 'checks': {},
          'manualChecksPending': ['安全存储写读删', '无凭据 HTTPS 401', '通知权限与送达']}
    try:
        verify(ev, path.parent)
        ev.update(status='PASS', reason='本轮写入两类模拟数据并重启回读成功。')
    except Result as e:
        ev.update(status=e.status, reason=str(e))
    except Exception as e:
        ev.update(status='ERROR', reason=f'验证脚本异常：{e}')
    ev['generatedAtUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    ev['checksTotal'] = len(ev['checks'])
    ev['checksPassed'] = sum(ev['checks'].values())
    ev['checksFailed'] = ev['checksTotal'] - ev['checksPassed']
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as tmp:
        json.dump(ev, tmp, ensure_ascii=False, indent=2)
    os.replace(tmp.name, path)
    print(f"{ev['status']}: {ev['reason']}")


if __name__ == '__main__':
    main(Path(sys.argv[1]).resolve())
PY
rc=$?
if [[ "$rc" == 0 ]]; then FINAL_RECORDED=1; fi
exit "$rc"
