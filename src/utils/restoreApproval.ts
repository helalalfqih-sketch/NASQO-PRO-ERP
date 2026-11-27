export type RestoreReview = { fileName: string; backupFileName: string; counts: Record<string, number>; downloadBackup?: () => Promise<void> };
let handler: ((review: RestoreReview) => Promise<boolean>) | undefined;
export function registerRestoreApproval(next: typeof handler) {
  handler = next;
  return () => { if (handler === next) handler = undefined; };
}
export async function requestRestoreApproval(review: RestoreReview): Promise<boolean> {
  if (!handler) throw new Error("افتح نافذة استعادة النسخة للمراجعة والتأكيد؛ لم تتغير بيانات العمل.");
  return handler(review);
}
