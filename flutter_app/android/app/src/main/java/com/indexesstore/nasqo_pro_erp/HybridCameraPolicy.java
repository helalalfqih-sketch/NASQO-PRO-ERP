package com.indexesstore.nasqo_pro_erp;

import java.net.URI;
import java.net.URISyntaxException;

/** Camera is available only to the installed, offline application document. */
public final class HybridCameraPolicy {
    public static final String VIDEO_CAPTURE = "android.webkit.resource.VIDEO_CAPTURE";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String PAGE = "/offline/flutter_assets/assets/web/index.html";

    private HybridCameraPolicy() {}

    private static boolean trusted(URI uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) &&
                uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    public static boolean allows(String requestOrigin, String currentPage, String[] resources) {
        // Reject audio, mixed requests, future capture resources and empty requests.
        if (resources == null || resources.length != 1 || !VIDEO_CAPTURE.equals(resources[0])) return false;
        if (requestOrigin == null || currentPage == null) return false;
        try {
            URI origin = new URI(requestOrigin);
            URI page = new URI(currentPage);
            String originPath = origin.getRawPath();
            return trusted(origin) && (originPath == null || originPath.isEmpty() || "/".equals(originPath)) &&
                    origin.getRawQuery() == null && origin.getRawFragment() == null &&
                    trusted(page) && PAGE.equals(page.getRawPath()) && page.getRawQuery() == null;
        } catch (URISyntaxException | IllegalArgumentException invalid) {
            return false;
        }
    }
}
