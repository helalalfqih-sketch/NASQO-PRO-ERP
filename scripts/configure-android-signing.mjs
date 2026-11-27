import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'flutter_app/android/app/build.gradle.kts');
for (const name of ['NASQO_ANDROID_KEYSTORE_PATH','NASQO_ANDROID_STORE_PASSWORD',
    'NASQO_ANDROID_KEY_ALIAS','NASQO_ANDROID_KEY_PASSWORD']) {
  if (!process.env[name]) throw new Error('Missing signing configuration: ' + name);
}
if (!fs.existsSync(process.env.NASQO_ANDROID_KEYSTORE_PATH)) {
  throw new Error('Missing temporary signing keystore');
}
let gradle = fs.readFileSync(file,'utf8');
const defaultSigning = /signingConfig\s*=\s*signingConfigs\.getByName\("debug"\)/;
if (!defaultSigning.test(gradle) || !/\bbuildTypes\s*\{/.test(gradle)) {
  throw new Error('Generated Gradle template changed; refusing fallback to debug signing');
}
gradle = gradle.replace(/\bbuildTypes\s*\{/, `signingConfigs {
        create("nasqoRelease") {
            storeFile = file(requireNotNull(System.getenv("NASQO_ANDROID_KEYSTORE_PATH")))
            storePassword = requireNotNull(System.getenv("NASQO_ANDROID_STORE_PASSWORD"))
            keyAlias = requireNotNull(System.getenv("NASQO_ANDROID_KEY_ALIAS"))
            keyPassword = requireNotNull(System.getenv("NASQO_ANDROID_KEY_PASSWORD"))
        }
    }

    buildTypes {`);
gradle = gradle.replace(defaultSigning, 'signingConfig = signingConfigs.getByName("nasqoRelease")');
fs.writeFileSync(file, gradle);
console.log('Configured non-debug signing for Android release.');
