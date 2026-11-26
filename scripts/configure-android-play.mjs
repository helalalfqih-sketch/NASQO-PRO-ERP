import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Applied only to the generated Android scaffold for an explicit Play build.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'flutter_app/android');
const edits = [
  ['app/build.gradle.kts', [
    [/compileSdk\s*=\s*(?:flutter\.compileSdkVersion|\d+)/, 'compileSdk = 36'],
    [/targetSdk\s*=\s*(?:flutter\.targetSdkVersion|\d+)/, 'targetSdk = 36'],
  ]],
  ['settings.gradle.kts', [
    [/id\("com\.android\.application"\) version "[^"]+"/, 'id("com.android.application") version "8.9.2"'],
  ]],
  ['gradle/wrapper/gradle-wrapper.properties', [
    [/gradle-[\d.]+-(?:all|bin)\.zip/, 'gradle-8.11.1-all.zip'],
  ]],
];
const outputs = edits.map(([name, replacements]) => {
  const file = path.join(root, name);
  let source = fs.readFileSync(file, 'utf8');
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(source)) throw new Error(`Android scaffold changed: ${name}`);
    source = source.replace(pattern, replacement);
  }
  return [file, source];
});
for (const [file, source] of outputs) fs.writeFileSync(file, source);
console.log('Play scaffold: compile/target API 36, AGP 8.9.2, Gradle 8.11.1; package/signing unchanged.');
