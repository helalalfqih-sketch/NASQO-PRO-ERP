import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function configureAndroidBrand(androidMain=path.join(root,'flutter_app/android/app/src/main')) {
  const res=path.join(androidMain,'res');
  const write=(name,text)=>{const p=path.join(res,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);};
  fs.mkdirSync(path.join(res,'drawable-nodpi'),{recursive:true});
  // Preserve the supplied artwork byte for byte; Android scales it at rendering.
  fs.copyFileSync(path.join(root,'public/assets/aistudio/NASQO_PRO_ERP_800_022d325f.png'),path.join(res,'drawable-nodpi/nasqo_logo.png'));
  for(const name of fs.readdirSync(res)) {
    if(name.startsWith('mipmap-'))fs.rmSync(path.join(res,name,'ic_launcher.png'),{force:true});
  }
  write('values/nasqo_brand.xml','<resources><color name="nasqo_launch_background">#F7F9FD</color></resources>\n');
  write('mipmap-anydpi/ic_launcher.xml',`<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item><shape><solid android:color="@color/nasqo_launch_background"/><size android:width="64dp" android:height="64dp"/></shape></item>
    <item android:width="52dp" android:height="52dp" android:gravity="center"><bitmap android:src="@drawable/nasqo_logo" android:gravity="fill"/></item>
  </layer-list>\n`);
  write('drawable/nasqo_icon_foreground.xml','<inset xmlns:android="http://schemas.android.com/apk/res/android" android:inset="24%"><bitmap android:src="@drawable/nasqo_logo" android:gravity="fill"/></inset>\n');
  write('mipmap-anydpi-v26/ic_launcher.xml','<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/nasqo_launch_background"/><foreground android:drawable="@drawable/nasqo_icon_foreground"/></adaptive-icon>\n');
  const launch=`<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/nasqo_launch_background"/>
    <item android:width="192dp" android:height="192dp" android:gravity="center"><bitmap android:src="@drawable/nasqo_logo" android:gravity="fill"/></item>
  </layer-list>\n`;
  write('drawable/launch_background.xml',launch);
  write('drawable-v21/launch_background.xml',launch);
  // Android 12 applies its own splash mask. Use the icon's padded foreground.
  const style=`<resources><style name="LaunchTheme" parent="@android:style/Theme.Light.NoTitleBar">
    <item name="android:windowBackground">@drawable/launch_background</item>
    <item name="android:windowSplashScreenBackground">@color/nasqo_launch_background</item>
    <item name="android:windowSplashScreenAnimatedIcon">@drawable/nasqo_icon_foreground</item>
    <item name="android:windowSplashScreenIconBackgroundColor">@color/nasqo_launch_background</item>
  </style></resources>\n`;
  write('values-v31/nasqo_launch.xml',style);
  write('values-night-v31/nasqo_launch.xml',style);
  const manifest=path.join(androidMain,'AndroidManifest.xml');
  let xml=fs.readFileSync(manifest,'utf8');
  if(!/android:icon="[^"]+"/.test(xml))throw new Error('Missing Android application icon');
  xml=xml.replace(/android:icon="[^"]+"/,'android:icon="@mipmap/ic_launcher"');
  fs.writeFileSync(manifest,xml);
}
