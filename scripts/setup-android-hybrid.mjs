import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'flutter_app', 'android', 'app', 'build.gradle.kts');
if (!fs.existsSync(file)) {
  throw new Error('Generate flutter_app/android first with flutter create --platforms=android --org=com.indexesstore .');
}
const original = fs.readFileSync(file, 'utf8');
const dependency = 'implementation("androidx.webkit:webkit:1.12.1")';
if (!original.includes(dependency)) {
  fs.appendFileSync(file, `\n// Local, offline React ES module loading through WebViewAssetLoader.\ndependencies {\n    ${dependency}\n}\n`);
}
console.log('[android-hybrid] WebViewAssetLoader dependency configured.');
