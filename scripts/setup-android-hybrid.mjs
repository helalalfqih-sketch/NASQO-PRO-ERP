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
const dependency = 'implementation("androidx.webkit:webkit:1.12.1")';
if (!original.includes(dependency)) {
  fs.appendFileSync(file, `\n// Local, offline React ES module loading through WebViewAssetLoader.\ndependencies {\n    ${dependency}\n}\n`);
}
console.log('[android-hybrid] WebViewAssetLoader dependency configured.');
