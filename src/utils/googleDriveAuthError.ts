/**
 * Render safe, actionable Google Drive OAuth errors to users.
 * Never display raw SDK messages: they can include identifiers or URLs.
 */
export function describeGoogleDriveConnectError(error: unknown): string {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";

  switch (code) {
    case "auth/popup-blocked":
      return "المتصفح منع نافذة Google. اسمح بالنوافذ المنبثقة لهذا الموقع واضغط ربط Google Drive مرة أخرى.";
    case "auth/popup-closed-by-user":
      return "أُغلقت نافذة Google قبل إكمال التفويض. أعد المحاولة وأكمل اختيار الحساب والموافقة دون إغلاق النافذة.";
    case "auth/cancelled-popup-request":
      return "ألغي طلب الربط السابق بسبب طلب آخر. أغلق النوافذ الأخرى، ثم أعد المحاولة مرة واحدة.";
    case "auth/unauthorized-domain":
      return "نطاق الموقع غير مصرح به. راجع Firebase Authentication ← Settings ← Authorized domains.";
    case "auth/operation-not-allowed":
      return "مزود Google غير مفعل في Firebase Authentication ← Sign-in method.";
    case "auth/network-request-failed":
      return "تعذر الاتصال بخدمة Google. تحقق من الشبكة ثم أعد المحاولة.";
    case "auth/invalid-oauth-client-id":
    case "auth/invalid-api-key":
      return "إعداد Google OAuth أو Firebase غير صحيح. راجع تهيئة مشروع Firebase.";
    case "auth/account-exists-with-different-credential":
      return "حساب البريد مرتبط بطريقة دخول أخرى. سجّل الدخول بالطريقة الأصلية أولًا.";
    case "auth/web-storage-unsupported":
      return "تخزين جلسة Google غير متاح. راجع إعدادات الخصوصية وملفات تعريف الارتباط للمتصفح.";
    case "auth/operation-not-supported-in-this-environment":
      return "المتصفح أو بيئة المعاينة لا تدعم تسجيل الدخول المنبثق. جرّب فتح التطبيق مباشرة عبر HTTPS.";
    case "auth/too-many-requests":
      return "تعددت محاولات الربط. أعد المحاولة لاحقًا.";
    case "access_denied":
      return "لم تتم الموافقة على صلاحية Google Drive. راجع شاشة الموافقة وإعداد OAuth في Google Cloud.";
    default:
      return /^auth\/[a-z0-9-]+$/.test(code)
        ? `تعذر ربط Google Drive (الرمز: ${code}). راجع إعدادات Google OAuth.`
        : "تعذر ربط Google Drive. تحقق من نافذة التفويض وإعداد OAuth، ثم أعد المحاولة.";
  }
}
