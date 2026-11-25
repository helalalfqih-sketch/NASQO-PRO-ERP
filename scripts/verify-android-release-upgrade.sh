#!/usr/bin/env bash
set -euo pipefail
# Isolated CI emulator only. Never clears app data or touches a user's device.
PKG=com.indexesstore.nasqo_pro_erp
mkdir -p upgrade-evidence
adb install previous-release/NASQO-PRO-ERP.apk > upgrade-evidence/install-previous.txt
adb shell am start -W -n "$PKG/.MainActivity" > upgrade-evidence/start-previous.txt
sleep 12
adb shell pidof "$PKG" > upgrade-evidence/previous-pid.txt
adb shell dumpsys package "$PKG" > upgrade-evidence/previous-package.txt
adb exec-out screencap -p > upgrade-evidence/previous.png
adb logcat -c
# Capture the updated icon and cold-start animation on this synthetic device.
adb install -r release-output/NASQO-PRO-ERP.apk > upgrade-evidence/install-update.txt
adb shell input keyevent 3
adb shell input swipe 540 2100 540 350 500
sleep 2
adb exec-out screencap -p > upgrade-evidence/launcher.png
adb shell am force-stop "$PKG"
adb shell screenrecord --time-limit 12 /sdcard/nasqo-brand-start.mp4 >/dev/null 2>&1 &
RECORD_PID=$!
adb shell am start -W -n "$PKG/.MainActivity" > upgrade-evidence/start-update.txt
sleep 15
wait "$RECORD_PID" || true
adb pull /sdcard/nasqo-brand-start.mp4 upgrade-evidence/startup.mp4
adb shell pidof "$PKG" > upgrade-evidence/update-pid.txt
adb shell dumpsys package "$PKG" > upgrade-evidence/update-package.txt
adb exec-out screencap -p > upgrade-evidence/update.png
adb shell uiautomator dump /sdcard/nasqo-upgrade-ui.xml > upgrade-evidence/ui-dump-status.txt
adb pull /sdcard/nasqo-upgrade-ui.xml upgrade-evidence/update-ui.xml
adb logcat -d -s NASQO_LIFECYCLE:I AndroidRuntime:E flutter:E > upgrade-evidence/update-log.txt
python3 - <<'PY'
import pathlib,re,json
p=pathlib.Path('upgrade-evidence')
old=(p/'previous-package.txt').read_text();new=(p/'update-package.txt').read_text()
def field(s,k):
    key=r'(?:userId|appId)' if k=='userId' else k
    match=re.search(r'\b'+key+r'=(\d+)',s)
    assert match,'Missing package field: '+k
    return match.group(1)
assert field(old,'userId')==field(new,'userId'),'Android UID changed'
assert int(field(old,'versionCode'))==1126
assert int(field(new,'versionCode'))>1126
assert 'Success' in (p/'install-update.txt').read_text()
assert 'FATAL EXCEPTION' not in (p/'update-log.txt').read_text()
(p/'result.json').write_text(json.dumps({'result':'PASS','package':'com.indexesstore.nasqo_pro_erp','oldCode':1126,'newCode':int(field(new,'versionCode')),'uidRetained':True,'method':'adb install -r; no uninstall or clear','scope':'Fresh synthetic empty workspace. Install/launch smoke only; not a test of all existing records or every UI flow.'},indent=2))
PY
