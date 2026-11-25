import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('native camera policy rejects foreign origins/audio and cancels late grants without reassigning callbacks', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nasqo-camera-java-'));
  try {
    const source = path.join(root, 'flutter_app/android/app/src/main/java/com/indexesstore/nasqo_pro_erp');
    execFileSync('java', ['com.sun.tools.javac.Main', '-d', temporary,
      path.join(source, 'HybridCameraPolicy.java'), path.join(source, 'HybridCameraRequestGate.java'),
      path.join(root, 'tests/java/HybridCameraPolicyTest.java')], { stdio: 'pipe' });
    const output = execFileSync('java', ['-cp', temporary, 'HybridCameraPolicyTest'], { encoding: 'utf8' });
    assert.match(output, /checks passed/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('Android scaffold declares optional camera only, remains idempotent, and adds no microphone permission', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nasqo-camera-scaffold-'));
  try {
    fs.mkdirSync(path.join(temporary, 'scripts'));
    fs.copyFileSync(path.join(root, 'scripts/setup-android-hybrid.mjs'), path.join(temporary, 'scripts/setup-android-hybrid.mjs'));
    const app = path.join(temporary, 'flutter_app/android/app');
    fs.mkdirSync(path.join(app, 'src/main'), { recursive: true });
    fs.writeFileSync(path.join(app, 'build.gradle.kts'), 'android { defaultConfig { minSdk = flutter.minSdkVersion }; ndkVersion = flutter.ndkVersion }\n');
    const manifest = path.join(app, 'src/main/AndroidManifest.xml');
    fs.writeFileSync(manifest, '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="NASQO"></application></manifest>');
    const setup = () => execFileSync(process.execPath, [path.join(temporary, 'scripts/setup-android-hybrid.mjs')], { stdio: 'pipe' });
    setup();
    const first = fs.readFileSync(manifest, 'utf8');
    setup();
    assert.equal(fs.readFileSync(manifest, 'utf8'), first);
    assert.equal((first.match(/android.permission.CAMERA/g) ?? []).length, 1);
    for (const feature of ['android.hardware.camera', 'android.hardware.camera.any', 'android.hardware.camera.autofocus']) {
      assert.ok(first.includes(`android:name="${feature}" android:required="false"`));
    }
    assert.doesNotMatch(first, /RECORD_AUDIO|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
