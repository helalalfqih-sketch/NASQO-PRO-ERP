package com.indexesstore.nasqo_pro_erp

import android.content.Context
import android.print.PrintManager
import android.print.PrintAttributes
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebChromeClient
import android.webkit.ConsoleMessage
import android.webkit.WebResourceError
import android.util.Log
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.StandardMessageCodec
import io.flutter.plugin.platform.PlatformView
import io.flutter.plugin.platform.PlatformViewFactory
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.UUID

/** Ephemeral instance IDs only; never record URLs, workspace/record IDs or text. */
internal object HybridLifecycleDiagnostics {
    val processInstance: String = UUID.randomUUID().toString()
    fun log(event: String, instance: String, detail: String = "") {
        Log.i("NASQO_LIFECYCLE", "process=$processInstance instance=$instance event=$event $detail")
    }
}

/**
 * Serves the bundled React ES modules from a local HTTPS origin.
 * Every unknown path, remote request and external navigation is rejected.
 * The only native bridge is an explicit, main-frame-only NasqoHome channel.
 */
class OfflineHybridViewFactory(private val messenger: BinaryMessenger) :
    PlatformViewFactory(StandardMessageCodec.INSTANCE) {
    override fun create(context: Context, viewId: Int, args: Any?): PlatformView =
        OfflineHybridView(context, messenger, viewId)
}

private class OfflineHybridView(
    context: Context,
    messenger: BinaryMessenger,
    id: Int
) : PlatformView {
    private val origin = "https://appassets.androidplatform.net"
    private val resourcePrefix = "/offline/flutter_assets/assets/web/"
    private val assetLoader = WebViewAssetLoader.Builder()
        .setDomain("appassets.androidplatform.net")
        .addPathHandler("/offline/", WebViewAssetLoader.AssetsPathHandler(context))
        .build()

    private val webView = WebView(context)
    private val channel = MethodChannel(messenger, "nasqo/offline_hybrid/$id")
    private val instance = UUID.randomUUID().toString()
    private var pageLoads = 0
    private var started = false
    private var disposed = false

    init {
        HybridLifecycleDiagnostics.log("webview-created", instance)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            blockNetworkLoads = true
            javaScriptCanOpenWindowsAutomatically = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                // Never log financial records or restored backup content.
                return true
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                pageLoads += 1
                HybridLifecycleDiagnostics.log("page-finished", instance, "loads=$pageLoads")
            }
            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                Log.e("NASQO_HYBRID", "load-error code=${error.errorCode} mainFrame=${request.isForMainFrame}")
            }
            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                response: WebResourceResponse
            ) {
                Log.e("NASQO_HYBRID", "http-error status=${response.statusCode} mainFrame=${request.isForMainFrame}")
            }
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse {
                val url = request.url
                if (request.method != "GET" ||
                    url.scheme != "https" ||
                    url.host != "appassets.androidplatform.net" ||
                    !url.path.orEmpty().startsWith(resourcePrefix)) {
                    return denied()
                }
                return assetLoader.shouldInterceptRequest(url) ?: denied()
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                return url.scheme != "https" ||
                    url.host != "appassets.androidplatform.net" ||
                    !url.path.orEmpty().startsWith(resourcePrefix)
            }
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "NasqoHome", setOf(origin)) {
                _, message, sourceOrigin, isMainFrame, _ ->
                if (isMainFrame && sourceOrigin.toString() == origin &&
                    message.type == WebMessageCompat.TYPE_STRING) {
                    val data = message.data
                    if (data != null && data.length <= 32768) {
                        channel.invokeMethod("message", data)
                    }
                }
            }
            // Flutter registers its MethodChannel handler first, then sends "start".
        } else {
            webView.loadDataWithBaseURL(
                origin,
                "<html><body><p>Android WebView is not supported.</p></body></html>",
                "text/html",
                "UTF-8",
                null
            )
        }

        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "dispatchBack" -> {
                    // Android dialogs and external Activities consume back
                    // before Flutter. A WebView IME must consume it before JS.
                    val event = call.arguments as? String
                    if (!started || disposed || event == null || event.length > 1000) {
                        result.success("unavailable")
                    } else if (ViewCompat.getRootWindowInsets(webView)
                            ?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
                        ViewCompat.getWindowInsetsController(webView)?.hide(WindowInsetsCompat.Type.ime())
                        webView.evaluateJavascript(
                            "(function(){var e=document.activeElement;if(e&&typeof e.blur==='function')e.blur();})()", null)
                        webView.clearFocus()
                        HybridLifecycleDiagnostics.log("back-ime", instance)
                        result.success("ime")
                    } else {
                        webView.evaluateJavascript(
                            "(function(){return typeof window.__nasqoHybridReceive==='function' && window.__nasqoHybridReceive(${JSONObject.quote(event)});})()"
                        ) { accepted ->
                            // No bridge reply or listener is NEVER permission
                            // to finish Activity. Flutter awaits a correlated reply.
                            result.success(if (accepted == "true") "sent" else "unavailable")
                        }
                    }
                }
                "lifecycle" -> {
                    val state = call.arguments as? String
                    if (state in setOf("resumed", "inactive", "hidden", "paused", "detached")) {
                        HybridLifecycleDiagnostics.log("flutter-$state", instance, "loads=$pageLoads")
                        if (started && !disposed && state in setOf("inactive", "hidden", "paused")) {
                            // Best-effort extra checkpoint; React also writes
                            // every committed UI change, never only on pause.
                            webView.evaluateJavascript(
                                "window.dispatchEvent(new CustomEvent('nasqo:checkpoint'));", null)
                        }
                    }
                    // Do not loadUrl/reload or synthesize financial requests.
                    result.success(null)
                }
                "start" -> {
                    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                        result.error("UNSUPPORTED", "WebView message listener is unavailable", null)
                    } else {
                        if (!started) {
                            started = true
                            webView.loadUrl("$origin${resourcePrefix}index.html")
                        }
                        result.success(null)
                    }
                }
                "printCurrentPage" -> {
                    try {
                        val title = call.arguments as? String ?: throw IllegalArgumentException()
                        require(started && title.length in 1..160 && webView.url.orEmpty().startsWith("$origin$resourcePrefix"))
                        val manager = context.getSystemService(Context.PRINT_SERVICE) as PrintManager
                        manager.print(title, webView.createPrintDocumentAdapter(title),
                            PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build())
                        result.success(true)
                    } catch (_: Exception) {
                        result.error("PRINT_FAILED", "Unable to open Android print preview", null)
                    }
                }
                "respond" -> {
                    val response = call.arguments as? String
                    if (response == null || response.length > 24000000) {
                        result.error("INVALID_RESPONSE", "Invalid bridge response", null)
                    } else if (response.length <= 64000) {
                        webView.evaluateJavascript("window.__nasqoHybridReceive(${JSONObject.quote(response)});", null)
                        result.success(null)
                    } else {
                        val key = JSONObject.quote(UUID.randomUUID().toString())
                        fun send(offset: Int) {
                            if (offset >= response.length) {
                                webView.evaluateJavascript("(function(){var m=window.__nasqoNativeChunks;var s=m[$key].join('');delete m[$key];window.__nasqoHybridReceive(s);})()", null)
                                result.success(null)
                                return
                            }
                            val end = minOf(response.length, offset + 64000).let {
                                if (it < response.length && Character.isHighSurrogate(response[it-1])) it-1 else it
                            }
                            val quoted = JSONObject.quote(response.substring(offset,end))
                            val script = "(function(){var m=window.__nasqoNativeChunks||(window.__nasqoNativeChunks=Object.create(null));(m[$key]||(m[$key]=[])).push($quoted);})()"
                            webView.evaluateJavascript(script) { send(end) }
                        }
                        send(0)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun denied(): WebResourceResponse =
        WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))

    override fun getView(): WebView = webView

    override fun dispose() {
        disposed = true
        HybridLifecycleDiagnostics.log("webview-disposed", instance, "loads=$pageLoads")
        channel.setMethodCallHandler(null)
        webView.stopLoading()
        webView.destroy()
    }
}
