import com.google.wireless.android.vending.developer.signing.tools.extern.export.ExportEncryptedPrivateKeyTool;

/** Keeps passwords in process memory rather than command-line arguments. */
public final class PlayKeyExport {
  private static String required(String name) {
    String value = System.getenv(name);
    if (value == null || value.isEmpty()) throw new IllegalStateException("Missing " + name);
    return value;
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 3) throw new IllegalArgumentException("Expected keystore, Google public key, output");
    ExportEncryptedPrivateKeyTool.main(new String[] {
      "--keystore=" + args[0],
      "--alias=" + required("NASQO_ANDROID_KEY_ALIAS"),
      "--keystore-pass=" + required("NASQO_ANDROID_STORE_PASSWORD"),
      "--key-pass=" + required("NASQO_ANDROID_KEY_PASSWORD"),
      "--output=" + args[2],
      "--include-cert", "--rsa-aes-encryption", "--encryption-key-path=" + args[1]
    });
  }
}
