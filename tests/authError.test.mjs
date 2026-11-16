import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { describeGoogleSignInError } from "../src/utils/authError.ts";

test("Google sign-in errors give targeted configuration steps", () => {
  assert.match(describeGoogleSignInError({ code: "auth/unauthorized-domain" }), /Authorized domains/);
  assert.match(describeGoogleSignInError({ code: "auth/operation-not-allowed" }), /Sign-in method/);
  assert.match(describeGoogleSignInError({ code: "auth/invalid-oauth-client-id" }), /OAuth/);
});

test("Google sign-in popup and network failures give actionable feedback", () => {
  assert.match(describeGoogleSignInError({ code: "auth/popup-blocked" }), /المنبثقة/);
  assert.match(describeGoogleSignInError({ code: "auth/popup-closed-by-user" }), /إغلاق/);
  assert.match(describeGoogleSignInError({ code: "auth/network-request-failed" }), /الإنترنت/);
});

test("Google sign-in errors do not expose SDK messages or tokens", () => {
  const secretMessage = "SECRET_TOKEN_SHOULD_NEVER_APPEAR";
  for (const error of [
    new Error(secretMessage),
    { code: "auth/unknown-new-error", message: secretMessage },
    { code: "invalid", message: secretMessage },
    null,
  ]) {
    assert.equal(describeGoogleSignInError(error).includes(secretMessage), false);
  }
  assert.match(describeGoogleSignInError({ code: "auth/unknown-new-error" }), /auth\/unknown-new-error/);
});


test("regular Google login never requests Drive scopes", () => {
  const firebaseSource = readFileSync(new URL("../src/firebase.ts", import.meta.url), "utf8");
  const signInBody = firebaseSource
    .split("export async function signInWithGoogle(): Promise<User> {")[1]
    ?.split("\n}")[0];
  assert.ok(signInBody, "Expected signInWithGoogle implementation");
  assert.match(signInBody, /new GoogleAuthProvider\(\)/);
  assert.doesNotMatch(signInBody, /buildGoogleDriveProvider|GOOGLE_WORKSPACE_SCOPES|\.addScope\(/);
  const driveBody = firebaseSource
    .split("export async function connectGoogleDrive():")[1]
    ?.split("\n}")[0];
  assert.ok(driveBody, "Expected separate Google Drive connection");
  assert.match(driveBody, /buildGoogleDriveProvider\(\)/);
});
