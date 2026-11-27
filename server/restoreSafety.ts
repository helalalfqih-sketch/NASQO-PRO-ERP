import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { captureWorkspaceSnapshot } from "./workspaceSnapshot.ts";
import { exportWorkspaceJsonBackup, resolveSqliteDbPath, SqliteValidationError, withTransaction } from "./sqliteDb.ts";

const reviews = new Map<string, { workspace: string; hash: string; expires: number; filePath: string }>();
export function prepareWorkspaceRestore(db: DatabaseSync, workspace: string) {
  const now = Date.now();
  for (const [key, review] of reviews) if (review.expires < now) reviews.delete(key);
  const payload = exportWorkspaceJsonBackup(db, workspace);
  const token = crypto.randomBytes(24).toString("hex");
  const main = (db.prepare("PRAGMA database_list").all() as {name:string;file:string}[]).find(x=>x.name==="main");
  const directory = path.join(path.dirname(main?.file || resolveSqliteDbPath()), "restore-safety");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const fileName = `nasqo-before-restore-${now}-${crypto.randomBytes(6).toString("hex")}.json`;
  const file = fs.openSync(path.join(directory, fileName), "wx", 0o600);
  try { fs.writeFileSync(file, JSON.stringify(payload)); fs.fsyncSync(file); } finally { fs.closeSync(file); }
  const snapshot = payload.sqliteSnapshot;
  reviews.set(token, { workspace, hash: snapshot.sha256, expires: now + 10 * 60_000, filePath: path.join(directory, fileName) });
  return { token, backupFileName: fileName, counts: Object.fromEntries(Object.entries(snapshot.tables).map(([t, rows]) => [t, rows.length])) };
}

export function readRestoreSafetyBackup(workspace: string, token: string): Buffer {
  const review = reviews.get(token);
  if (!review || review.workspace !== workspace || review.expires < Date.now()) {
    throw new SqliteValidationError("انتهت صلاحية المراجعة؛ أنشئ نسخة أمان جديدة من نافذة الاستعادة.");
  }
  return fs.readFileSync(review.filePath);
}

export function withApprovedRestore<T>(db: DatabaseSync, workspace: string, token: unknown, fn: () => T): T {
  return withTransaction(db, () => {
    const review = typeof token === "string" ? reviews.get(token) : undefined;
    if (!review || review.workspace !== workspace || review.expires < Date.now()) {
      throw new SqliteValidationError("احفظ نسخة الأمان وأكّد الاستبدال من نافذة الاستعادة أولًا؛ لم تتغير البيانات.");
    }
    if (captureWorkspaceSnapshot(db, workspace).sha256 !== review.hash) {
      throw new SqliteValidationError("تغيرت بيانات العمل بعد المراجعة؛ أعد إنشاء نسخة الأمان والتأكيد قبل الاستبدال.");
    }
    const result = fn();
    reviews.delete(token as string);
    return result;
  });
}
