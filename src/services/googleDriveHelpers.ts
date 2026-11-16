export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_DOC_MIME = "application/vnd.google-apps.document";
export const DRIVE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const DRIVE_SLIDES_MIME = "application/vnd.google-apps.presentation";

export type DriveFileKind =
  | "folder"
  | "backup"
  | "spreadsheet"
  | "document"
  | "pdf"
  | "image"
  | "other";

export type DriveCategoryFilter =
  | "all"
  | "backups"
  | "folders"
  | "spreadsheets"
  | "documents";

export interface DriveFileRecord {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  iconLink?: string;
  parents?: string[];
  trashed?: boolean;
  description?: string;
}

export function formatDriveFileSize(bytesInput?: string | number | null): string {
  if (bytesInput === undefined || bytesInput === null || bytesInput === "") {
    return "—";
  }
  const bytes = typeof bytesInput === "number" ? bytesInput : Number(bytesInput);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function classifyDriveMimeType(mimeType: string, fileName = ""): DriveFileKind {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(fileName || "").toLowerCase();

  if (mime === DRIVE_FOLDER_MIME) return "folder";
  if (
    name.endsWith(".back") ||
    name.endsWith(".json") ||
    mime === "application/json" ||
    mime === "text/json"
  ) {
    return "backup";
  }
  if (
    mime === DRIVE_SHEET_MIME ||
    mime.includes("spreadsheet") ||
    mime === "text/csv" ||
    name.endsWith(".xlsx") ||
    name.endsWith(".csv")
  ) {
    return "spreadsheet";
  }
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    mime === DRIVE_DOC_MIME ||
    mime === DRIVE_SLIDES_MIME ||
    mime.includes("wordprocessing") ||
    mime.startsWith("text/")
  ) {
    return "document";
  }
  if (mime.startsWith("image/")) return "image";
  if (name.includes("nasqo") || name.includes("backup")) {
    return "backup";
  }
  return "other";
}

export function getDriveMimeLabelAr(kind: DriveFileKind): string {
  switch (kind) {
    case "folder":
      return "مجلد";
    case "backup":
      return "نسخة احتياطية / JSON";
    case "spreadsheet":
      return "جدول بيانات";
    case "pdf":
      return "ملف PDF";
    case "document":
      return "مستند";
    case "image":
      return "صورة";
    default:
      return "ملف";
  }
}

export function filterDriveFiles(
  files: readonly DriveFileRecord[],
  search: string,
  category: DriveCategoryFilter = "all",
): DriveFileRecord[] {
  const needle = String(search || "").trim().toLowerCase();

  return files.filter((file) => {
    if (file.trashed) return false;
    const kind = classifyDriveMimeType(file.mimeType, file.name);

    if (category === "backups" && kind !== "backup") return false;
    if (category === "folders" && kind !== "folder") return false;
    if (category === "spreadsheets" && kind !== "spreadsheet") return false;
    if (category === "documents" && kind !== "document" && kind !== "pdf") return false;

    if (!needle) return true;
    return (
      file.name.toLowerCase().includes(needle) ||
      (file.description ?? "").toLowerCase().includes(needle) ||
      getDriveMimeLabelAr(kind).toLowerCase().includes(needle)
    );
  });
}

export function buildDriveFilesListUrl(options?: {
  folderId?: string | null;
  pageSize?: number;
  searchQuery?: string;
  includeTrashed?: boolean;
}): string {
  const params = new URLSearchParams();
  params.set("pageSize", String(Math.min(100, Math.max(1, options?.pageSize ?? 50))));
  params.set(
    "fields",
    "files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,parents,trashed,description)",
  );
  params.set("orderBy", "folder,modifiedTime desc");
  params.set("supportsAllDrives", "true");
  params.set("includeItemsFromAllDrives", "true");

  const clauses: string[] = [];
  if (!options?.includeTrashed) {
    clauses.push("trashed = false");
  }
  if (options?.folderId) {
    const escapedParent = options.folderId.replace(/'/g, "\\'");
    clauses.push(`'${escapedParent}' in parents`);
  }
  const cleanSearch = options?.searchQuery?.trim();
  if (cleanSearch) {
    const escapedTerm = cleanSearch.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    clauses.push(`name contains '${escapedTerm}'`);
  }
  if (clauses.length > 0) {
    params.set("q", clauses.join(" and "));
  }
  return `https://www.googleapis.com/drive/v3/files?${params.toString()}`;
}
