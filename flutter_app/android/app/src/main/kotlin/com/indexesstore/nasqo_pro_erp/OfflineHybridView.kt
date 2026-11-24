package com.indexesstore.nasqo_pro_erp

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebChromeClient
import android.webkit.ConsoleMessage
import android.webkit.WebResourceError
import android.util.Log
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
    private var started = false

    init {
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
                Log.i("NASQO_HYBRID", "pageFinished url=$url")

            }
            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                Log.e("NASQO_HYBRID", "loadError=${request.url} code=${error.errorCode} reason=${error.description}")
            }
            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                response: WebResourceResponse
            ) {
                Log.e("NASQO_HYBRID", "httpError=${request.url} status=${response.statusCode}")
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
        channel.setMethodCallHandler(null)
        webView.stopLoading()
        webView.destroy()
    }
}
