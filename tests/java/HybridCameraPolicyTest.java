import com.indexesstore.nasqo_pro_erp.HybridCameraPolicy;
import com.indexesstore.nasqo_pro_erp.HybridCameraRequestGate;
import java.util.ArrayList;
import java.util.List;

public final class HybridCameraPolicyTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        String origin = "https://appassets.androidplatform.net";
        String page = origin + "/offline/flutter_assets/assets/web/index.html";
        String[] video = { HybridCameraPolicy.VIDEO_CAPTURE };
        check(HybridCameraPolicy.allows(origin, page, video), "local video allowed");
        check(HybridCameraPolicy.allows(origin + "/", page + "#scanner", video), "origin slash and page fragment allowed");
        for (String untrusted : new String[] {
                "https://example.com", "http://appassets.androidplatform.net", "file:///index.html",
                "https://appassets.androidplatform.net.evil.test", "https://user@appassets.androidplatform.net",
                "https://appassets.androidplatform.net:8443", origin + "/offline", origin + "?camera=1", origin + "#camera" }) {
            check(!HybridCameraPolicy.allows(untrusted, page, video), "reject origin " + untrusted);
        }
        for (String untrustedPage : new String[] {
                "https://example.com/index.html", origin + "/offline/other.html",
                origin + "/offline/flutter_assets/assets/web/../index.html", page + "?redirect=external",
                "http://appassets.androidplatform.net/offline/flutter_assets/assets/web/index.html" }) {
            check(!HybridCameraPolicy.allows(origin, untrustedPage, video), "reject document " + untrustedPage);
        }
        check(!HybridCameraPolicy.allows(origin, page, new String[] {"android.webkit.resource.AUDIO_CAPTURE"}), "no microphone");
        check(!HybridCameraPolicy.allows(origin, page, new String[] {HybridCameraPolicy.VIDEO_CAPTURE, "android.webkit.resource.AUDIO_CAPTURE"}), "no mixed request");
        check(!HybridCameraPolicy.allows(origin, page, new String[] {}), "no empty resources");
        check(!HybridCameraPolicy.allows(origin, page, new String[] {"future-resource"}), "unknown resource denied");
        check(!HybridCameraPolicy.allows(null, page, video), "null origin denied");

        HybridCameraRequestGate gate = new HybridCameraRequestGate();
        Object first = new Object(); Object second = new Object();
        List<Boolean> firstResults = new ArrayList<>(); List<Boolean> secondResults = new ArrayList<>();
        check(gate.begin(first, firstResults::add), "first starts");
        check(!gate.begin(second, secondResults::add), "concurrent request blocked");
        gate.cancel(second);
        check(firstResults.isEmpty(), "other owner cannot cancel");
        gate.cancel(first);
        gate.cancel(first);
        check(firstResults.equals(List.of(false)), "cancel resolves once without grant");
        check(!gate.begin(second, secondResults::add), "canceled OS request cannot be reused early");
        gate.finish(true);
        check(firstResults.equals(List.of(false)), "late permission grant ignored");
        check(gate.begin(second, secondResults::add), "new request starts after OS result");
        gate.finish(true); gate.finish(true);
        check(secondResults.equals(List.of(true)), "matching result delivered once");
        check(gate.begin(first, firstResults::add), "permission denial can retry explicitly");
        gate.finish(false);
        check(firstResults.equals(List.of(false, false)), "OS denial propagated");
        System.out.println("Native camera origin/resource and request ownership checks passed.");
    }
}
