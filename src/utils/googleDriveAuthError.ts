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
    case "GOOGLE_CONFIG_MISSING":
      return "إعداد ربط Google غير مكتمل في هذه النسخة من التطبيق. يلزم إصدار مُعدّ للربط؛ بياناتك المحلية متاحة دون Google Drive.";
    case "GOOGLE_PROVIDER_CONFIG":
      return "تعذر اعتماد تسجيل الدخول من هذه النسخة. يلزم التحقق من إعداد Google في Firebase ومعرّف OAuth وشهادة توقيع التطبيق. (GOOGLE_PROVIDER_CONFIG)";
    case "GOOGLE_AUTH_CANCELLED":
      return "أُلغي اختيار حساب Google. اضغط ربط Google Drive عندما تكون مستعدًا لإكمال الاختيار.";
    case "GOOGLE_SCOPE_DENIED":
      return "لم تُمنح صلاحية ملفات Google Drive الخاصة بالتطبيق. أعد الربط ووافق على هذه الصلاحية للمتابعة.";
    case "GOOGLE_ACCOUNT_MISMATCH":
      return "حساب Drive لا يطابق حساب Google المسجّل في التطبيق. اختر الحساب نفسه وأعد الربط.";
    case "GOOGLE_NETWORK_ERROR":
      return "تعذر الاتصال بخدمة Google. تحقق من الشبكة ثم أعد الربط؛ بياناتك المحلية متاحة دون الإنترنت.";
    case "GOOGLE_AUTH_EXPIRED":
      return "انتهت جلسة Google Drive. أعد ربط الحساب للمتابعة.";
    case "GOOGLE_TIMEOUT":
    case "TIMEOUT":
      return "انتهت مهلة ربط Google Drive. أكمل أو أغلق شاشة اختيار الحساب، ثم أعد الربط.";
    case "DRIVE_API_DISABLED":
      return "خدمة Google Drive API غير مفعّلة لمشروع التطبيق. يلزم تفعيلها في Google Cloud ثم إعادة الربط. (DRIVE_API_DISABLED)";
    case "DRIVE_PERMISSION_DENIED":
      return "رفض Google Drive صلاحية الوصول. أعد الربط بالحساب الصحيح؛ إذا استمر الرفض، يلزم مراجعة صلاحيات المشروع. (DRIVE_PERMISSION_DENIED)";
    case "DRIVE_RATE_LIMITED":
      return "بلغت خدمة Google Drive حد الطلبات المتاح. انتظر قليلًا ثم أعد المحاولة.";
    case "DUPLICATE_REQUEST":
      return "توجد عملية Google جارية. انتظر اكتمالها ثم أعد الربط مرة واحدة.";
    case "UNAUTHORIZED_ACTION":
      return "جلسة Google Drive غير متاحة. أعد ربط الحساب للمتابعة.";
    case "GOOGLE_AUTH_FAILED":
    case "GOOGLE_CONNECTION_INCOMPLETE":
      return `لم يكتمل ربط Google Drive (الرمز: ${code}). أعد المحاولة؛ إذا استمر العطل، أرسل هذا الرمز للدعم.`;
    case "SERVICE_UNAVAILABLE":
    case "INTERNAL_ERROR":
      return `تعذر إكمال ربط Google Drive داخل التطبيق (الرمز: ${code}). أعد المحاولة؛ إذا استمر العطل، أرسل هذا الرمز للدعم.`;
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
