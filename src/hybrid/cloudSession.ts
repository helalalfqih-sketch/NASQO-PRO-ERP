import { hybridBridge, HybridBridgeError } from "./bridge";

export type NativeCloudProfile = {
  configured?: boolean; signedIn?: boolean; connected?: boolean;
  email?: string | null; displayName?: string | null; cancelled?: boolean;
};
export const NATIVE_DRIVE_MARKER = "flutter-managed-drive-session";
let driveProfile: NativeCloudProfile = { connected: false };
const listeners = new Set<(marker: string | null) => void>();
let identityProfile:NativeCloudProfile|null=null;
const identityListeners=new Set<(profile:NativeCloudProfile|null)=>void>();
function setIdentity(profile:NativeCloudProfile){
  identityProfile=profile;
  for(const listener of identityListeners)listener(profile);
}
export function subscribeNativeIdentity(listener:(profile:NativeCloudProfile|null)=>void){
  identityListeners.add(listener);listener(identityProfile);
  return ()=>{identityListeners.delete(listener);};
}
let queue: Promise<unknown> = Promise.resolve();
let statusRequest: Promise<string | null> | null = null;

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
  for (const listener of listeners) listener(nativeDriveMarker());
}
export function clearNativeDriveMarker() { setDriveProfile({connected:false}); }
export function subscribeNativeDrive(listener: (marker: string | null) => void) {
  listeners.add(listener);
  listener(nativeDriveMarker());
  return () => { listeners.delete(listener); };
}
export function nativeDriveCall<T>(operation: string, args: Record<string,unknown> = {}): Promise<T> {
  return enqueue(async () => {
    try {
      return await hybridBridge.invoke<"googleDriveAction", T>("googleDriveAction",
        {operation,args}, {timeoutMs: 600_000});
    } catch (error) {
      if (error instanceof HybridBridgeError && error.code === "UNAUTHORIZED_ACTION") clearNativeDriveMarker();
      throw error;
    }
  });
}
export function refreshNativeDrive(): Promise<string|null> {
  if (statusRequest) return statusRequest;
  const p = nativeDriveCall<NativeCloudProfile>("status").then(profile => {
    setDriveProfile(profile);
    return nativeDriveMarker();
  });
  statusRequest = p;
  void p.then(() => { if(statusRequest===p)statusRequest=null; }, () => { if(statusRequest===p)statusRequest=null; });
  return p;
}
export async function connectNativeDrive(chooseAccount=false): Promise<NativeCloudProfile> {
  clearNativeDriveMarker();
  const result=await nativeDriveCall<NativeCloudProfile>("connect",{chooseAccount});
  setDriveProfile(result);
  if (!result.connected){
    await nativeIdentity("status").catch(()=>undefined);
    throw new Error(result.cancelled ? "أُلغي ربط Google Drive." : "تعذر ربط Google Drive.");
  }
  setIdentity({configured:true,signedIn:true,email:result.email,displayName:result.displayName});
  return result;
}
export async function disconnectNativeDrive() {
  clearNativeDriveMarker();
  await nativeDriveCall("disconnect");
}
export function nativeIdentity(operation: "status"|"signIn"|"signOut",chooseAccount=false): Promise<NativeCloudProfile> {
  return enqueue(async () => {
    if(operation!=="status")clearNativeDriveMarker();
    const result=await hybridBridge.invoke<"cloudIdentityAction", NativeCloudProfile>("cloudIdentityAction",
      {operation,args:operation==="signIn"?{chooseAccount}:{}},{timeoutMs:180_000});
    setIdentity(result);return result;
  });
}
