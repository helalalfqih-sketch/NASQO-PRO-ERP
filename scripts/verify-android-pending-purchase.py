#!/usr/bin/env python3
"""Real signed-release UI posting, using ONLY a generated synthetic CI database.

Seeding bypasses the restore picker; purchase entry/posting uses Android UI only.
Never run against a physical phone, private backup, or a developer's workspace.
"""
import hashlib
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
out = Path('upgrade-evidence')
package = 'com.indexesstore.nasqo_pro_erp'
fixture = Path('synthetic-fixture/nasqo-pending-qa.db')
source = sqlite3.connect(f'file:{fixture}?mode=ro', uri=True)
source.row_factory = sqlite3.Row

def records(db, table):
    return [dict(r) for r in db.execute('SELECT * FROM '+table+' ORDER BY rowid')]

assert [(r['name'], r['quantity'], r['avgCost']) for r in records(source, 'inventory_items')] == [
    ('QA Pending A', 3, 0), ('QA Pending B', 5, 0)]
assert not records(source, 'journal_entries') and not records(source, 'stock_movements')
assert all(r['name'].startswith('QA ') or str(r['note']).startswith('nasqo:system:') for r in records(source, 'accounts'))

def adb(*args):
    return subprocess.run(['adb', *args], check=True, capture_output=True, timeout=30).stdout

assert adb('get-serialno').decode().strip().startswith('emulator-')
assert adb('shell', 'getprop', 'ro.build.version.sdk').decode().strip() == '36'
size = [int(x) for x in re.findall(r'(\d+)x(\d+)', adb('shell', 'wm', 'size').decode())[-1]]

def read():
    for _ in range(5):
        try:
            adb('shell', 'uiautomator', 'dump', '/sdcard/nasqo-purchase.xml')
            return ET.fromstring(adb('shell', 'cat', '/sdcard/nasqo-purchase.xml'))
        except (subprocess.SubprocessError, ET.ParseError):
            time.sleep(1)
    raise AssertionError('Android accessibility tree unavailable')

def text(n):
    return ' '.join(n.get(k, '') for k in ('text', 'content-desc', 'hint'))

def capture(stage, required, absent=''):
    print('Purchase stage:', stage, flush=True)
    for _ in range(12):
        root = read()
        labels = [text(n) for n in root.iter('node')]
        if any(required in x for x in labels) and not (absent and any(absent in x for x in labels)):
            (out/f'purchase-{stage}.xml').write_bytes(ET.tostring(root, encoding='utf-8'))
            (out/f'purchase-{stage}.png').write_bytes(adb('exec-out', 'screencap', '-p'))
            return root
        time.sleep(1)
    raise AssertionError('Purchase did not reach '+stage)

def tap(label, field=False, scroll=False, max_y=None, activate=True):
    print('Tap:', label, flush=True)
    for _ in range(10 if scroll else 3):
        root = read()
        candidates = []
        for n in root.iter('node'):
            if (n.get('class') == 'android.widget.EditText') != field:
                continue
            if label not in text(n):
                continue
            bounds = [int(x) for x in re.findall(r'\d+', n.get('bounds', ''))]
            if len(bounds) == 4 and 0 <= bounds[0] < bounds[2] <= size[0] and 0 <= bounds[1] < bounds[3] <= (max_y or size[1]):
                exact = label in [n.get(k, '') for k in ('text', 'content-desc', 'hint')]
                candidates.append((not exact, (bounds[2]-bounds[0])*(bounds[3]-bounds[1]), bounds))
        if candidates:
            bounds = sorted(candidates)[0][2]
            if activate:
                adb('shell', 'input', 'tap', str((bounds[0]+bounds[2])//2), str((bounds[1]+bounds[3])//2))
            return
        if scroll:
            adb('shell', 'input', 'swipe', str(size[0]//2), str(size[1]*3//4), str(size[0]//2), str(size[1]//3), '400')
        else:
            time.sleep(1)
    raise AssertionError('Visible control missing: '+label)

try:
    # Independent UI acceptance, including when another synthetic stage failed.
    adb('shell', 'am', 'force-stop', package)
    adb('shell', 'am', 'start', '-W', '-n', package+'/.MainActivity')
    for _ in range(8):
        if any(n.get('text') == 'الإدارة' or n.get('content-desc') == 'الإدارة' for n in read().iter('node')):
            break
        tap('رجوع')
    capture('before-fixture', 'فاتورة جديدة')
    adb('shell', 'am', 'force-stop', package)
    print(adb('root').decode().strip(), flush=True)
    adb('wait-for-device')
    assert adb('shell', 'id', '-u').decode().strip() == '0'
    info = adb('shell', 'dumpsys', 'package', package).decode()
    uid = re.search(r'\b(?:userId|appId)=(\d+)', info).group(1)
    dbpath = '/data/user/0/'+package+'/databases/nasqo_pro_erp.db'
    adb('shell', 'test', '-f', dbpath)
    adb('push', str(fixture), '/data/local/tmp/nasqo-pending-qa.db')
    adb('shell', 'cp', '/data/local/tmp/nasqo-pending-qa.db', dbpath)
    adb('shell', 'rm', '-f', dbpath+'-wal', dbpath+'-shm', dbpath+'-journal')
    adb('shell', 'chown', uid+':'+uid, dbpath)
    adb('shell', 'chmod', '600', dbpath)
    adb('shell', 'restorecon', dbpath)
    adb('shell', 'am', 'start', '-W', '-n', package+'/.MainActivity')
    # The WebView can expose its default home tree while Flutter still shows
    # workspace loading. Wait for the restored business title, not that tree.
    capture('seeded-home', 'اختبار شراء اصطناعي')
    tap('فاتورة جديدة')
    capture('invoice-open', 'فاتورة')
    tap('فاتورة شراء')
    tap('نقدي')
    capture('purchase-cash', 'QA Supplier')
    for name in ['QA Pending A', 'QA Pending B']:
        # Accessibility includes nodes occluded by the fixed invoice footer.
        # Bring search into the upper body so results are actually tappable.
        tap('بحث عن صنف أو باركود', field=True, scroll=True, max_y=size[1]//2)
        adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END')
        adb('shell', 'input', 'keyevent', *(['KEYCODE_DEL']*24))
        adb('shell', 'input', 'text', name.replace(' ', '%s'))
        tap(name, max_y=size[1]*3//4)
        time.sleep(0.3)
        root = capture('selected-'+name[-1], name)
        search = [n for n in root.iter('node') if n.get('hint') == 'بحث عن صنف أو باركود']
        assert len(search) == 1 and not search[0].get('text'), 'Selection must clear the item search'
    tap('سعر السطر 2', field=True, scroll=True, max_y=size[1]*3//4, activate=False)
    root = capture('priced', '10,000')
    assert not any('غير معتمدة' in text(n) or 'حدد حساب أصل المخزون' in text(n) for n in root.iter('node'))
    prices = [n for n in root.iter('node') if n.get('class') == 'android.widget.EditText' and 'سعر السطر' in text(n)]
    assert len(prices) == 2 and all(n.get('text') == '5000' for n in prices), 'Both purchase prices must be populated'
    tap('عمل فاتورة')
    capture('saved', 'فاتورة جديدة', 'فاتورة شراء جديدة')
    adb('shell', 'am', 'force-stop', package)
    adb('shell', 'am', 'start', '-W', '-n', package+'/.MainActivity')
    capture('reopened', 'اختبار شراء اصطناعي')
    tap('حركة المخزون', scroll=True)
    root = capture('inventory-after-restart', 'QA Pending A')
    assert not any('غير معتمدة' in text(n) or 'حدد حساب أصل المخزون' in text(n) for n in root.iter('node'))
    adb('shell', 'am', 'force-stop', package)
    # Read durable SQLite after posting and restart; no test posting bridge.
    with tempfile.TemporaryDirectory(prefix='nasqo-ci-posted-') as folder:
        target = Path(folder)/'posted.db'
        adb('pull', dbpath, str(target))
        for suffix in ['-wal', '-shm']:
            if subprocess.run(['adb', 'shell', 'test', '-f', dbpath+suffix]).returncode == 0:
                adb('pull', dbpath+suffix, str(target)+suffix)
        db = sqlite3.connect(target)
        db.row_factory = sqlite3.Row
        items = records(db, 'inventory_items')
        assert [(r['quantity'], r['avgCost']) for r in items] == [(4, 5000), (6, 5000)]
        assert not records(db, 'legacy_unverified_stock')
        for table in ['legacy_operational_source', 'legacy_operational_chunks', 'legacy_operational_rows', 'legacy_stock_openings']:
            assert records(db, table) == records(source, table), table+' changed'
        approvals = lambda conn: [tuple(r) for r in conn.execute("SELECT stateKey,payloadJson FROM erp_state WHERE stateKey LIKE 'stock_quantity_approval:%' ORDER BY stateKey")]
        assert approvals(db) == approvals(source)
        ledger = records(db, 'ledger_entries')
        old_ledger = {r['id']: r for r in records(source, 'ledger_entries')}
        current_ledger = {r['id']: r for r in ledger}
        assert all(current_ledger.get(key) == value for key, value in old_ledger.items()), 'Historical ledger changed'
        new_ledger = [r for r in ledger if r['id'] not in old_ledger]
        openings = [r for r in new_ledger if r['kind'] == 'opening']
        invoices = [r for r in new_ledger if r['kind'] == 'invoice']
        assert len(openings) == 2 and len(invoices) == 1, 'Opening value once, exactly one new invoice'
        invoice = invoices[0]
        assert invoice['amount'] == 10000 and invoice['payment'] == 'cash' and invoice['direction'] == 'credit'
        assert invoice['warehouseId'] == 'legacy-wh-1' and invoice['postingStatus'] == 'posted'
        assert len(records(db, 'invoice_lines')) == 2 and len(records(db, 'stock_movements')) == 2
        assert len(records(db, 'journal_entries')) == 3
        lines = records(db, 'journal_lines')
        balance = {r['account_id']: r['net'] for r in db.execute('SELECT account_id,SUM(debit_minor-credit_minor) net FROM journal_lines GROUP BY account_id')}
        assert balance['account_QA-Inventory'] == 5000000 and balance['account_QA-Cash'] == -1000000
        assert balance.get('legacy-acc-1', 0) == 0
        assert sum(r['debit_minor']-r['credit_minor'] for r in lines) == 0
        postings = records(db, 'stock_posting_lines')
        assert len(postings) == 2
        assert [(r['before_value'], r['after_value']) for r in postings] == [(1500000, 2000000), (2500000, 3000000)]
        baselines = list(db.execute("SELECT stateKey FROM erp_state WHERE stateKey LIKE 'automatic_stock_baseline:%'"))
        assert len(baselines) == 2
        assert not list(db.execute('PRAGMA foreign_key_check'))
        result = {'result': 'PASS', 'sdk': 36, 'fixtureSha256': hashlib.sha256(fixture.read_bytes()).hexdigest(),
                  'amount': 10000, 'payment': 'cash', 'prices': [5000, 5000], 'quantitiesBefore': [3, 5], 'quantitiesAfter': [4, 6],
                  'approvedNewPurchaseValue': 10000, 'oldCostStillPending': False, 'openingCostPreparedAutomatically': True, 'oldArchiveUnchanged': True,
                  'journalBalanced': True, 'stockMovements': 2, 'newInvoicesAfterRestart': 1,
                  'historicalInvoicesPreserved': len(old_ledger),
                  'inventoryReportReadyAfterRestart': True,
                  'scope': 'Signed Android 16 release, UI entry/posting and inventory report after process restart; durable SQLite checked. Synthetic DB seeded before UI test; not a restore-picker or private-data test.'}
        db.close()
    (out/'purchase-result.json').write_text(json.dumps(result, indent=2)+'\n')
    adb('shell', 'am', 'start', '-W', '-n', package+'/.MainActivity')
    print(json.dumps(result), flush=True)
except Exception:
    try:
        (out/'purchase-failure.xml').write_bytes(ET.tostring(read(), encoding='utf-8'))
        (out/'purchase-failure.png').write_bytes(adb('exec-out', 'screencap', '-p'))
    finally:
        raise
