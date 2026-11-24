package com.indexesstore.nasqo_pro_erp

import android.app.Activity
import android.content.Intent
import android.provider.OpenableColumns
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.Executors
import android.net.Uri
import io.flutter.plugin.common.MethodChannel
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private val backupIo = Executors.newSingleThreadExecutor()
    private var backupResult: MethodChannel.Result? = null
    private var exportFile: File? = null
    private val openBackup = 7311
    private val saveBackup = 7312
    private val maxBackupBytes = 32L * 1024 * 1024
    private fun boundedCopy(input: InputStream, output: OutputStream): Long {
        val buffer = ByteArray(65536)
        var total = 0L
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            total += n
            require(total <= maxBackupBytes)
            output.write(buffer, 0, n)
        }
        require(total > 0)
        return total
    }
    private fun backupPicker(call: io.flutter.plugin.common.MethodCall, result: MethodChannel.Result) {
        if (backupResult != null) {
            result.error("BUSY", "Backup picker already open", null)
            return
        }
        try {
            when (call.method) {
                "pickBackup" -> {
                    backupResult = result
                    startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                    }, openBackup)
                }
                "exportBackup" -> {
                    val path = call.argument<String>("path") ?: throw IllegalArgumentException()
                    val file = File(path).canonicalFile
                    require(file.path.startsWith(cacheDir.canonicalPath + File.separator) && file.isFile && file.length() in 1L..maxBackupBytes)
                    exportFile = file
                    backupResult = result
                    startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "application/octet-stream"
                        putExtra(Intent.EXTRA_TITLE, call.argument<String>("fileName") ?: "nasqo.back")
                    }, saveBackup)
                }
                "cachePath" -> result.success(cacheDir.canonicalPath)
                else -> result.notImplemented()
            }
        } catch (_: Exception) {
            backupResult = null
            exportFile = null
            result.error("PICKER_ERROR", "Unable to open document picker", null)
        }
    }
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != openBackup && requestCode != saveBackup) return
        val result = backupResult ?: return
        val sourceFile = exportFile
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            backupResult = null
            exportFile = null
            result.success(null)
            return
        }
        backupIo.execute {
            var temp: File? = null
            try {
                val value: Any = if (requestCode == openBackup) {
                    val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                        if (it.moveToFirst()) it.getString(0) else null
                    } ?: "backup.back"
                    val file = File.createTempFile("nasqo-import-", ".back", cacheDir)
                    temp = file
                    val count = contentResolver.openInputStream(uri)?.use { input ->
                        file.outputStream().use { out -> boundedCopy(input, out) }
                    } ?: throw IllegalStateException()
                    mapOf("path" to file.absolutePath, "fileName" to name.take(200), "sizeBytes" to count)
                } else {
                    val file = sourceFile ?: throw IllegalStateException()
                    contentResolver.openOutputStream(uri, "w")?.use { out ->
                        file.inputStream().use { input -> boundedCopy(input, out) }
                    } ?: throw IllegalStateException()
                    true
                }
                runOnUiThread { backupResult = null; exportFile = null; result.success(value) }
            } catch (_: Exception) {
                temp?.delete()
                runOnUiThread {
                    backupResult = null; exportFile = null
                    result.error("BACKUP_IO", "Unable to read or write backup (maximum 32 MB)", null)
                }
            }
        }
    }
    override fun onDestroy() {
        backupIo.shutdown()
        super.onDestroy()
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "nasqo/local_backup")
            .setMethodCallHandler(::backupPicker)
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
