#!/usr/bin/env python3
"""Exercise the real Android picker, review and SQLite card import on CI only."""
import json
import os
import re
import sqlite3
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path

assert os.environ.get('GITHUB_ACTIONS') == 'true', 'Isolated synthetic CI only'
out = Path('upgrade-evidence')
package = 'com.indexesstore.nasqo_pro_erp'
filename = 'nasqo-large-import.csv'

def adb(*args):
    return subprocess.run(['adb', *args], check=True, capture_output=True, timeout=30).stdout

assert adb('get-serialno').decode().strip().startswith('emulator-')
assert adb('shell', 'getprop', 'ro.build.version.sdk').decode().strip() == '36'
size = [int(x) for x in re.findall(r'(\d+)x(\d+)', adb('shell', 'wm', 'size').decode())[-1]]

def read():
    for _ in range(5):
        try:
            adb('shell', 'uiautomator', 'dump', '/sdcard/nasqo-import.xml')
            return ET.fromstring(adb('shell', 'cat', '/sdcard/nasqo-import.xml'))
        except (subprocess.SubprocessError, ET.ParseError):
            time.sleep(1)
    raise AssertionError('Android accessibility tree unavailable')

def label(node):
    return ' '.join(node.get(k, '') for k in ('text', 'content-desc', 'hint'))

def capture(stage, required, absent=''):
    print('Import stage:', stage, flush=True)
    for _ in range(20):
        root = read()
        labels = [label(n) for n in root.iter('node')]
        if any(required in value for value in labels) and not (absent and any(absent in value for value in labels)):
            (out/f'import-{stage}.xml').write_bytes(ET.tostring(root, encoding='utf-8'))
            (out/f'import-{stage}.png').write_bytes(adb('exec-out', 'screencap', '-p'))
            return root
        time.sleep(1)
    raise AssertionError('Import did not reach '+stage)

def tap(value, scroll=False):
    for _ in range(12 if scroll else 4):
        candidates = []
        root = read()
        # WebView reports clipped checkbox bounds behind the fixed action bar.
        # Only tap the review content above that bar, otherwise its Cancel
        # button receives the click. Scroll until the checkbox is truly exposed.
        content_bottom = size[1]
        if scroll:
            for n in root.iter('node'):
                if n.get('class') == 'android.widget.Button' and n.get('text') == 'استيراد البطاقات':
                    bounds = [int(x) for x in re.findall(r'\d+', n.get('bounds', ''))]
                    if len(bounds) == 4 and bounds[1] < bounds[3]:
                        content_bottom = min(content_bottom, bounds[1]-20)
        for n in root.iter('node'):
            if value not in label(n):
                continue
            b = [int(x) for x in re.findall(r'\d+', n.get('bounds', ''))]
            if len(b) == 4 and 0 <= b[0] < b[2] <= size[0] and 0 <= b[1] < b[3] <= content_bottom:
                exact = value in [n.get(k, '') for k in ('text', 'content-desc')]
                candidates.append((not exact, (b[2]-b[0])*(b[3]-b[1]), b))
        if candidates:
            b = sorted(candidates)[0][2]
            adb('shell', 'input', 'tap', str((b[0]+b[2])//2), str((b[1]+b[3])//2))
            return
        if scroll:
            adb('shell', 'input', 'swipe', str(size[0]//2), str(size[1]*3//4), str(size[0]//2), str(size[1]//3), '400')
        else:
            time.sleep(1)
    raise AssertionError('Visible import control missing: '+value)

def database_snapshot():
    adb('shell', 'am', 'force-stop', package)
    with tempfile.TemporaryDirectory() as d:
        target = Path(d)/'app.db'
        dbpath = '/data/user/0/'+package+'/databases/nasqo_pro_erp.db'
        adb('pull', dbpath, str(target))
        for suffix in ['-wal', '-shm']:
            if subprocess.run(['adb', 'shell', 'test', '-f', dbpath+suffix], capture_output=True).returncode == 0:
                adb('pull', dbpath+suffix, str(target)+suffix)
        db = sqlite3.connect(str(target))
        db.row_factory = sqlite3.Row
        tables = ['inventory_items', 'inventory_unit_settings', 'accounts', 'ledger_entries', 'journal_entries', 'journal_lines', 'stock_movements']
        result = {t: [dict(r) for r in db.execute('SELECT * FROM '+t+' ORDER BY rowid')] for t in tables}
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not list(db.execute('PRAGMA foreign_key_check'))
        db.close()
    return result

try:
    adb('root'); adb('wait-for-device')
    assert adb('shell', 'id', '-u').decode().strip() == '0'
    before = database_snapshot()
    with tempfile.TemporaryDirectory() as d:
        csv = Path(d)/filename
        csv.write_text('اسم الصنف,الباركود,الوحدة,سعر الشراء,سعر البيع,العملة\n'+''.join(
            f'QA Bulk {i},000{i},حبة,17.5,25,ريال\n' for i in range(3000)), encoding='utf-8')
        adb('push', str(csv), '/sdcard/Download/'+filename)
    adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file:///sdcard/Download/'+filename)
    snapshots = []
    for attempt in range(2):
        adb('shell', 'am', 'start', '-W', '-n', package+'/.MainActivity')
        capture(f'home-{attempt}', 'فاتورة جديدة')
        tap('ملف الأصناف')
        capture(f'catalog-{attempt}', 'خيارات بطاقات الأصناف')
        tap('خيارات بطاقات الأصناف'); tap('استيراد أصناف')
        root = read()
        if not any(filename in label(n) for n in root.iter('node')):
            tap('Show roots'); tap('Downloads')
        tap(filename)
        capture(f'review-{attempt}', 'عدد البطاقات: 3000')
        tap('راجعت الصفوف', scroll=True)
        confirmed = capture(f'confirmed-{attempt}', 'استيراد البطاقات')
        assert any(n.get('class') == 'android.widget.Button' and n.get('text') == 'استيراد البطاقات' and n.get('enabled') == 'true' for n in confirmed.iter('node')), 'Import review must be confirmed before submitting'
        tap('استيراد البطاقات')
        capture(f'saved-{attempt}', 'خيارات بطاقات الأصناف', 'مراجعة استيراد')
        snapshots.append(database_snapshot())
    after = snapshots[0]
    assert len(after['inventory_items']) == len(before['inventory_items'])+3000
    previous = {r['id']: r for r in before['inventory_items']}
    assert all(r == previous[r['id']] for r in after['inventory_items'] if r['id'] in previous)
    created = [r for r in after['inventory_items'] if r['id'] not in previous]
    assert all(r['quantity'] == 0 and r['avgCost'] == 0 and r['warehouseId'] == '' for r in created)
    assert {r['sku'] for r in created} == {f'000{i}' for i in range(3000)}
    for table in ['accounts', 'ledger_entries', 'journal_entries', 'journal_lines', 'stock_movements']:
        assert after[table] == before[table], table+' changed'
    assert snapshots[1] == after, 'Repeated import changed data'
    (out/'large-import-result.json').write_text(json.dumps({'result':'PASS', 'sdk':36, 'rows':3000, 'inserted':3000, 'repeatInserted':0,
        'realAndroidPicker':True, 'balancesAndHistoryUnchanged':True, 'scope':'Synthetic CSV, real review and SQLite persistence on isolated signed-release emulator.'}, indent=2)+'\n')
    adb('shell', 'am', 'start', '-W', '-n', package+'/.MainActivity')
    capture('final-home', 'فاتورة جديدة'); tap('ملف الأصناف')
except Exception:
    (out/'import-failure.xml').write_bytes(ET.tostring(read(), encoding='utf-8'))
    (out/'import-failure.png').write_bytes(adb('exec-out', 'screencap', '-p'))
    raise
