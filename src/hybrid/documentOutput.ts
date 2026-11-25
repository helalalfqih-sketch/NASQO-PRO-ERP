import { hybridBridge } from "./bridge";

export function usesNativeDocumentOutput(): boolean {
  return import.meta.env?.VITE_NASQO_HYBRID === "1" ||
    (typeof window !== "undefined" && Boolean(window.__nasqoHybridReady));
}

const workspaceId = "local-erp-workspace";
const MAX_BYTES = 16 * 1024 * 1024;
const CHUNK = 20 * 1024;
function encodeChunk(bytes: Uint8Array): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
  return btoa(raw);
}

export async function outputNativeDocument(
  bytes: Uint8Array, filename: string, mimeType: "application/pdf" | "image/png" | "text/csv" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  mode: "save" | "share" | "print" = "save",
): Promise<boolean> {
  if (!usesNativeDocumentOutput() || !hybridBridge.hasNativeTransport()) throw new Error("خدمة الملفات المحلية غير متاحة");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) throw new Error("حجم المستند خارج الحد المدعوم (16 MB)");
  const name = filename.replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(0,120);
  const {exportId} = await hybridBridge.invoke<"beginDocumentExport",{exportId:string}>("beginDocumentExport",
    {workspaceId,fileName:name,mimeType,sizeBytes:bytes.byteLength,mode});
  let finished = false;
  try {
    for (let offset=0;offset<bytes.length;offset+=CHUNK) {
      const part=bytes.subarray(offset,offset+CHUNK);
      const result=await hybridBridge.invoke<"appendDocumentExport",{received:number}>("appendDocumentExport",
        {workspaceId,exportId,offset,base64:encodeChunk(part)});
      if(result.received!==offset+part.length)throw new Error("تعذر التحقق من نقل المستند");
    }
    const result=await hybridBridge.invoke<"finishDocumentExport",{completed:boolean;mode:string}>("finishDocumentExport",
      {workspaceId,exportId},{timeoutMs:300_000});
    finished=true;
    return result.completed===true&&result.mode===mode;
  } finally {
    if(!finished)await hybridBridge.invoke("abortDocumentExport",{workspaceId,exportId}).catch(()=>{});
  }
}

export async function shareNativeText(title:string,text:string,phone?:string):Promise<{opened:boolean;targeted:boolean}>{
  if(!hybridBridge.hasNativeTransport())throw new Error("خدمة المشاركة المحلية غير متاحة");
  return hybridBridge.invoke("shareText",{workspaceId,title,text,...(phone&&/^[0-9]{7,15}$/.test(phone)?{phone}:{})});
}
