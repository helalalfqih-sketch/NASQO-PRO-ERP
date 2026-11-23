package com.indexesstore.nasqo_pro_erp

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
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
        webView.webViewClient = object : WebViewClient() {
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
            webView.loadUrl("$origin${resourcePrefix}index.html")
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
                "respond" -> {
                    val response = call.arguments as? String
                    if (response == null || response.length > 4000000) {
                        result.error("INVALID_RESPONSE", "Invalid bridge response", null)
                    } else {
                        // Quote as a JavaScript *string*, never interpolate executable source.
                        webView.evaluateJavascript(
                            "window.__nasqoHybridReceive(${JSONObject.quote(response)});",
                            null
                        )
                        result.success(null)
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
