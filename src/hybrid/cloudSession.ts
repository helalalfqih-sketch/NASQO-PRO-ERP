import { hybridBridge, HybridBridgeError } from "./bridge";

export type NativeCloudProfile = {
  configured?: boolean; signedIn?: boolean; connected?: boolean;
  email?: string | null; displayName?: string | null; cancelled?: boolean;
};
export const NATIVE_DRIVE_MARKER = "flutter-managed-drive-session";
let driveProfile: NativeCloudProfile = { connected: false };
let driveRevision = 0;
const listeners = new Set<(marker: string | null) => void>();
let identityProfile:NativeCloudProfile|null=null;
const identityListeners=new Set<(profile:NativeCloudProfile|null)=>void>();
function setIdentity(profile:NativeCloudProfile){
  identityProfile=profile;
  for(const listener of identityListeners) {
    try { listener(profile); } catch (error) { console.error("Native identity listener failed", error); }
  }
}
export function subscribeNativeIdentity(listener:(profile:NativeCloudProfile|null)=>void){
  identityListeners.add(listener);listener(identityProfile);
  return ()=>{identityListeners.delete(listener);};
}
let queue: Promise<unknown> = Promise.resolve();
let statusRequest: Promise<string | null> | null = null;
let connectRequest: Promise<NativeCloudProfile> | null = null;

// Keep all interactive Google requests sequential. The native account
// chooser and document picker cannot safely be opened by parallel requests.
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
}
export const nativeDriveMarker = () => driveProfile.connected === true ? NATIVE_DRIVE_MARKER : null;
export const nativeDriveProfile = () => ({ ...driveProfile });
function setDriveProfile(profile: NativeCloudProfile) {
  driveProfile = profile;
  for (const listener of listeners) {
    try { listener(nativeDriveMarker()); } catch (error) { console.error("Native Drive listener failed", error); }
  }
}
export function clearNativeDriveMarker() { driveRevision += 1; setDriveProfile({connected:false}); }
export function subscribeNativeDrive(listener: (marker: string | null) => void) {
  listeners.add(listener);
  listener(nativeDriveMarker());
  return () => { listeners.delete(listener); };
}
export function isNativeDriveSessionInvalid(error: unknown): error is HybridBridgeError {
  return error instanceof HybridBridgeError && [
    "UNAUTHORIZED_ACTION", "GOOGLE_AUTH_EXPIRED", "GOOGLE_ACCOUNT_MISMATCH", "GOOGLE_SCOPE_DENIED",
  ].includes(error.code);
}
export function nativeDriveCall<T>(operation: string, args: Record<string,unknown> = {}): Promise<T> {
  return enqueue(async () => {
    try {
      return await hybridBridge.invoke<"googleDriveAction", T>("googleDriveAction",
        {operation,args}, {timeoutMs: 600_000});
    } catch (error) {
      if (isNativeDriveSessionInvalid(error)) clearNativeDriveMarker();
      throw error;
    }
  });
}
export function refreshNativeDrive(): Promise<string|null> {
  if (statusRequest) return statusRequest;
  const revision = driveRevision;
  const p = nativeDriveCall<NativeCloudProfile>("status").then(profile => {
    if (revision === driveRevision) setDriveProfile(profile);
    return nativeDriveMarker();
  });
  statusRequest = p;
  void p.then(() => { if(statusRequest===p)statusRequest=null; }, () => { if(statusRequest===p)statusRequest=null; });
  return p;
}
export function connectNativeDrive(chooseAccount=false): Promise<NativeCloudProfile> {
  // A rapid second tap must not queue another account chooser after the first.
  if (connectRequest) return connectRequest;
  const request = performDriveConnect(chooseAccount);
  connectRequest = request;
  void request.then(
    () => { if (connectRequest === request) connectRequest = null; },
    () => { if (connectRequest === request) connectRequest = null; },
  );
  return request;
}
async function performDriveConnect(chooseAccount: boolean): Promise<NativeCloudProfile> {
  clearNativeDriveMarker();
  const revision = driveRevision;
  const result=await nativeDriveCall<NativeCloudProfile>("connect",{chooseAccount});
  if (revision !== driveRevision) {
    throw new HybridBridgeError("GOOGLE_AUTH_CANCELLED", "أُلغي طلب ربط Google Drive السابق.");
  }
  setDriveProfile(result);
  if (result.connected !== true){
    await nativeIdentity("status").catch(()=>undefined);
    throw new HybridBridgeError(
      result.cancelled ? "GOOGLE_AUTH_CANCELLED" : "GOOGLE_CONNECTION_INCOMPLETE",
      result.cancelled ? "أُلغي ربط Google Drive." : "لم يكتمل ربط Google Drive.",
    );
  }
  setIdentity({configured:true,signedIn:true,email:result.email,displayName:result.displayName});
  return result;
}
export async function disconnectNativeDrive() {
  clearNativeDriveMarker();
  const revision = driveRevision;
  await nativeDriveCall("disconnect");
  if (revision === driveRevision) setDriveProfile({connected:false});
}
export function nativeIdentity(operation: "status"|"signIn"|"signOut",chooseAccount=false): Promise<NativeCloudProfile> {
  return enqueue(async () => {
    if(operation!=="status") {
      clearNativeDriveMarker();
      identityProfile=null;
      for(const listener of identityListeners) {
        try { listener(null); } catch (error) { console.error("Native identity listener failed", error); }
      }
    }
    const result=await hybridBridge.invoke<"cloudIdentityAction", NativeCloudProfile>("cloudIdentityAction",
      {operation,args:operation==="signIn"?{chooseAccount}:{}},{timeoutMs:180_000});
    setIdentity(result);return result;
  });
}
