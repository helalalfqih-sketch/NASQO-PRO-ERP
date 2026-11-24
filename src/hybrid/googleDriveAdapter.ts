import { HybridBridgeError } from "./bridge";
import { nativeDriveCall } from "./cloudSession";
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
} from "../services/googleDriveHelpers";

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
  constructor(message = "انتهت صلاحية جلسة Google Drive في تطبيق Flutter. يرجى إعادة الربط.") {
    super(message);
    this.name = "DriveAuthExpiredError";
  }
}

export class DriveApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = "DriveApiError";
    this.status = status;
  }
}

async function callFlutterDrive<T>(operation: string, args: Record<string, unknown> = {}): Promise<T> {
  try{return await nativeDriveCall<T>(operation,args);}
  catch(error){
    if(error instanceof HybridBridgeError && error.code==="UNAUTHORIZED_ACTION")throw new DriveAuthExpiredError(error.message);
    throw error;
  }
}

export async function getDriveAbout(_accessToken: string): Promise<DriveAboutInfo> {
  return callFlutterDrive<DriveAboutInfo>("getAbout");
}

export async function listDriveFiles(
  _accessToken: string,
  options: { folderId?: string | null; pageSize?: number; queryText?: string } = {},
): Promise<DriveFileRecord[]> {
  return callFlutterDrive<DriveFileRecord[]>("listFiles", options);
}

export async function findOrCreateDriveFolder(
  _accessToken: string,
  folderName: string,
  parentId?: string,
): Promise<DriveFileRecord> {
  return callFlutterDrive<DriveFileRecord>("findOrCreateFolder", { folderName, parentId });
}

export async function createDriveFolder(
  _accessToken: string,
  folderName: string,
  parentId?: string,
): Promise<DriveFileRecord> {
  return callFlutterDrive<DriveFileRecord>("createFolder", { folderName, parentId });
}

async function uploadChunks(options:{name:string;content:string|Uint8Array;mimeType:string;parentId?:string;fileId?:string;description?:string}):Promise<DriveFileRecord>{
  const bytes=typeof options.content==="string"?new TextEncoder().encode(options.content):options.content;
  const started=await callFlutterDrive<{uploadId:string}>("beginUpload",{
    name:options.name,mimeType:options.mimeType,parentId:options.parentId,fileId:options.fileId,sizeBytes:bytes.length,description:options.description,
  });
  try{
    for(let offset=0;offset<bytes.length;offset+=12000){
      const chunk=bytes.subarray(offset,offset+12000);
      const encoded=btoa(Array.from(chunk,b=>String.fromCharCode(b)).join(""));
      const result=await callFlutterDrive<{received:number}>("appendUpload",{uploadId:started.uploadId,offset,base64:encoded});
      if(result.received!==offset+chunk.length)throw new Error("لم يكتمل تجهيز الملف للرفع.");
    }
    const result=await callFlutterDrive<DriveFileRecord & {cancelled?:boolean}>("finishUpload",{uploadId:started.uploadId});
    if(result.cancelled||!result.id)throw new Error("أُلغي رفع الملف.");
    return result;
  }finally{
    await callFlutterDrive("abortUpload",{uploadId:started.uploadId}).catch(()=>undefined);
  }
}
export async function uploadFileToDrive(
  _accessToken:string,
  options:{name:string;content:string|Uint8Array;mimeType:string;parentId?:string;description?:string},
):Promise<DriveFileRecord>{return uploadChunks(options);}

export async function updateDriveFileContent(
  _accessToken:string,fileId:string,
  options:{name?:string;content:string|Uint8Array;mimeType:string;description?:string},
):Promise<DriveFileRecord>{
  if(!options.name)throw new Error("حدد اسم الملف.");
  return uploadChunks({...options,name:options.name,fileId});
}

export async function downloadDriveFileBytes(
  _accessToken:string,
  _file:DriveFileRecord,
):Promise<{bytes:Uint8Array;downloadName:string;mimeType:string}>{
  throw new Error("تنزيل ملفات Android يتم من نافذة Drive عبر منتقي الملفات المحلي.");
}

export async function trashDriveFile(_accessToken: string, fileId: string): Promise<void> {
  await callFlutterDrive<void>("trashFile", { fileId });
}

export async function deleteDriveFilePermanently(_accessToken: string, fileId: string): Promise<void> {
  void fileId;
  throw new Error("الحذف النهائي غير مفعّل في تطبيق Android؛ استخدم سلة المهملات.");
}
