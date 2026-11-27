import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { hybridBridge, HybridBridgeError } from "../src/hybrid/bridge";
import {
  clearNativeDriveMarker, connectNativeDrive, nativeDriveMarker,
  NATIVE_DRIVE_MARKER, refreshNativeDrive, disconnectNativeDrive,
} from "../src/hybrid/cloudSession";
import type { HybridErrorPayload, HybridRequestEnvelope } from "../src/hybrid/contracts";
import { describeGoogleDriveConnectError } from "../src/utils/googleDriveAuthError";
import { DriveAuthExpiredError, listDriveFiles } from "../src/hybrid/googleDriveAdapter";

function reply(request: HybridRequestEnvelope, body: Record<string, unknown>) {
  assert.equal(hybridBridge.handleInbound({
    protocolVersion: request.protocolVersion, kind: "response",
    requestId: request.requestId, action: request.action, ...body,
  }), true);
}

afterEach(() => {
  hybridBridge.resetForTesting();
  clearNativeDriveMarker();
});

test("native Drive errors reach localized UI without raw credentials or popup advice", async () => {
  const codes: HybridErrorPayload["code"][] = [
    "GOOGLE_CONFIG_MISSING", "GOOGLE_PROVIDER_CONFIG", "GOOGLE_AUTH_CANCELLED",
    "GOOGLE_SCOPE_DENIED", "GOOGLE_ACCOUNT_MISMATCH", "GOOGLE_NETWORK_ERROR",
    "GOOGLE_AUTH_EXPIRED", "GOOGLE_AUTH_FAILED", "GOOGLE_TIMEOUT",
    "DRIVE_API_DISABLED", "DRIVE_PERMISSION_DENIED", "DRIVE_RATE_LIMITED",
  ];
  const messages = new Set<string>();
  for (const code of codes) {
    const actions: string[] = [];
    hybridBridge.setTransportForTesting({ postMessage(serialized) {
      const request = JSON.parse(serialized);
      actions.push(`${request.action}:${request.payload.operation}`);
      reply(request, { ok: false, error: {
        code, message: "SECRET_TOKEN private@example.invalid https://private.invalid",
        retryable: false,
      } });
    } });
    await assert.rejects(connectNativeDrive(), (error: unknown) => {
      assert.ok(error instanceof HybridBridgeError);
      assert.equal(error.code, code);
      const message = describeGoogleDriveConnectError(error);
      assert.doesNotMatch(message, /SECRET_TOKEN|private@example|private\.invalid|نافذة التفويض/);
      messages.add(message);
      return true;
    });
    assert.equal(nativeDriveMarker(), null);
    assert.deepEqual(actions, ["googleDriveAction:connect"]);
  }
  assert.equal(messages.size, codes.length, "each cause needs distinct guidance");
});

test("cancelled native chooser remains retryable and never reports Drive connected", async () => {
  const actions: string[] = [];
  let cancelled = true;
  hybridBridge.setTransportForTesting({ postMessage(serialized) {
    const request = JSON.parse(serialized);
    actions.push(`${request.action}:${request.payload.operation}`);
    const data = request.action === "cloudIdentityAction" ? { signedIn: true } :
      cancelled ? { connected: false, cancelled: true } : { connected: true, configured: true };
    reply(request, { ok: true, data });
  } });
  await assert.rejects(connectNativeDrive(), (error: unknown) => {
    assert.ok(error instanceof HybridBridgeError);
    assert.equal(error.code, "GOOGLE_AUTH_CANCELLED");
    assert.match(describeGoogleDriveConnectError(error), /أُلغي اختيار/);
    return true;
  });
  assert.equal(nativeDriveMarker(), null);
  cancelled = false;
  await connectNativeDrive();
  assert.equal(nativeDriveMarker(), NATIVE_DRIVE_MARKER);
  assert.deepEqual(actions, ["googleDriveAction:connect", "cloudIdentityAction:status", "googleDriveAction:connect"]);
});

test("rapid duplicate connect taps share one native account chooser", async () => {
  const requests: HybridRequestEnvelope[] = [];
  hybridBridge.setTransportForTesting({ postMessage(serialized) {
    requests.push(JSON.parse(serialized));
  } });
  const first = connectNativeDrive();
  const second = connectNativeDrive(true);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(requests.length, 1);
  reply(requests[0], { ok: true, data: { connected: true, configured: true } });
  await Promise.all([first, second]);
  assert.equal(nativeDriveMarker(), NATIVE_DRIVE_MARKER);
  assert.equal(requests.length, 1);
});

test("incomplete connect response cannot create a connected marker", async () => {
  for (const connected of [false, "true", 1, undefined]) {
    hybridBridge.setTransportForTesting({ postMessage(serialized) {
      const request = JSON.parse(serialized);
      reply(request, { ok: true, data: { connected } });
    } });
    await assert.rejects(connectNativeDrive(), { code: "GOOGLE_CONNECTION_INCOMPLETE" });
    assert.equal(nativeDriveMarker(), null);
  }
});

test("expired, mismatched or scope-denied account clears the connected gate without automatic reauthorization", async () => {
  for (const code of ["GOOGLE_AUTH_EXPIRED", "GOOGLE_ACCOUNT_MISMATCH", "GOOGLE_SCOPE_DENIED"]) {
    const operations: string[] = [];
    hybridBridge.setTransportForTesting({ postMessage(serialized) {
      const request = JSON.parse(serialized);
      operations.push(request.payload.operation);
      reply(request, request.payload.operation === "connect"
        ? { ok: true, data: { connected: true, configured: true } }
        : { ok: false, error: { code, message: "PRIVATE_PROVIDER_BODY" } });
    } });
    await connectNativeDrive();
    assert.equal(nativeDriveMarker(), NATIVE_DRIVE_MARKER);
    await assert.rejects(listDriveFiles(NATIVE_DRIVE_MARKER), (error: unknown) => {
      assert.ok(error instanceof DriveAuthExpiredError);
      assert.doesNotMatch(error.message, /PRIVATE_PROVIDER_BODY/);
      return true;
    });
    assert.equal(nativeDriveMarker(), null);
    assert.deepEqual(operations, ["connect", "listFiles"]);
  }
});

test("late status cannot restore a connected marker after disconnect", async () => {
  const operations: string[] = [];
  let statusRequest: HybridRequestEnvelope | undefined;
  hybridBridge.setTransportForTesting({ postMessage(serialized) {
    const request = JSON.parse(serialized);
    operations.push(request.payload.operation);
    if (request.payload.operation === "status") statusRequest = request;
    else reply(request, { ok: true, data: { connected: request.payload.operation === "connect" } });
  } });
  await connectNativeDrive();
  const refreshing = refreshNativeDrive();
  await Promise.resolve();
  assert.ok(statusRequest);
  const disconnecting = disconnectNativeDrive();
  assert.equal(nativeDriveMarker(), null);
  reply(statusRequest, { ok: true, data: { connected: true } });
  assert.equal(await refreshing, null);
  await disconnecting;
  assert.equal(nativeDriveMarker(), null);
  assert.deepEqual(operations, ["connect", "status", "disconnect"]);
});

test("disconnect invalidates an in-flight successful connect", async () => {
  let connectRequest: HybridRequestEnvelope | undefined;
  hybridBridge.setTransportForTesting({ postMessage(serialized) {
    const request = JSON.parse(serialized);
    if (request.payload.operation === "connect") connectRequest = request;
    else reply(request, { ok: true, data: { connected: false } });
  } });
  const connecting = connectNativeDrive();
  const rejected = assert.rejects(connecting, { code: "GOOGLE_AUTH_CANCELLED" });
  await Promise.resolve();
  assert.ok(connectRequest);
  const disconnecting = disconnectNativeDrive();
  reply(connectRequest, { ok: true, data: { connected: true } });
  await rejected;
  await disconnecting;
  assert.equal(nativeDriveMarker(), null);
});
