import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDriveFilesListUrl,
  classifyDriveMimeType,
  DRIVE_DOC_MIME,
  DRIVE_FOLDER_MIME,
  DRIVE_SHEET_MIME,
  filterDriveFiles,
  formatDriveFileSize,
  getDriveMimeLabelAr,
  type DriveFileRecord,
} from "../src/services/googleDriveHelpers";

const sampleFiles: DriveFileRecord[] = [
  {
    id: "fld_1",
    name: "NASQO Pro Backups",
    mimeType: DRIVE_FOLDER_MIME,
    modifiedTime: "2026-11-16T08:00:00.000Z",
  },
  {
    id: "file_bkp",
    name: "backup_2026.11.16_10.15.00.back",
    mimeType: "application/json",
    size: "49152",
    modifiedTime: "2026-11-16T10:15:00.000Z",
    description: "نسخة احتياطية كاملة لنظام نسقو برو ERP",
  },
  {
    id: "file_pdf",
    name: "nasqo-invoice-1140-2026-11-10.pdf",
    mimeType: "application/pdf",
    size: "204800",
    modifiedTime: "2026-11-15T12:00:00.000Z",
  },
  {
    id: "file_sheet",
    name: "تقرير المشتريات 2026",
    mimeType: DRIVE_SHEET_MIME,
    modifiedTime: "2026-11-14T09:00:00.000Z",
  },
  {
    id: "file_doc",
    name: "عقد توريد",
    mimeType: DRIVE_DOC_MIME,
    modifiedTime: "2026-11-12T09:00:00.000Z",
  },
  {
    id: "file_trashed",
    name: "old_deleted.json",
    mimeType: "application/json",
    trashed: true,
  },
];

test("formatDriveFileSize formats bytes across units accurately", () => {
  assert.equal(formatDriveFileSize(undefined), "—");
  assert.equal(formatDriveFileSize(""), "—");
  assert.equal(formatDriveFileSize("512"), "512 B");
  assert.equal(formatDriveFileSize(49152), "48.0 KB");
  assert.equal(formatDriveFileSize(1572864), "1.5 MB");
  assert.equal(formatDriveFileSize(2 * 1024 * 1024 * 1024), "2.00 GB");
});

test("classifyDriveMimeType distinguishes folders, backups, spreadsheets, PDFs, and docs", () => {
  assert.equal(classifyDriveMimeType(DRIVE_FOLDER_MIME, "Folder"), "folder");
  assert.equal(classifyDriveMimeType("application/octet-stream", "backup.back"), "backup");
  assert.equal(classifyDriveMimeType("application/json", "export.json"), "backup");
  assert.equal(classifyDriveMimeType(DRIVE_SHEET_MIME, "Ledger"), "spreadsheet");
  assert.equal(classifyDriveMimeType("application/pdf", "invoice.pdf"), "pdf");
  assert.equal(classifyDriveMimeType(DRIVE_DOC_MIME, "Memo"), "document");
  assert.equal(getDriveMimeLabelAr("backup"), "نسخة احتياطية / JSON");
});

test("filterDriveFiles excludes trashed files and filters by category and search query", () => {
  const all = filterDriveFiles(sampleFiles, "", "all");
  assert.equal(all.length, 5);
  assert.equal(all.some((f) => f.id === "file_trashed"), false);

  const backups = filterDriveFiles(sampleFiles, "", "backups");
  assert.deepEqual(
    backups.map((f) => f.id),
    ["file_bkp"],
  );

  const folders = filterDriveFiles(sampleFiles, "", "folders");
  assert.deepEqual(
    folders.map((f) => f.id),
    ["fld_1"],
  );

  const spreadsheets = filterDriveFiles(sampleFiles, "", "spreadsheets");
  assert.deepEqual(
    spreadsheets.map((f) => f.id),
    ["file_sheet"],
  );

  const docsAndPdfs = filterDriveFiles(sampleFiles, "", "documents");
  assert.deepEqual(
    docsAndPdfs.map((f) => f.id),
    ["file_pdf", "file_doc"],
  );

  const searchResult = filterDriveFiles(sampleFiles, "1140", "all");
  assert.deepEqual(
    searchResult.map((f) => f.id),
    ["file_pdf"],
  );
});

test("buildDriveFilesListUrl constructs clean Drive v3 query URLs", () => {
  const rootUrl = buildDriveFilesListUrl({ pageSize: 40 });
  const parsedRoot = new URL(rootUrl);
  assert.equal(parsedRoot.origin, "https://www.googleapis.com");
  assert.equal(parsedRoot.pathname, "/drive/v3/files");
  assert.equal(parsedRoot.searchParams.get("pageSize"), "40");
  assert.equal(parsedRoot.searchParams.get("q"), "trashed = false");

  const folderUrl = buildDriveFilesListUrl({
    folderId: "fld_123",
    searchQuery: "nasqo's",
    pageSize: 60,
  });
  const parsedFolder = new URL(folderUrl);
  assert.equal(
    parsedFolder.searchParams.get("q"),
    "trashed = false and 'fld_123' in parents and name contains 'nasqo\\'s'",
  );
});
