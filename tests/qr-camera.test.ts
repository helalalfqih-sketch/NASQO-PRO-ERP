import assert from "node:assert/strict";
import { test } from "node:test";
import { describeQrCameraError, stopQrCameraStream } from "../src/utils/qrCamera";

test("permission denial explains Android permission recovery and alternative input", () => {
  const message = describeQrCameraError({ name: "NotAllowedError", message: "private device detail" });
  assert.match(message, /إعدادات Android/);
  assert.match(message, /الأذونات/);
  assert.match(message, /مجددًا/);
  assert.match(message, /يدويًا/);
  assert.doesNotMatch(message, /private device detail/);
});

test("missing and busy devices have distinct actionable errors", () => {
  const absent = describeQrCameraError({ name: "NotFoundError" });
  const busy = describeQrCameraError({ name: "NotReadableError" });
  assert.notEqual(absent, busy);
  assert.match(absent, /كاميرا متاحة/);
  assert.match(busy, /تطبيق آخر/);
});

test("unknown errors do not imply permission denial or expose arbitrary exception text", () => {
  const message = describeQrCameraError(new Error("sensitive input"));
  assert.match(message, /أعد المحاولة/);
  assert.doesNotMatch(message, /الأذونات|sensitive input/);
});

test("camera cleanup attempts every track even when one track throws", () => {
  const stopped: number[] = [];
  stopQrCameraStream({ getTracks: () => [
    { stop() { stopped.push(1); throw new Error("already removed"); } },
    { stop() { stopped.push(2); } },
  ] as MediaStreamTrack[] });
  assert.deepEqual(stopped, [1, 2]);
  stopQrCameraStream(null);
});
