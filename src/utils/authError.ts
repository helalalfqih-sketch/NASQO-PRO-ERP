/**
 * Display actionable Firebase Authentication errors without exposing tokens or
 * potentially sensitive details from the underlying SDK error message.
 */
export function describeGoogleSignInError(error: unknown): string {
  const code =
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";

  switch (code) {
    case "auth/unauthorized-domain":
      return "نطاق الموقع غير مُصرّح به في Firebase Authentication. أضف نطاق الموقع إلى Authorized domains في مشروع Firebase.";
    case "auth/operation-not-allowed":
      return "تسجيل الدخول باستخدام Google غير مفعّل. فعّل مزود Google من Firebase Authentication > Sign-in method.";
    case "auth/popup-blocked":
      return "المتصفح حظر نافذة تسجيل الدخول. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.";
    case "auth/popup-closed-by-user":
      return "تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية.";
    case "auth/cancelled-popup-request":
      return "تم إلغاء طلب تسجيل الدخول السابق. أعد المحاولة مرة واحدة.";
    case "auth/network-request-failed":
      return "تعذر الاتصال بخدمة تسجيل الدخول. تحقق من اتصال الإنترنت ثم أعد المحاولة.";
    case "auth/invalid-api-key":
      return "إعداد Firebase API Key غير صحيح. راجع إعدادات المشروع.";
    case "auth/invalid-oauth-client-id":
      return "معرّف عميل Google OAuth غير صحيح. راجع إعداد مزود Google في Firebase.";
    case "auth/account-exists-with-different-credential":
      return "هذا البريد مرتبط بطريقة دخول أخرى. استخدم طريقة الدخول المرتبطة بالحساب أولًا.";
    case "auth/web-storage-unsupported":
      return "التخزين المطلوب لتسجيل الدخول غير متاح في هذا المتصفح. تحقق من إعدادات خصوصية الموقع.";
    default:
      return /^auth\/[a-z0-9-]+$/.test(code)
        ? `تعذر تسجيل الدخول عبر Google (رمز الخطأ: ${code}). راجع إعدادات Firebase.`
        : "تعذر إتمام تسجيل الدخول عبر Google. حاول مرة أخرى أو استخدم مساحة العمل المحلية.";
  }
}
