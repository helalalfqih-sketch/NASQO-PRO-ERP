package com.indexesstore.nasqo_pro_erp

import android.app.Activity
import android.content.Intent
import android.content.ClipData
import androidx.core.content.FileProvider
import android.provider.OpenableColumns
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.Executors
import java.security.MessageDigest
import android.net.Uri
import android.os.Bundle
import android.Manifest
import android.content.pm.PackageManager
import io.flutter.plugin.common.MethodChannel
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity(), HybridCameraPermissionHost {
    private val lifecycleInstance = java.util.UUID.randomUUID().toString()
    private val cameraPermissionCode = 7321
    private var cameraForeground = false
    private val cameraPermissionGate = HybridCameraRequestGate()
    private val cameraStopListeners = mutableSetOf<() -> Unit>()

    override fun requestCameraPermission(owner: Any, callback: (Boolean) -> Unit) {
        if (!cameraForeground || isFinishing || isDestroyed || !cameraPermissionGate.begin(owner) { granted -> callback(granted) }) {
            callback(false)
            return
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            cameraPermissionGate.finish(true)
            return
        }
        try {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), cameraPermissionCode)
        } catch (_: Exception) {
            cameraPermissionGate.finish(false)
        }
    }

    override fun cancelCameraPermission(owner: Any) {
        cameraPermissionGate.cancel(owner)
    }

    override fun registerCameraStopListener(listener: () -> Unit) { cameraStopListeners.add(listener) }
    override fun unregisterCameraStopListener(listener: () -> Unit) { cameraStopListeners.remove(listener) }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != cameraPermissionCode) return
        cameraPermissionGate.finish(!isFinishing && !isDestroyed && permissions.size == 1 &&
            permissions[0] == Manifest.permission.CAMERA && grantResults.size == 1 &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED)
    }

    override fun onStop() {
        cameraStopListeners.toList().forEach { it() }
        super.onStop()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        HybridLifecycleDiagnostics.log("activity-created", lifecycleInstance,
            "savedState=${savedInstanceState != null}")
    }

    override fun onResume() {
        super.onResume()
        cameraForeground = true
        HybridLifecycleDiagnostics.log("activity-resumed", lifecycleInstance)
    }

    override fun onPause() {
        cameraForeground = false
        HybridLifecycleDiagnostics.log("activity-paused", lifecycleInstance)
        super.onPause()
    }
    private val backupIo = Executors.newSingleThreadExecutor()
    private var backupResult: MethodChannel.Result? = null
    private var exportFile: File? = null
    private val openBackup = 7311
    private val saveBackup = 7312
    private val maxBackupBytes = 32L * 1024 * 1024
    private val documentTypes = mapOf("application/pdf" to ".pdf", "image/png" to ".png", "text/csv" to ".csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" to ".xlsx")
    private fun checkedDocument(call: io.flutter.plugin.common.MethodCall): Triple<File, String, String> {
        val mime = call.argument<String>("mimeType") ?: throw IllegalArgumentException()
        val extension = documentTypes[mime] ?: throw IllegalArgumentException()
        val name = call.argument<String>("fileName") ?: throw IllegalArgumentException()
        require(name.length in 1..120 && !name.startsWith(".") && !name.contains('/') &&
            !name.contains('\\') && name.none { it.code < 32 || it.code == 127 } && name.lowercase().endsWith(extension))
        val root = File(cacheDir, "nasqo-document-export").canonicalFile
        val source = File(call.argument<String>("path") ?: throw IllegalArgumentException()).canonicalFile
        require(source.path.startsWith(root.path + File.separator) && source.isFile && source.length() in 1L..(16L*1024*1024))
        return Triple(source, name, mime)
    }
    private fun documentOutput(call: io.flutter.plugin.common.MethodCall, result: MethodChannel.Result) {
        try {
            when (call.method) {
                "printDocumentFile" -> {
                    val (source, name, mime) = checkedDocument(call)
                    require(mime == "application/pdf")
                    val staged = File.createTempFile("nasqo-print-", ".pdf", cacheDir)
                    source.inputStream().use { input -> staged.outputStream().use { out -> boundedCopy(input,out) } }
                    val manager = getSystemService(android.content.Context.PRINT_SERVICE) as android.print.PrintManager
                    manager.print(name, object : android.print.PrintDocumentAdapter() {
                        override fun onLayout(old: android.print.PrintAttributes?, next: android.print.PrintAttributes?, signal: android.os.CancellationSignal, callback: LayoutResultCallback, extras: Bundle?) {
                            if(signal.isCanceled) { callback.onLayoutCancelled(); return }
                            callback.onLayoutFinished(android.print.PrintDocumentInfo.Builder(name).setContentType(android.print.PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(android.print.PrintDocumentInfo.PAGE_COUNT_UNKNOWN).build(),true)
                        }
                        override fun onWrite(pages: Array<android.print.PageRange>, destination: android.os.ParcelFileDescriptor, signal: android.os.CancellationSignal, callback: WriteResultCallback) {
                            if(signal.isCanceled){callback.onWriteCancelled();return}
                            try { staged.inputStream().use { input -> java.io.FileOutputStream(destination.fileDescriptor).use { out -> boundedCopy(input,out) } }; callback.onWriteFinished(arrayOf(android.print.PageRange.ALL_PAGES)) }
                            catch(e:Exception){callback.onWriteFailed("تعذر طباعة المستند")}
                        }
                        override fun onFinish(){staged.delete()}
                    },null)
                    result.success(true)
                }
                "shareDocument" -> {
                    val (source, name, mime) = checkedDocument(call)
                    val folder = File(cacheDir, "nasqo-shared-documents")
                    folder.mkdirs()
                    folder.listFiles()?.filter { System.currentTimeMillis()-it.lastModified() > 86400000L }?.forEach { it.deleteRecursively() }
                    val sub = File(folder, "share-" + java.util.UUID.randomUUID().toString())
                    require(sub.mkdir())
                    val target = File(sub, name)
                    source.inputStream().use { input -> target.outputStream().use { out -> boundedCopy(input, out) } }
                    val uri = FileProvider.getUriForFile(this, packageName + ".documents", target)
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = mime
                        putExtra(Intent.EXTRA_STREAM, uri)
                        clipData = ClipData.newRawUri(name, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(Intent.createChooser(send, "مشاركة المستند"))
                    result.success(true)
                }
                "shareText" -> {
                    val title = call.argument<String>("title") ?: "نسقو برو"
                    val text = call.argument<String>("text") ?: throw IllegalArgumentException()
                    val phone = call.argument<String>("phone") ?: ""
                    require(title.length <= 200 && text.length in 1..12000 && (phone.isEmpty() || Regex("^[0-9]{7,15}$").matches(phone)))
                    var targeted = false
                    if (phone.isNotEmpty()) {
                        val uri = Uri.Builder().scheme("https").authority("wa.me").appendPath(phone).appendQueryParameter("text",text).build()
                        for (pkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
                            try {
                                startActivity(Intent(Intent.ACTION_VIEW, uri).setPackage(pkg))
                                targeted = true
                                break
                            } catch (_: Exception) {}
                        }
                    }
                    if (!targeted) {
                        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_SUBJECT,title)
                            putExtra(Intent.EXTRA_TEXT,text)
                        },title))
                    }
                    result.success(mapOf("opened" to true, "targeted" to targeted))
                }
                else -> result.notImplemented()
            }
        } catch (_: Exception) {
            result.error("DOCUMENT_OUTPUT_FAILED", "Unable to open document output", null)
        }
    }
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
    private fun digest(input: InputStream): ByteArray {
        val sha = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(65536)
        var total = 0L
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            total += n
            require(total <= maxBackupBytes)
            sha.update(buffer, 0, n)
        }
        require(total > 0)
        return sha.digest()
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
                "exportDocument" -> {
                    val (file, name, mime) = checkedDocument(call)
                    exportFile = file
                    backupResult = result
                    startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = mime
                        putExtra(Intent.EXTRA_TITLE, name)
                    }, saveBackup)
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
                    // A provider accepting a write is not enough for safe
                    // replacement. Reopen the saved document and check bytes.
                    val expected = file.inputStream().use { digest(it) }
                    val saved = contentResolver.openInputStream(uri)?.use { digest(it) }
                        ?: throw IllegalStateException()
                    require(MessageDigest.isEqual(expected, saved))
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
        HybridLifecycleDiagnostics.log("activity-destroyed", lifecycleInstance,
            "configurationChange=$isChangingConfigurations")
        backupIo.shutdown()
        cameraStopListeners.toList().forEach { it() }
        cameraStopListeners.clear()
        super.onDestroy()
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "nasqo/local_backup")
            .setMethodCallHandler(::backupPicker)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "nasqo/document_output")
            .setMethodCallHandler(::documentOutput)
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
            OfflineHybridViewFactory(flutterEngine.dartExecutor.binaryMessenger, this)
        )
    }
}
