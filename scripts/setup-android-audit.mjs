import fs from 'node:fs';
const base='flutter_app/android/app';
const gradle=base+'/build.gradle.kts';
let s=fs.readFileSync(gradle,'utf8').replace('defaultConfig {','defaultConfig {\n        testInstrumentationRunner = "com.nasqo.audit.DocumentInstrumentation"');
fs.writeFileSync(gradle,s);
fs.mkdirSync(base+'/src/androidTest/java',{recursive:true});
fs.cpSync('qa/android-receiver/src',base+'/src/androidTest/java',{recursive:true});
fs.cpSync('qa/android-receiver/assets',base+'/src/androidTest/assets',{recursive:true});
fs.writeFileSync(base+'/src/androidTest/AndroidManifest.xml',`<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name="com.nasqo.audit.ReceiverActivity" android:exported="true" android:label="NASQO Test Receiver"><intent-filter><action android:name="android.intent.action.SEND"/><category android:name="android.intent.category.DEFAULT"/><data android:mimeType="*/*"/></intent-filter></activity></application></manifest>`);
