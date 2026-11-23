// READ-ONLY REFERENCE SNIPPET for existing `flutter_app/android/app/build.gradle.kts`
// DO NOT replace existing `settings.gradle.kts`, `build.gradle.kts`, signingConfigs,
// or update-channel configuration from commit 0d734ca2ce1716de8f7005f8339f395fbd396da6.
//
// Verify only that:
// 1) `applicationId = "com.indexesstore.nasqo_qa"` remains unchanged.
// 2) `androidx.webkit:webkit` (already used by `HybridHomeView.kt` at 0d734ca) is present:
//
// dependencies {
//     implementation("androidx.webkit:webkit:1.11.0")
// }
//
// 3) Existing signingConfigs, release/staging flavors, and updater endpoints remain untouched.
