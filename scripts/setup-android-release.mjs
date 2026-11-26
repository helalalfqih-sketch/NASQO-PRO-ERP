// Configure the generated Flutter Android scaffold for a signed release candidate.
// Do not commit key material or fall back to the debug signing key.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'flutter_app', 'android', 'app');
const file = path.join(app, 'build.gradle.kts');
for (const key of ['CM_KEYSTORE_PATH', 'CM_KEYSTORE_PASSWORD', 'CM_KEY_ALIAS', 'CM_KEY_PASSWORD']) {
  if (!process.env[key]) throw new Error('Missing signing variable: ' + key);
}
if (!fs.existsSync(process.env.CM_KEYSTORE_PATH)) throw new Error('Upload keystore not found.');
let text = fs.readFileSync(file, 'utf8');
const replaceOnce = (pattern, replacement) => {
  const matches = text.match(new RegExp(pattern.source, 'g'));
  if (matches?.length !== 1) throw new Error('Unexpected Android template: ' + pattern.source);
  text = text.replace(pattern, replacement);
};
replaceOnce(/compileSdk\s*=\s*flutter\.compileSdkVersion/, 'compileSdk = 36');
replaceOnce(/targetSdk\s*=\s*flutter\.targetSdkVersion/, 'targetSdk = 36');
if (!/applicationId\s*=\s*"com\.indexesstore\.nasqo_pro_erp"/.test(text)) {
  throw new Error('Unexpected applicationId; do not silently change the package name.');
}
replaceOnce(/android\s*\{/, `android {
    signingConfigs {
        create("release") {
            storeFile = file(requireNotNull(System.getenv("CM_KEYSTORE_PATH")))
            storePassword = requireNotNull(System.getenv("CM_KEYSTORE_PASSWORD"))
            keyAlias = requireNotNull(System.getenv("CM_KEY_ALIAS"))
            keyPassword = requireNotNull(System.getenv("CM_KEY_PASSWORD"))
        }
    }`);
replaceOnce(/signingConfig\s*=\s*signingConfigs\.getByName\("debug"\)/, 'signingConfig = signingConfigs.getByName("release")');
fs.writeFileSync(file, text);
const manifestFile = path.join(app, 'src', 'main', 'AndroidManifest.xml');
const manifest = fs.readFileSync(manifestFile, 'utf8');
if (!manifest.includes('android:label="nasqo_pro_erp"')) {
  throw new Error('Unexpected Android application label; inspect generated manifest.');
}
fs.writeFileSync(manifestFile, manifest.replace('android:label="nasqo_pro_erp"', 'android:label="NASQO PRO ERP"'));
console.log('Release scaffold configured: API 36, existing package ID, upload-key signing.');
