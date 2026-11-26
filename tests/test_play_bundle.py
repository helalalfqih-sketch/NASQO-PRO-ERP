import json
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/verify-play-bundle.py'

class PlayBundleValidation(unittest.TestCase):
    def run_check(self, alignment=16384, target=36, package='com.indexesstore.nasqo_pro_erp'):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            # Minimal ELF64 fixture with one load segment; no app/customer data.
            elf = bytearray(120)
            elf[:6] = b'\x7fELF\x02\x01'
            struct.pack_into('<Q', elf, 32, 64)
            struct.pack_into('<HH', elf, 54, 56, 1)
            struct.pack_into('<IIQQQQQQ', elf, 64, 1, 5, 0, 0, 0, 120, 120, alignment)
            with zipfile.ZipFile(root / 'test.aab', 'w') as archive:
                archive.writestr('base/lib/arm64-v8a/libsynthetic.so', elf)
            (root / 'manifest.xml').write_text(f'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{package}" android:versionCode="1145" android:versionName="1.0.145"><uses-sdk android:minSdkVersion="23" android:targetSdkVersion="{target}"/><application android:debuggable="false"/></manifest>')
            (root / 'config.txt').write_text('PAGE_ALIGNMENT_16K')
            result = subprocess.run([sys.executable, str(SCRIPT), str(root/'test.aab'), str(root/'manifest.xml'), str(root/'config.txt'), str(root/'out.json'), '1145'], capture_output=True, text=True)
            return result

    def test_accepts_valid_64_bit_layout(self):
        self.assertEqual(self.run_check().returncode, 0)

    def test_rejects_4k_native_library(self):
        result = self.run_check(alignment=4096)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Unaligned ELF', result.stderr)

    def test_rejects_old_target_sdk(self):
        self.assertNotEqual(self.run_check(target=35).returncode, 0)

    def test_rejects_changed_package(self):
        self.assertNotEqual(self.run_check(package='com.example.other').returncode, 0)

if __name__ == '__main__':
    unittest.main()
