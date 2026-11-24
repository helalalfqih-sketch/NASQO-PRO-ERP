package com.indexesstore.nasqo_pro_erp

import android.content.Intent
import android.net.Uri
import io.flutter.plugin.common.MethodChannel
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "nasqo/android_updates")
            .setMethodCallHandler { call, result ->
                if (call.method != "openDownload") {
                    result.notImplemented()
                } else {
                    val url = call.arguments as? String
                    val allowed = Regex("^https://github\\.com/helalalfqih-sketch/NASQO-PRO-ERP/releases/download/android-preview-v[1-9][0-9]{0,8}/NASQO-PRO-ERP\\.apk$")
                    if (url == null || !allowed.matches(url)) {
                        result.error("INVALID_URL", "Unexpected download URL", null)
                    } else {
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                            result.success(null)
                        } catch (_: Exception) {
                            result.error("OPEN_FAILED", "No browser available", null)
                        }
                    }
                }
            }
        flutterEngine.platformViewsController.registry.registerViewFactory(
            "nasqo/offline_hybrid",
            OfflineHybridViewFactory(flutterEngine.dartExecutor.binaryMessenger)
        )
    }
}
