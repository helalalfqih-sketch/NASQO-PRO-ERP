#!/usr/bin/env python3
"""Unedited store screenshots of an existing signed APK on a fresh CI emulator.

No fixture import, financial writes, data clearing, rebuilding or publication.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import time
import xml.etree.ElementTree as ET

PACKAGE = "com.indexesstore.nasqo_pro_erp"
APK = Path("release-output/NASQO-PRO-ERP.apk")
OUT = Path("upgrade-evidence/store-listing")
WIDTH, HEIGHT = 1080, 1920


def adb(*args):
    return subprocess.run(["adb", *args], check=True, capture_output=True, timeout=60).stdout


def read_ui():
    adb("shell", "uiautomator", "dump", "/sdcard/nasqo-store.xml")
    xml = adb("shell", "cat", "/sdcard/nasqo-store.xml")
    return ET.fromstring(xml), xml


def labels(root):
    return [" ".join(n.get(k, "") for k in ("text", "content-desc")) for n in root.iter("node")]


def capture(name, required, save=True):
    for _ in range(20):
        try:
            root, xml = read_ui()
            if any(required in label for label in labels(root)):
                # Wait for the opening transition before recording original pixels.
                time.sleep(1)
                if save:
                    png = adb("exec-out", "screencap", "-p")
                    assert png[:8] == b"\x89PNG\r\n\x1a\n"
                    assert struct.unpack(">II", png[16:24]) == (WIDTH, HEIGHT)
                    (OUT / f"{name}.png").write_bytes(png)
                    (OUT / f"{name}.xml").write_bytes(xml)
                return root
        except (subprocess.SubprocessError, ET.ParseError):
            pass
        time.sleep(1)
    raise AssertionError("Screen did not become ready: " + name)


def tap(label, scroll=False):
    for _ in range(8 if scroll else 3):
        root, _ = read_ui()
        for node in root.iter("node"):
            if label not in (node.get("text"), node.get("content-desc")):
                continue
            bounds = [int(v) for v in re.findall(r"\d+", node.get("bounds", ""))]
            if len(bounds) == 4 and 0 <= bounds[0] < bounds[2] <= WIDTH and 0 <= bounds[1] < bounds[3] <= HEIGHT:
                adb("shell", "input", "tap", str((bounds[0] + bounds[2]) // 2), str((bounds[1] + bounds[3]) // 2))
                return
        if scroll:
            adb("shell", "input", "swipe", "540", "1400", "540", "650", "400")
        else:
            time.sleep(1)
    raise AssertionError("Visible control not found: " + label)


assert os.environ.get("GITHUB_ACTIONS") == "true", "Only the isolated CI emulator is supported"
assert adb("get-serialno").decode().strip().startswith("emulator-")
assert adb("shell", "getprop", "ro.kernel.qemu").decode().strip() == "1"
assert not adb("shell", "pm", "list", "packages", PACKAGE).strip(), "Refuse to replace any existing installation"
OUT.mkdir(parents=True, exist_ok=True)
adb("shell", "wm", "size", f"{WIDTH}x{HEIGHT}")
adb("shell", "wm", "density", "420")
assert b"Success" in adb("install", str(APK))
adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
adb("shell", "wm", "dismiss-keyguard")
adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
capture("01-home", "فاتورة جديدة")
tap("الإعدادات")
capture("settings-ready", "مراجع المستندات الافتراضية", save=False)
tap("إعدادات الكاشير")
capture("02-cashier-settings", "أصناف الكاشير")
package_info = adb("shell", "dumpsys", "package", PACKAGE).decode()
version = re.search(r"\bversionName=(\S+)", package_info).group(1)
version_code = int(re.search(r"\bversionCode=(\d+)", package_info).group(1))
manifest = {
    "package": PACKAGE, "version": version, "versionCode": version_code,
    "apkSha256": hashlib.sha256(APK.read_bytes()).hexdigest(),
    "sdk": adb("shell", "getprop", "ro.build.version.sdk").decode().strip(),
    "resolution": [WIDTH, HEIGHT], "density": 420,
    "method": "Original adb exec-out screencap -p; no image editing or compositing",
    "data": "Fresh empty workspace; no private data, restores or saved records",
    "screenshots": ["01-home.png", "02-cashier-settings.png"],
}
(OUT / "capture-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(manifest, ensure_ascii=False))
