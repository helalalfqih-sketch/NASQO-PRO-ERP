import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeGoogleDriveConnectError } from "../src/utils/googleDriveAuthError.ts";

test("Drive popup failures expose an actionable localized message", () => {
  assert.match(describeGoogleDriveConnectError({ code: "auth/popup-blocked" }), /النوافذ المنبثقة/);
  assert.match(describeGoogleDriveConnectError({ code: "auth/popup-closed-by-user" }), /الموافقة/);
  assert.match(describeGoogleDriveConnectError({ code: "auth/cancelled-popup-request" }), /ألغي/);
});

test("Drive OAuth configuration and network errors have distinct messages", () => {
  assert.match(describeGoogleDriveConnectError({ code: "auth/unauthorized-domain" }), /Authorized domains/);
  assert.match(describeGoogleDriveConnectError({ code: "auth/operation-not-allowed" }), /Sign-in method/);
  assert.match(describeGoogleDriveConnectError({ code: "auth/network-request-failed" }), /الشبكة/);
  assert.match(describeGoogleDriveConnectError({ code: "access_denied" }), /OAuth/);
});

test("Drive error output never leaks opaque or sensitive SDK messages", () => {
  for (const input of [
    new Error("SECRET_TOKEN"),
    { code: "auth/some-new-error", message: "SECRET_TOKEN" },
    { code: "random", message: "SECRET_TOKEN" },
    null,
  ]) {
    const message = describeGoogleDriveConnectError(input);
    assert.equal(message.includes("SECRET_TOKEN"), false);
  }
});

test("Drive permissions stay limited to individual files", () => {
  const src = readFileSync(new URL("../src/firebase.ts", import.meta.url), "utf8");
  const scopeBlock = src.match(/export const GOOGLE_WORKSPACE_SCOPES = \[([\s\S]*?)\] as const;/);
  assert.ok(scopeBlock, "Missing Drive scope declaration");
  const scopes = [...scopeBlock[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scopes, ["https://www.googleapis.com/auth/drive.file"]);

  const login = src.split("export async function signInWithGoogle(): Promise<User> {")[1]?.split("\n}")[0];
  assert.ok(login);
  assert.doesNotMatch(login, /buildGoogleDriveProvider|GOOGLE_WORKSPACE_SCOPES/);
  const driveConnect = src.split("export async function connectGoogleDrive():")[1]?.split("\n}")[0];
  assert.ok(driveConnect);
  assert.match(driveConnect, /buildGoogleDriveProvider/);
});
