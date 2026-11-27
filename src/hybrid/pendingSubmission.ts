/** Durable receipts for a user's explicit document save; never a replay queue. */
export type ReceiptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PREFIX = "nasqo:pending-document:v1:";

function browserStorage(): ReceiptStorage {
  // A financial send must not silently fall back to RAM when storage is denied.
  if (typeof window === "undefined") throw new Error("Durable receipt storage unavailable");
  return window.localStorage;
}

export class PendingSubmissionStore {
  constructor(private readonly storage: ReceiptStorage = browserStorage()) {}

  private key(workspaceId: string, documentId: string): string {
    if (!/^[A-Za-z0-9:_-]{1,150}$/.test(workspaceId) ||
        !/^[A-Za-z0-9:_-]{1,140}$/.test(documentId)) {
      throw new Error("Invalid document receipt identity");
    }
    return `${PREFIX}${encodeURIComponent(workspaceId)}:${encodeURIComponent(documentId)}`;
  }

  has(workspaceId: string, documentId: string): boolean {
    // Even a damaged marker is pending. Deleting it would permit another send.
    return this.storage.getItem(this.key(workspaceId, documentId)) !== null;
  }

  mark(workspaceId: string, documentId: string): void {
    const key = this.key(workspaceId, documentId);
    const value = JSON.stringify({ version: 1, workspaceId, documentId });
    this.storage.setItem(key, value);
    if (this.storage.getItem(key) !== value) throw new Error("Document receipt was not persisted");
  }

  confirm(workspaceId: string, documentId: string): void {
    this.storage.removeItem(this.key(workspaceId, documentId));
  }
}
