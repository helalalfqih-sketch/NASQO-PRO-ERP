#!/usr/bin/env python3
"""Read-only navigation acceptance on the isolated CI Android emulator."""
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

out = Path('upgrade-evidence')
def adb(*args):
    return subprocess.run(['adb', *args], check=True, capture_output=True, timeout=25).stdout

def snapshot(name, required, absent=None):
    for _ in range(20):
        try:
            adb('shell', 'uiautomator', 'dump', '/sdcard/nasqo-navigation.xml')
            xml = adb('shell', 'cat', '/sdcard/nasqo-navigation.xml')
            root = ET.fromstring(xml)
            labels = [n.get('text', '') + ' ' + n.get('content-desc', '') for n in root.iter('node')]
            if any(required in label for label in labels) and not (absent and any(absent in label for label in labels)):
                (out / (name + '.xml')).write_bytes(xml)
                (out / (name + '.png')).write_bytes(adb('exec-out', 'screencap', '-p'))
                return root
        except (subprocess.SubprocessError, ET.ParseError):
            pass
        time.sleep(1)
    raise AssertionError('UI did not reach ' + name)

def tap(root, label):
    for node in root.iter('node'):
        if label not in (node.get('text'), node.get('content-desc')):
            continue
        values = [int(v) for v in re.findall(r'\d+', node.get('bounds', ''))]
        if len(values) == 4 and values[2] > values[0] and values[3] > values[1]:
            adb('shell', 'input', 'tap', str((values[0]+values[2])//2), str((values[1]+values[3])//2))
            return
    raise AssertionError('Visible button missing: ' + label)

home = snapshot('navigation-home', 'الإعدادات')
tap(home, 'الإعدادات')
snapshot('navigation-settings', 'مراجع المستندات الافتراضية')
adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
adb('shell', 'am', 'start', '-W', '-n', 'com.indexesstore.nasqo_pro_erp/.MainActivity')
snapshot('navigation-resume', 'مراجع المستندات الافتراضية')
adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
snapshot('navigation-back-home', 'فاتورة جديدة', 'مراجع المستندات الافتراضية')
adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
dialog = snapshot('navigation-exit-dialog', 'الخروج من نسقو برو')
tap(dialog, 'متابعة')
snapshot('navigation-exit-cancelled', 'فاتورة جديدة', 'الخروج من نسقو برو')
(out / 'navigation-result.json').write_text(json.dumps({
    'result': 'PASS', 'sdk': adb('shell', 'getprop', 'ro.build.version.sdk').decode().strip(),
    'checks': ['rendered home accessibility', 'settings', 'Home/resume settings', 'system Back returns home', 'home exit confirmation', 'cancel exit'],
    'scope': 'Synthetic empty workspace; no financial action, private restore or gesture test. Screenshots require separate visual review.'
}, indent=2) + '\n')
