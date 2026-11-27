/** User-facing camera failures; never expose browser/driver details or scanned content. */
export function describeQrCameraError(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "لم يُسمح بالوصول إلى الكاميرا. اسمح بالكاميرا في إعدادات Android ← التطبيقات ← NASQO PRO ERP ← الأذونات، ثم اضغط تشغيل الكاميرا مجددًا. يمكنك أيضًا رفع صورة QR أو إدخال الكود يدويًا.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "لم يُعثر على كاميرا متاحة. استخدم رفع صورة QR أو أدخل الكود يدويًا.";
    case "NotReadableError":
    case "TrackStartError":
      return "تعذر فتح الكاميرا؛ قد يستخدمها تطبيق آخر. أغلق التطبيقات التي تستخدم الكاميرا ثم أعد المحاولة، أو ارفع صورة QR.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "الكاميرا لا تدعم إعداد المسح المطلوب. يمكنك رفع صورة QR أو إدخال الكود يدويًا.";
    case "AbortError":
      return "توقف طلب تشغيل الكاميرا. اضغط تشغيل الكاميرا للمحاولة مجددًا، أو ارفع صورة QR.";
    default:
      return "تعذر تشغيل الكاميرا. أعد المحاولة؛ وإذا استمرت المشكلة استخدم رفع صورة QR أو إدخال الكود يدويًا.";
  }
}

/** Release every track, including streams granted after the scanner was closed. */
export function stopQrCameraStream(stream: Pick<MediaStream, "getTracks"> | null): void {
  for (const track of stream?.getTracks() ?? []) {
    try { track.stop(); } catch { /* Continue releasing the remaining tracks. */ }
  }
}
