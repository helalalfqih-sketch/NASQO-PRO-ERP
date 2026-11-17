import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

type Mode = "local" | "password" | "unconfigured";
const COOKIE = "nasqo_sqlite_session";
const SESSION_SECONDS = 12 * 3600;
const attempts = new Map<string, { count: number; until: number }>();

function isLocal(req: Request): boolean {
  const addr = req.socket.remoteAddress ?? "";
  // Do not trust X-Forwarded-For, X-Real-IP or caller-supplied Host alone.
  return (addr === "::1" || addr === "127.0.0.1" || addr === "::ffff:127.0.0.1") &&
    /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.get("host") ?? "");
}
export function validateSqliteProductionConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  if ((process.env.NASQO_SQLITE_ADMIN_PASSWORD ?? "").length < 12 ||
      (process.env.NASQO_SQLITE_SESSION_SECRET ?? "").length < 32) {
    throw new Error("Production SQLite requires a 12+ character admin password and a 32+ character session secret.");
  }
  const origin = process.env.NASQO_SQLITE_PUBLIC_ORIGIN ?? "";
  if (origin.startsWith("https://") && process.env.NASQO_SQLITE_SECURE_COOKIE !== "1") {
    throw new Error("HTTPS SQLite deployments must enable NASQO_SQLITE_SECURE_COOKIE=1.");
  }
}

export function accessMode(req: Request): Mode {
  if (isLocal(req)) return "local";
  const password = process.env.NASQO_SQLITE_ADMIN_PASSWORD ?? "";
  const secret = process.env.NASQO_SQLITE_SESSION_SECRET ?? "";
  return password.length >= 12 && secret.length >= 32 ? "password" : "unconfigured";
}
function safeMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function passwordHash(): string {
  return createHash("sha256").update(process.env.NASQO_SQLITE_ADMIN_PASSWORD ?? "").digest("hex");
}
function sign(value: string): string {
  return createHmac("sha256", process.env.NASQO_SQLITE_SESSION_SECRET ?? "")
    .update(value + ":" + passwordHash()).digest("hex");
}
function sessionValid(req: Request): boolean {
  const cookie = (req.get("cookie") ?? "").split(";")
    .map(c => c.trim()).find(c => c.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (!cookie) return false;
  const parts = cookie.split(".");
  if (parts.length !== 3 || !/^\d{10,13}$/.test(parts[0]) ||
    !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return false;
  const expiry = Number(parts[0]);
  if (!Number.isSafeInteger(expiry) || expiry < Date.now() || expiry > Date.now() + SESSION_SECONDS * 1000) return false;
  return safeMatch(parts[2], sign(parts[0] + "." + parts[1]));
}
function cookieOptions(): string {
  const secure = process.env.NASQO_SQLITE_SECURE_COOKIE === "1" ? "; Secure" : "";
  return "HttpOnly; SameSite=Strict; Path=/; Max-Age=" + SESSION_SECONDS + secure;
}
function originAllowed(req: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.get("origin");
  if (!origin) return req.get("x-nasqo-csrf") === "1";
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const explicit = process.env.NASQO_SQLITE_PUBLIC_ORIGIN?.replace(/\/$/, "");
    return origin === explicit || url.host === req.get("host");
  } catch { return false; }
}
export function sqliteStatus(req: Request): { mode: Mode; authenticated: boolean } {
  const mode = accessMode(req);
  return { mode, authenticated: mode === "local" || (mode === "password" && sessionValid(req)) };
}
export function sqliteLogin(req: Request, res: Response): void {
  if (!originAllowed(req)) { res.status(403).json({ error: "مصدر الطلب غير موثوق." }); return; }
  const mode = accessMode(req);
  if (mode === "local") { res.json({ ok: true }); return; }
  if (mode !== "password") { res.status(503).json({ error: "يلزم إعداد كلمة مرور المدير ومفتاح الجلسة على الخادم." }); return; }
  const id = req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const state = attempts.get(id);
  if (state && state.until > now && state.count >= 5) {
    res.status(429).json({ error: "محاولات كثيرة. حاول لاحقًا." }); return;
  }
  const supplied = typeof req.body?.password === "string" ? req.body.password : "";
  const correct = process.env.NASQO_SQLITE_ADMIN_PASSWORD ?? "";
  const match = safeMatch(createHash("sha256").update(supplied).digest("hex"),
    createHash("sha256").update(correct).digest("hex"));
  if (!match) {
    attempts.set(id, {
      count: state && state.until > now ? state.count + 1 : 1,
      until: state && state.until > now ? state.until : now + 10 * 60_000,
    });
    res.status(401).json({ error: "كلمة المرور غير صحيحة." }); return;
  }
  attempts.delete(id);
  const stamp = String(Date.now() + SESSION_SECONDS * 1000);
  const nonce = randomBytes(16).toString("hex");
  const body = stamp + "." + nonce;
  res.setHeader("Set-Cookie", COOKIE + "=" + body + "." + sign(body) + "; " + cookieOptions());
  res.json({ ok: true });
}
export function sqliteLogout(req: Request, res: Response): void {
  if (!originAllowed(req)) { res.status(403).json({ error: "مصدر الطلب غير موثوق." }); return; }
  res.setHeader("Set-Cookie", COOKIE + "=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  res.json({ ok: true });
}
export function requireSqliteAccess(req: Request, res: Response, next: NextFunction): void {
  if (!originAllowed(req)) { res.status(403).json({ error: "الطلب غير موثوق." }); return; }
  const status = sqliteStatus(req);
  if (status.mode === "unconfigured") {
    res.status(503).json({ error: "قاعدة SQLite محمية. اضبط بيانات المدير أولًا." }); return;
  }
  if (!status.authenticated) { res.status(401).json({ error: "يلزم تسجيل الدخول للوصول إلى قاعدة SQLite." }); return; }
  next();
}
