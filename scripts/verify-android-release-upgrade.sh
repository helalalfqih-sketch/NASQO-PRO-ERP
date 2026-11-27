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
# Arabic labels sort near the end in an English launcher. Locate the visible
# native label before taking its evidence screenshot; do not assume row 3.
adb shell input swipe 540 1900 540 700 400
sleep 1
LABEL_VISIBLE=0
for attempt in 1 2 3 4 5; do
  if timeout 15s adb shell uiautomator dump /sdcard/nasqo-launcher.xml >> upgrade-evidence/launcher-dump-status.txt 2>&1 &&
     adb pull /sdcard/nasqo-launcher.xml upgrade-evidence/launcher-ui.xml >/dev/null 2>&1; then
    if grep -Fq 'نسقو برو' upgrade-evidence/launcher-ui.xml; then LABEL_VISIBLE=1; break; fi
    # The fresh Pixel launcher can show search onboarding over the app drawer.
    # Dismiss only its observed native button, then reopen the drawer.
    python3 - <<'PY'
import re, subprocess, xml.etree.ElementTree as ET
root=ET.parse('upgrade-evidence/launcher-ui.xml')
for n in root.iter('node'):
    if n.get('package')=='com.google.android.apps.nexuslauncher' and n.get('text')=='Got it':
        b=list(map(int,re.findall(r'\d+',n.get('bounds',''))))
        if len(b)==4:
            subprocess.run(['adb','shell','input','tap',str((b[0]+b[2])//2),str((b[1]+b[3])//2)],check=True)
            subprocess.run(['adb','shell','input','keyevent','KEYCODE_HOME'],check=True)
            subprocess.run(['adb','shell','input','swipe','540','2100','540','350','500'],check=True)
        break
PY
  fi
  adb shell input swipe 540 1900 540 700 400
  sleep 1
done
test "$LABEL_VISIBLE" = 1
adb exec-out screencap -p > upgrade-evidence/launcher.png
adb shell am force-stop "$PKG"
adb shell screenrecord --time-limit 12 /sdcard/nasqo-brand-start.mp4 >/dev/null 2>&1 &
RECORD_PID=$!
adb shell am start -W -n "$PKG/.MainActivity" > upgrade-evidence/start-update.txt
adb shell pidof "$PKG" > upgrade-evidence/launch-pid.txt
sleep 15
wait "$RECORD_PID" || true
adb pull /sdcard/nasqo-brand-start.mp4 upgrade-evidence/startup.mp4
adb shell pidof "$PKG" > upgrade-evidence/update-pid.txt
adb shell dumpsys package "$PKG" > upgrade-evidence/update-package.txt
adb exec-out screencap -p > upgrade-evidence/update.png
# A cold emulator can still be rendering after install. Wait for WebView load,
# and retry the observed transient null-root capture failure without clearing data.
UI_READY=0
for attempt in $(seq 1 15); do
  adb logcat -d -s NASQO_LIFECYCLE:I AndroidRuntime:E flutter:E > upgrade-evidence/update-log.txt
  if grep -Fq 'event=page-finished' upgrade-evidence/update-log.txt; then
    if timeout 15s adb shell uiautomator dump /sdcard/nasqo-upgrade-ui.xml >> upgrade-evidence/ui-dump-status.txt 2>&1 &&
       adb pull /sdcard/nasqo-upgrade-ui.xml upgrade-evidence/update-ui.xml >/dev/null 2>&1 &&
       grep -Fq '<hierarchy' upgrade-evidence/update-ui.xml; then UI_READY=1; break; fi
  fi
  sleep 2
done
test "$UI_READY" = 1
adb shell pidof "$PKG" > upgrade-evidence/update-pid.txt
adb exec-out screencap -p > upgrade-evidence/update.png
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
assert int(field(old,'versionCode'))==1138
assert int(field(new,'versionCode'))>1138
assert 'Success' in (p/'install-update.txt').read_text()
log=(p/'update-log.txt').read_text()
launch_pid=(p/'launch-pid.txt').read_text().strip()
assert launch_pid and launch_pid==(p/'update-pid.txt').read_text().strip(), 'App process restarted during cold start'
# Android 16's external uiautomator may crash while dumping a live WebView.
# Retain its log, but attribute crashes to the app process rather than every
# AndroidRuntime tag on the device. The app PID and successful UI dump are
# checked independently; app restarts and app/child-process crashes still fail.
app_lines=[line for line in log.splitlines() if re.search(r'\s'+re.escape(launch_pid)+r'\s+\d+\s+[A-Z]\s',line)]
assert not any('FATAL EXCEPTION' in line for line in app_lines), 'App runtime crash'
assert not re.search(r'Process: com\.indexesstore\.nasqo_pro_erp(?=[:,\s])',log), 'App or child-process crash'
(p/'result.json').write_text(json.dumps({'result':'PASS','package':'com.indexesstore.nasqo_pro_erp','oldCode':1138,'newCode':int(field(new,'versionCode')),'uidRetained':True,'method':'adb install -r; no uninstall or clear','scope':'Fresh synthetic empty workspace. Install/launch smoke only; not a test of all existing records or every UI flow.'},indent=2))
PY
CHECKS_FAILED=0
if [[ "${NASQO_ANDROID_NAV_SMOKE:-false}" == true ]]; then
  python3 scripts/verify-android-navigation.py || CHECKS_FAILED=1
  adb shell am force-stop "$PKG"
  adb shell am start -W -n "$PKG/.MainActivity" >/dev/null
  python3 scripts/verify-android-catalog.py || CHECKS_FAILED=1
  # These checks establish their own starting state on this synthetic device.
  # Collect every result, but fail the job if any stage fails.
  python3 scripts/verify-android-large-import.py || CHECKS_FAILED=1
  python3 scripts/verify-android-crud.py || CHECKS_FAILED=1
fi
if [[ "${NASQO_ANDROID_PENDING_PURCHASE:-false}" == true ]]; then
  python3 scripts/verify-android-pending-purchase.py || CHECKS_FAILED=1
fi
adb logcat -d -t 1000 -s NASQO_LIFECYCLE:I AndroidRuntime:E flutter:E > upgrade-evidence/final-log.txt
exit "$CHECKS_FAILED"
