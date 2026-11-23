package com.indexesstore.nasqo_qa

import android.net.Uri
import org.json.JSONObject

/**
 * Non-invasive Kotlin compatibility adapter for the existing `HybridHomeView.kt`
 * at commit 0d734ca2ce1716de8f7005f8339f395fbd396da6.
 *
 * Design constraints:
 * - Preserves applicationId/package `com.indexesstore.nasqo_qa`.
 * - Preserves existing `WebViewCompat.addWebMessageListener(..., "NasqoHome", ...)`
 *   and `MethodChannel("nasqo/home/$id")` without replacing `HybridHomeView.kt`
 *   or `MainActivity.kt`.
 * - Keeps the existing hybrid UI as the default; loads the new React bundle
 *   (`assets/web/index.html`) ONLY when `useReactHybridV2 == true`.
 */
object NasqoProtocolCompatBridge {
    const val BRIDGE_CHANNEL_NAME = "NasqoHome"
    const val PROTOCOL_VERSION_V1 = "1.0.0"
    const val TRUSTED_LOCAL_HOST = "appassets.androidplatform.net"
    const val TRUSTED_LOCAL_ORIGIN = "https://appassets.androidplatform.net"

    /**
     * Local Flutter asset URL for the optional React Hybrid V2 bundle synced
     * into `flutter_app/assets/web/`.
     */
    const val REACT_HYBRID_V2_ENTRY_URL =
        "https://appassets.androidplatform.net/assets/flutter_assets/assets/web/index.html"

    /**
     * Resolves which local entry URL `HybridHomeView.kt` should load.
     * Existing `0d734ca` URL remains the default when [useReactHybridV2] is false.
     */
    fun resolveEntryUrl(
        useReactHybridV2: Boolean,
        existingHybridEntryUrl: String,
        initialRoute: String? = null
    ): String {
        if (!useReactHybridV2) {
            return existingHybridEntryUrl
        }
        val cleanRoute = initialRoute?.trim().orEmpty()
        return if (cleanRoute.startsWith("/")) {
            "$REACT_HYBRID_V2_ENTRY_URL#$cleanRoute"
        } else {
            REACT_HYBRID_V2_ENTRY_URL
        }
    }

    /**
     * Distinguishes new React Hybrid v1.0.0 envelopes from existing `0d734ca`
     * `NasqoHome` messages so both can coexist safely on the same channel.
     */
    fun isReactHybridV1Envelope(rawMessage: String?): Boolean {
        if (rawMessage.isNullOrBlank()) return false
        val trimmed = rawMessage.trimStart()
        if (!trimmed.startsWith("{")) return false
        return try {
            val obj = JSONObject(trimmed)
            obj.optString("protocolVersion") == PROTOCOL_VERSION_V1 &&
                obj.optString("kind") == "request" &&
                obj.has("action") &&
                obj.has("requestId")
        } catch (_: Throwable) {
            false
        }
    }

    /**
     * Defense-in-depth offline check for WebViewClient when React Hybrid V2 is active.
     * Existing native Android features (updater, signing, external intents) outside
     * the WebView are unaffected.
     */
    fun isTrustedOfflineUri(uri: Uri?): Boolean {
        if (uri == null) return false
        return uri.scheme == "https" && uri.host == TRUSTED_LOCAL_HOST
    }

    /**
     * Produces a safely escaped JavaScript snippet for delivering a JSON response
     * if `JavaScriptReplyProxy` is unavailable after a WebView reload.
     */
    fun buildSafeReceiverScript(jsonPayload: String): String {
        val quoted = JSONObject.quote(jsonPayload)
        return "window.__nasqoHybridReceive && window.__nasqoHybridReceive($quoted);"
    }
}
