#!/usr/bin/env python3
"""Rendered signed Android UI -> bridge -> real SQLite. Synthetic CI emulator only."""
import json
import os
import re
import sqlite3
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path

assert os.environ.get('GITHUB_ACTIONS') == 'true', 'Isolated CI only'
package = 'com.indexesstore.nasqo_pro_erp'
out = Path('upgrade-evidence')

def adb(*args):
    return subprocess.run(['adb', *args], check=True, capture_output=True, timeout=30).stdout

assert adb('get-serialno').decode().strip().startswith('emulator-')
assert adb('shell', 'getprop', 'ro.build.version.sdk').decode().strip() == '36'
size = [int(x) for x in re.findall(r'(\d+)x(\d+)', adb('shell', 'wm', 'size').decode())[-1]]

def read():
    for _ in range(5):
        try:
            adb('shell', 'uiautomator', 'dump', '/sdcard/nasqo-crud.xml')
            return ET.fromstring(adb('shell', 'cat', '/sdcard/nasqo-crud.xml'))
        except (subprocess.SubprocessError, ET.ParseError):
            time.sleep(1)
    raise AssertionError('Accessibility tree unavailable')

def label(n):
    return ' '.join(n.get(k, '') for k in ('text', 'content-desc', 'hint'))

def capture(stage, required, absent=''):
    print('CRUD stage:', stage, flush=True)
    for _ in range(15):
        root = read()
        labels = [label(n) for n in root.iter('node')]
        # The explanatory note contains 'حفظ السجلات'; only the exact
        # disappearing dialog/control label identifies an unfinished save.
        absent_present = absent and any(n.get(k, '').strip() == absent for n in root.iter('node') for k in ('text', 'content-desc', 'hint'))
        if any(required in v for v in labels) and not absent_present:
            (out/f'crud-{stage}.xml').write_bytes(ET.tostring(root, encoding='utf-8'))
            (out/f'crud-{stage}.png').write_bytes(adb('exec-out', 'screencap', '-p'))
            return root
        time.sleep(1)
    raise AssertionError('CRUD did not reach '+stage)

def tap(value, field=False, scroll=False):
    previous = None
    for _ in range(12 if scroll else 8):
        candidates = []
        for n in read().iter('node'):
            if (n.get('class') == 'android.widget.EditText') != field or value not in label(n):
                continue
            b = [int(x) for x in re.findall(r'\d+', n.get('bounds', ''))]
            if len(b) == 4 and 0 <= b[0] < b[2] <= size[0] and 0 <= b[1] < b[3] <= size[1]:
                exact = value in [n.get(k, '') for k in ('text', 'content-desc', 'hint')]
                candidates.append((not exact, (b[2]-b[0])*(b[3]-b[1]), b))
        if candidates:
            b = sorted(candidates)[0][2]
            # IME dismissal resizes the WebView asynchronously. Require two
            # fresh matching bounds so an old Save location cannot hit salary.
            if b != previous:
                previous = b
                time.sleep(0.25)
                continue
            if value == 'حفظ السجل':
                print('CRUD Save bounds:', b, flush=True)
                (out/f'crud-save-{int(time.time())}.png').write_bytes(adb('exec-out', 'screencap', '-p'))
            adb('shell', 'input', 'tap', str((b[0]+b[2])//2), str((b[1]+b[3])//2))
            return
        previous = None
        if scroll:
            adb('shell', 'input', 'swipe', str(size[0]//2), str(size[1]*3//4), str(size[0]//2), str(size[1]//3), '400')
        else:
            time.sleep(1)
    raise AssertionError('Control missing: '+value)

def snapshot():
    adb('shell', 'am', 'force-stop', package)
    with tempfile.TemporaryDirectory() as d:
        target = Path(d)/'app.db'
        source = '/data/user/0/'+package+'/databases/nasqo_pro_erp.db'
        adb('pull', source, str(target))
        for suffix in ['-wal', '-shm']:
            if subprocess.run(['adb','shell','test','-f',source+suffix],capture_output=True).returncode == 0:
                adb('pull', source+suffix, str(target)+suffix)
        db = sqlite3.connect(str(target)); db.row_factory = sqlite3.Row
        result = {t:[dict(r) for r in db.execute('SELECT * FROM '+t+' ORDER BY rowid')] for t in ['erp_state','inventory_items','ledger_entries','journal_entries','journal_lines','stock_movements']}
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not list(db.execute('PRAGMA foreign_key_check'))
        db.close()
        return result

def home():
    adb('shell', 'am', 'start', '-W', '-n', package+'/.MainActivity')
    # Startup may expose neither Home nor Back until the WebView is ready.
    for _ in range(30):
        root = read()
        visible_labels = {n.get(k, '').strip() for n in root.iter('node') for k in ('text', 'content-desc')}
        if 'الشريط السفلي للشاشة الرئيسية' in visible_labels and 'الإدارة' in visible_labels:
            break
        if 'رجوع' in visible_labels:
            tap('رجوع')
        time.sleep(0.5)
    else:
        raise AssertionError('Home did not become visible after startup/Back')
    capture('home', 'الإدارة')

def hr():
    home(); tap('الإدارة'); tap('الموارد البشرية والرواتب', scroll=True)
    capture('employees', 'إضافة سجل')

def employees(state):
    return [json.loads(r['payloadJson']) for r in state['erp_state'] if r['stateKey'].startswith('erp-record:employees:') and not json.loads(r['payloadJson']).get('_deleted')]

try:
    adb('root'); adb('wait-for-device')
    before = snapshot(); assert not employees(before), 'Requires synthetic empty employees'
    hr(); tap('إضافة سجل'); capture('create', 'اسم الموظف')
    tap('اسم الموظف', field=True); adb('shell','input','text','QA-CRUD-Employee')
    # Save is visible above the IME. Exercise the same direct Save gesture as
    # the user; Back is a separate app navigation action, not a field blur.
    tap('حفظ السجل')
    capture('created', 'QA-CRUD-Employee', 'حفظ السجل')
    created = snapshot(); assert employees(created)[0]['name'] == 'QA-CRUD-Employee'
    hr(); capture('persisted', 'QA-CRUD-Employee'); tap('عرض')
    capture('read', 'QA-CRUD-Employee'); tap('إغلاق')
    tap('تعديل'); tap('اسم الموظف', field=True)
    adb('shell','input','keyevent','KEYCODE_MOVE_END'); adb('shell','input','keyevent',*(['KEYCODE_DEL']*40))
    adb('shell','input','text','QA-CRUD-Edited'); tap('حفظ السجل')
    capture('edited', 'QA-CRUD-Edited', 'حفظ السجل')
    edited = snapshot(); assert employees(edited)[0]['name'] == 'QA-CRUD-Edited'
    assert employees(edited)[0]['_revision'] == employees(created)[0]['_revision']+1
    hr(); tap('حذف'); capture('confirm', 'تأكيد حذف السجل'); tap('إلغاء')
    capture('cancelled', 'QA-CRUD-Edited', 'تأكيد حذف السجل')
    tap('حذف'); tap('تأكيد الحذف'); capture('deleted', 'لا توجد سجلات مطابقة.')
    after = snapshot(); assert not employees(after)
    for table in ['inventory_items','ledger_entries','journal_entries','journal_lines','stock_movements']:
        assert before[table] == after[table], table+' changed'
    (out/'crud-result.json').write_text(json.dumps({'result':'PASS','sdk':36,'checks':['UI create','SQLite read after process restart','UI detail','UI update with persisted revision','cancel delete','confirm delete','stock/financial history unchanged'],'scope':'Synthetic employee on real signed Android release; all seven collections also have SQLite FFI and HTTP UI CRUD tests.'},indent=2)+'\n')
    # Preserve the starting screen expected by the following purchase acceptance.
    home()
except Exception:
    (out/'crud-failure.xml').write_bytes(ET.tostring(read(),encoding='utf-8'))
    (out/'crud-failure.png').write_bytes(adb('exec-out','screencap','-p'))
    raise
