#!/usr/bin/env python3
"""Create one synthetic card on the isolated CI emulator, without a warehouse."""
import json
import os
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

assert os.environ.get('GITHUB_ACTIONS') == 'true', 'CI synthetic emulator only'
out = Path('upgrade-evidence')
package = 'com.indexesstore.nasqo_pro_erp'
name = 'NASQO-Synthetic-Card'

def adb(*args):
    return subprocess.run(['adb', *args], check=True, capture_output=True, timeout=25).stdout

assert adb('get-serialno').decode().strip().startswith('emulator-'), 'Never target a physical phone'
size = [int(x) for x in re.findall(r'(\d+)x(\d+)', adb('shell','wm','size').decode())[-1]]

def read():
    for _ in range(5):
        try:
            adb('shell','uiautomator','dump','/sdcard/nasqo-catalog.xml')
            return ET.fromstring(adb('shell','cat','/sdcard/nasqo-catalog.xml'))
        except (subprocess.SubprocessError, ET.ParseError):
            time.sleep(1)
    raise AssertionError('Android accessibility tree unavailable')

def labels(root):
    return [' '.join(n.get(k,'') for k in ('text','content-desc','hint')) for n in root.iter('node')]

def capture(stage, required, absent=''):
    for _ in range(15):
        root = read()
        values = labels(root)
        if any(required in x for x in values) and not (absent and any(absent in x for x in values)):
            (out/f'catalog-{stage}.xml').write_bytes(ET.tostring(root,encoding='utf-8'))
            (out/f'catalog-{stage}.png').write_bytes(adb('exec-out','screencap','-p'))
            return root
        time.sleep(1)
    raise AssertionError('Catalog did not reach '+stage)

def tap(label, field=False, scroll=False):
    for _ in range(10 if scroll else 3):
        root = read()
        for n in root.iter('node'):
            text = ' '.join(n.get(k,'') for k in ('text','content-desc','hint'))
            if (field and n.get('class') != 'android.widget.EditText') or label.replace('إ','ا').replace('أ','ا') not in text.replace('إ','ا').replace('أ','ا'):
                continue
            bounds = [int(x) for x in re.findall(r'\d+',n.get('bounds',''))]
            if len(bounds)==4 and 0<=bounds[0]<bounds[2]<=size[0] and 0<=bounds[1]<bounds[3]<=size[1]:
                adb('shell','input','tap',str((bounds[0]+bounds[2])//2),str((bounds[1]+bounds[3])//2))
                return
        if scroll:
            adb('shell','input','swipe',str(size[0]//2),str(size[1]*3//4),str(size[0]//2),str(size[1]//3),'400')
        else:
            time.sleep(1)
    raise AssertionError('Visible control missing: '+label)

# Navigation is restored across process restarts; return through visible Back.
for _ in range(8):
    if any(n.get('text') == 'الإدارة' or n.get('content-desc') == 'الإدارة' for n in read().iter('node')):
        break
    tap('رجوع')
tap('ملف الأصناف', scroll=True)
capture('empty','لا توجد أصناف')
tap('إضافة أول صنف')
capture('form','إضافة صنف جديد')
tap('اسم الصنف',field=True)
adb('shell','input','text',name)
capture('entered',name)
adb('shell','input','keyevent','KEYCODE_BACK')
tap('حفظ',scroll=True)
capture('saved',name,'إضافة صنف جديد')
adb('shell','input','keyevent','KEYCODE_BACK')
capture('home','فاتورة جديدة')
adb('shell','am','force-stop',package)
adb('shell','am','start','-W','-n',package+'/.MainActivity')
capture('reopened','فاتورة جديدة')
tap('ملف الأصناف', scroll=True)
capture('persisted',name,'إضافة صنف جديد')
(out/'catalog-result.json').write_text(json.dumps({
 'result':'PASS','sdk':adb('shell','getprop','ro.build.version.sdk').decode().strip(),
 'checks':['open empty catalog','enter synthetic card','save without creating a warehouse','card visible after process restart'],
 'scope':'Real Android WebView and SQLite on isolated CI emulator. No financial posting or private data. Screenshots require separate visual review.'
},indent=2)+'\n')
