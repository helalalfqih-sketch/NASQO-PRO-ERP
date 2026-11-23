package com.indexesstore.nasqo_pro_erp

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        flutterEngine.platformViewsController.registry.registerViewFactory(
            "nasqo/offline_hybrid",
            OfflineHybridViewFactory(flutterEngine.dartExecutor.binaryMessenger)
        )
    }
}
