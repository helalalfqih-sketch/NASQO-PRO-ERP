import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'flutter_app', 'android', 'app', 'build.gradle.kts');
if (!fs.existsSync(file)) {
  throw new Error('Generate flutter_app/android first with flutter create --platforms=android --org=com.indexesstore .');
}
let original = fs.readFileSync(file, 'utf8');
original = original.replace(/minSdk\s*=\s*(?:flutter\.minSdkVersion|\d+)/, 'minSdk = 23');
original = original.replace(/ndkVersion\s*=\s*(?:flutter\.ndkVersion|"[^"]+")/, 'ndkVersion = "27.0.12077973"');
if (!original.includes('minSdk = 23') || !original.includes('ndkVersion = "27.0.12077973"')) {
  throw new Error('Unable to configure Firebase-compatible Android SDK');
}
fs.writeFileSync(file, original);
const manifest = path.join(root, 'flutter_app', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
let xml = fs.readFileSync(manifest, 'utf8');
if (!xml.includes('android.permission.INTERNET')) {
  xml = xml.replace('<application', '<uses-permission android:name="android.permission.INTERNET" />\n    <application');
  fs.writeFileSync(manifest, xml);
}
// QR camera only: Android runtime permission is requested after the camera
// button invokes getUserMedia. Do not request microphone or storage access.
if (!xml.includes('android.permission.CAMERA')) {
  xml = xml.replace('<application', '<uses-permission android:name="android.permission.CAMERA" />\n    <application');
}
// CAMERA otherwise implies a required rear camera/autofocus in Play filtering.
for (const feature of ['android.hardware.camera', 'android.hardware.camera.any', 'android.hardware.camera.autofocus']) {
  if (!xml.includes(`android:name="${feature}"`)) {
    xml = xml.replace('<application', `<uses-feature android:name="${feature}" android:required="false" />\n    <application`);
  }
}
fs.writeFileSync(manifest, xml);
// Restrict document sharing to a dedicated cache subtree. The system
// chooser grants temporary read access only to the explicitly selected file.
if (!xml.includes('android:authorities="${applicationId}.documents"')) {
  xml = xml.replace('</application>', '    <provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.documents" android:exported="false" android:grantUriPermissions="true">\n      <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/nasqo_document_paths" />\n    </provider>\n</application>');
  fs.writeFileSync(manifest, xml);
}
const xmlDir = path.join(path.dirname(manifest), 'res', 'xml');
fs.mkdirSync(xmlDir, {recursive:true});
fs.writeFileSync(path.join(xmlDir,'nasqo_document_paths.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<paths xmlns:android="http://schemas.android.com/apk/res/android"><cache-path name="documents" path="nasqo-shared-documents/" /></paths>\n');
const dependency = 'implementation("androidx.webkit:webkit:1.12.1")';
if (!original.includes(dependency)) {
  fs.appendFileSync(file, `\n// Local, offline React ES module loading through WebViewAssetLoader.\ndependencies {\n    ${dependency}\n}\n`);
}
console.log('[android-hybrid] WebViewAssetLoader dependency configured.');
