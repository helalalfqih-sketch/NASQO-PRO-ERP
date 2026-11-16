import { clearGoogleAccessToken } from "../firebase";
import {
  buildDriveFilesListUrl,
  classifyDriveMimeType,
  DRIVE_DOC_MIME,
  DRIVE_FOLDER_MIME,
  DRIVE_SHEET_MIME,
  DRIVE_SLIDES_MIME,
  filterDriveFiles,
  formatDriveFileSize,
  getDriveMimeLabelAr,
  type DriveCategoryFilter,
  type DriveFileKind,
  type DriveFileRecord,
} from "./googleDriveHelpers";

export {
  buildDriveFilesListUrl,
  classifyDriveMimeType,
  DRIVE_DOC_MIME,
  DRIVE_FOLDER_MIME,
  DRIVE_SHEET_MIME,
  DRIVE_SLIDES_MIME,
  filterDriveFiles,
  formatDriveFileSize,
  getDriveMimeLabelAr,
  type DriveCategoryFilter,
  type DriveFileKind,
  type DriveFileRecord,
};

export interface DriveAboutInfo {
  user?: {
    displayName?: string;
    emailAddress?: string;
    photoLink?: string;
  };
  storageQuota?: {
    limit?: string;
    usage?: string;
    usageInDrive?: string;
  };
}

export class DriveAuthExpiredError extends Error {
  constructor(message = "انتهت صلاحية جلسة Google Drive. يرجى تسجيل الدخول مرة أخرى.") {
    super(message);
    this.name = "DriveAuthExpiredError";
  }
}

export class DriveApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DriveApiError";
    this.status = status;
  }
}

async function parseDriveErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    if (data?.error?.message) return data.error.message;
  } catch {
    // Ignore non-JSON error body
  }
  return `HTTP ${res.status}`;
}

async function driveFetch(
  url: string,
  accessToken: string,
  init?: RequestInit,
): Promise<Response> {
  if (!accessToken) {
    throw new DriveAuthExpiredError();
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearGoogleAccessToken();
    throw new DriveAuthExpiredError();
  }
  if (!res.ok) {
    const msg = await parseDriveErrorMessage(res);
    throw new DriveApiError(res.status, msg);
  }
  return res;
}

export async function getDriveAbout(accessToken: string): Promise<DriveAboutInfo> {
  const res = await driveFetch(
    "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink),storageQuota(limit,usage,usageInDrive)",
    accessToken,
  );
  return (await res.json()) as DriveAboutInfo;
}

export async function listDriveFiles(
  accessToken: string,
  options?: {
    folderId?: string | null;
    pageSize?: number;
    searchQuery?: string;
  },
): Promise<DriveFileRecord[]> {
  const url = buildDriveFilesListUrl(options);
  const res = await driveFetch(url, accessToken);
  const data = (await res.json()) as { files?: DriveFileRecord[] };
  return Array.isArray(data.files) ? data.files : [];
}

export async function findOrCreateDriveFolder(
  accessToken: string,
  folderName: string,
  parentId?: string,
): Promise<DriveFileRecord> {
  const escapedName = folderName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const clauses = [
    `mimeType = '${DRIVE_FOLDER_MIME}'`,
    `name = '${escapedName}'`,
    "trashed = false",
  ];
  if (parentId) {
    clauses.push(`'${parentId.replace(/'/g, "\\'")}' in parents`);
  }
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    pageSize: "5",
    fields: "files(id,name,mimeType,modifiedTime,webViewLink,parents)",
  });
  const searchRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    accessToken,
  );
  const found = (await searchRes.json()) as { files?: DriveFileRecord[] };
  if (found.files && found.files.length > 0) {
    return found.files[0];
  }
  return createDriveFolder(accessToken, folderName, parentId);
}

export async function createDriveFolder(
  accessToken: string,
  folderName: string,
  parentId?: string,
): Promise<DriveFileRecord> {
  const metadata: Record<string, unknown> = {
    name: folderName.trim() || "NASQO Pro",
    mimeType: DRIVE_FOLDER_MIME,
  };
  if (parentId) {
    metadata.parents = [parentId];
  }
  const res = await driveFetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,modifiedTime,webViewLink,parents",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    },
  );
  return (await res.json()) as DriveFileRecord;
}

function buildMultipartBody(
  metadata: Record<string, unknown>,
  content: string | Uint8Array,
  mimeType: string,
): { body: Blob; contentTypeHeader: string } {
  const boundary = `nasqo_drive_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const encoder = new TextEncoder();

  const metadataPart =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`;

  const closingPart = `\r\n--${boundary}--`;
  const contentBytes = typeof content === "string" ? encoder.encode(content) : content;

  const body = new Blob([
    encoder.encode(metadataPart),
    contentBytes.buffer.slice(
      contentBytes.byteOffset,
      contentBytes.byteOffset + contentBytes.byteLength,
    ) as ArrayBuffer,
    encoder.encode(closingPart),
  ]);

  return {
    body,
    contentTypeHeader: `multipart/related; boundary=${boundary}`,
  };
}

export async function uploadFileToDrive(
  accessToken: string,
  params: {
    name: string;
    content: string | Uint8Array;
    mimeType: string;
    parentId?: string;
    description?: string;
  },
): Promise<DriveFileRecord> {
  const metadata: Record<string, unknown> = {
    name: params.name,
    mimeType: params.mimeType || "application/octet-stream",
  };
  if (params.parentId) {
    metadata.parents = [params.parentId];
  }
  if (params.description) {
    metadata.description = params.description;
  }

  const { body, contentTypeHeader } = buildMultipartBody(
    metadata,
    params.content,
    params.mimeType,
  );

  const res = await driveFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink,parents,description",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": contentTypeHeader },
      body,
    },
  );
  return (await res.json()) as DriveFileRecord;
}

export async function updateDriveFileContent(
  accessToken: string,
  fileId: string,
  params: {
    name?: string;
    content: string | Uint8Array;
    mimeType: string;
    description?: string;
  },
): Promise<DriveFileRecord> {
  const metadata: Record<string, unknown> = {};
  if (params.name) metadata.name = params.name;
  if (params.description !== undefined) metadata.description = params.description;

  const { body, contentTypeHeader } = buildMultipartBody(
    metadata,
    params.content,
    params.mimeType,
  );

  const res = await driveFetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink,parents,description`,
    accessToken,
    {
      method: "PATCH",
      headers: { "Content-Type": contentTypeHeader },
      body,
    },
  );
  return (await res.json()) as DriveFileRecord;
}

export async function downloadDriveFileBytes(
  accessToken: string,
  file: Pick<DriveFileRecord, "id" | "name" | "mimeType">,
): Promise<{ bytes: Uint8Array; downloadName: string; mimeType: string }> {
  if (file.mimeType === DRIVE_SHEET_MIME) {
    const res = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=text%2Fcsv`,
      accessToken,
    );
    const buf = new Uint8Array(await res.arrayBuffer());
    return {
      bytes: buf,
      downloadName: file.name.endsWith(".csv") ? file.name : `${file.name}.csv`,
      mimeType: "text/csv;charset=utf-8",
    };
  }
  if (file.mimeType === DRIVE_DOC_MIME || file.mimeType === DRIVE_SLIDES_MIME) {
    const res = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=application%2Fpdf`,
      accessToken,
    );
    const buf = new Uint8Array(await res.arrayBuffer());
    return {
      bytes: buf,
      downloadName: file.name.endsWith(".pdf") ? file.name : `${file.name}.pdf`,
      mimeType: "application/pdf",
    };
  }

  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
    accessToken,
  );
  const buf = new Uint8Array(await res.arrayBuffer());
  return {
    bytes: buf,
    downloadName: file.name,
    mimeType: file.mimeType || "application/octet-stream",
  };
}

export async function trashDriveFile(
  accessToken: string,
  fileId: string,
): Promise<DriveFileRecord> {
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,trashed`,
    accessToken,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    },
  );
  return (await res.json()) as DriveFileRecord;
}

export async function deleteDriveFilePermanently(
  accessToken: string,
  fileId: string,
): Promise<void> {
  await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    accessToken,
    { method: "DELETE" },
  );
}
