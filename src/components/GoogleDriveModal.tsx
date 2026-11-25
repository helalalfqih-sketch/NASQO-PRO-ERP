import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { NasqoBrandLoader } from "./NasqoBrandLoader";
import { runWithBrandLoader } from "../utils/brandLoaderBus";
import {
  ArchiveIcon,
  ArrowRightIcon,
  CheckCircledIcon,
  Cross2Icon,
  DownloadIcon,
  ExclamationTriangleIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LayersIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ReloadIcon,
  TableIcon,
  TrashIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import { KeyboardInput, MobileScroll, useKeyboard } from "../mobile";
import {
  clearGoogleAccessToken,
  connectGoogleDrive,
  getConnectedGoogleAccountInfo,
  getGoogleAccessToken,
  subscribeGoogleAccessToken,
} from "../firebase";
import {
  classifyDriveMimeType,
  createDriveFolder,
  deleteDriveFilePermanently,
  downloadDriveFileBytes,
  DRIVE_FOLDER_MIME,
  filterDriveFiles,
  findOrCreateDriveFolder,
  formatDriveFileSize,
  getDriveAbout,
  getDriveMimeLabelAr,
  listDriveFiles,
  trashDriveFile,
  updateDriveFileContent,
  uploadFileToDrive,
  DriveAuthExpiredError,
  type DriveAboutInfo,
  type DriveCategoryFilter,
  type DriveFileRecord,
} from "../services/googleDrive";
import { formatNasqoBackupFilename } from "../utils/backupFormat";
import { describeGoogleDriveConnectError } from "../utils/googleDriveAuthError";
import { triggerHaptic } from "../utils/haptics";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { connectNativeDrive, nativeDriveMarker, nativeDriveCall, refreshNativeDrive, disconnectNativeDrive } from "../hybrid/cloudSession";
const nativeDrive=import.meta.env.VITE_NASQO_HYBRID === "1";

interface GoogleDriveModalProps {
  open: boolean;
  onClose: () => void;
  buildBackupPayloadJson: (backupName: string) => string;
  onBackupUploaded?: (fileName: string) => void;
  onRestoreBackupBytes: (bytes: Uint8Array, fileName: string) => Promise<void>;
  onNotify: (message: string) => void;
}

type FolderCrumb = { id: string | null; name: string };

type PendingDriveConfirmation =
  | { kind: "restore"; file: DriveFileRecord }
  | { kind: "overwrite"; file: DriveFileRecord }
  | { kind: "trash"; file: DriveFileRecord }
  | { kind: "delete"; file: DriveFileRecord }
  | null;

const CATEGORY_TABS: readonly { id: DriveCategoryFilter; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "backups", label: "النسخ الاحتياطية" },
  { id: "folders", label: "المجلدات" },
  { id: "documents", label: "PDF ومستندات" },
  { id: "spreadsheets", label: "جداول" },
];

function triggerBrowserBytesDownload(filename: string, bytes: Uint8Array, mimeType: string) {
  const safeBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([safeBuffer], { type: mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function GoogleDriveModal({
  open,
  onClose,
  buildBackupPayloadJson,
  onBackupUploaded,
  onRestoreBackupBytes,
  onNotify,
}: GoogleDriveModalProps) {
  const keyboard = useKeyboard();
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const [accessToken, setAccessToken] = useState<string | null>(() => getGoogleAccessToken());
  const [about, setAbout] = useState<DriveAboutInfo | null>(null);
  const [files, setFiles] = useState<DriveFileRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<DriveCategoryFilter>("all");
  const [breadcrumbs, setBreadcrumbs] = useState<FolderCrumb[]>([
    { id: null, name: "ملفات نسق برو (Drive)" },
  ]);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<PendingDriveConfirmation>(null);

  const currentFolder = breadcrumbs[breadcrumbs.length - 1] ?? { id: null, name: "ملفات نسق برو (Drive)" };

  useEffect(() => {
    return subscribeGoogleAccessToken((token) => {
      setAccessToken(token);
      if (!token) {
        setAbout(null);
        setFiles([]);
      }
    });
  }, []);

  const loadDriveContents = useCallback(
    async (token: string, folderId: string | null) => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const [driveFiles, aboutData] = await Promise.all([
          listDriveFiles(token, { folderId, pageSize: 60 }),
          getDriveAbout(token).catch(() => null),
        ]);
        setFiles(driveFiles);
        if (aboutData) setAbout(aboutData);
      } catch (err) {
        if (err instanceof DriveAuthExpiredError) {
          setAccessToken(null);
          setErrorMsg(err.message);
        } else {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : "تعذر تحميل ملفات Google Drive حاليًا.",
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    let active=true;
    const refresh=async()=>{
      try{
        const token=nativeDrive?await refreshNativeDrive():getGoogleAccessToken();
        if(!active)return;
        setAccessToken(token);
        if(token)await loadDriveContents(token,currentFolder.id);
      }catch(err){if(active)setErrorMsg(describeGoogleDriveConnectError(err));}
    };
    void refresh();
    return ()=>{active=false;};
  }, [open, currentFolder.id, loadDriveContents]);

  const handleClose = () => {
    keyboard.hide();
    setPendingConfirm(null);
    setNewFolderOpen(false);
    onClose();
  };

  const handleAuthorizeDrive = async (chooseAccount=false) => {
    keyboard.hide();
    setBusyAction("auth");
    setErrorMsg(null);
    try {
      await runWithBrandLoader("جاري ربط حساب Google Drive...", async () => {
        const freshToken = nativeDrive
          ? (await connectNativeDrive(chooseAccount),nativeDriveMarker()!)
          : (await connectGoogleDrive()).accessToken;
        setAccessToken(freshToken);
        if(chooseAccount)setBreadcrumbs([{id:null,name:"ملفات نسق برو (Drive)"}]);
        triggerHaptic("success");
        onNotify("تم ربط حساب Google Drive بنجاح");
        await loadDriveContents(freshToken, chooseAccount?null:currentFolder.id);
      });
    } catch (err) {
      triggerHaptic("warning");
      setErrorMsg(describeGoogleDriveConnectError(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleUploadLocalFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !accessToken) return;
    setBusyAction("upload");
    setErrorMsg(null);
    try {
      await runWithBrandLoader(`جاري رفع «${file.name}» إلى Google Drive...`, async () => {
        const buffer = await file.arrayBuffer();
        await uploadFileToDrive(accessToken, {
          name: file.name,
          content: new Uint8Array(buffer),
          mimeType: file.type || "application/octet-stream",
          parentId: currentFolder.id ?? undefined,
        });
        triggerHaptic("success");
        onNotify(`تم رفع «${file.name}» إلى Google Drive`);
        await loadDriveContents(accessToken, currentFolder.id);
      });
    } catch (err) {
      triggerHaptic("warning");
      setErrorMsg(err instanceof Error ? err.message : "فشل رفع الملف إلى Drive.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleBackupWorkspaceNow = async () => {
    keyboard.hide();
    if (!accessToken) {
      await handleAuthorizeDrive();
      return;
    }
    setBusyAction("backup");
    setErrorMsg(null);
    try {
      await runWithBrandLoader("جاري رفع النسخة الاحتياطية إلى Google Drive...", async () => {
        const filename = formatNasqoBackupFilename();
        const targetParentId =
          currentFolder.id ?? (await findOrCreateDriveFolder(accessToken, "NASQO Pro Backups")).id;
        let savedName=filename;
        if(nativeDrive){
          const saved=await nativeDriveCall<{id?:string;name?:string;cancelled?:boolean}>("backupNative",{name:filename,parentId:targetParentId});
          if(saved.cancelled)return;
          if(!saved.id)throw new Error("لم يتأكد رفع النسخة الاحتياطية.");
          savedName=saved.name??filename;
        }else{
          const jsonContent=buildBackupPayloadJson(filename);
          await uploadFileToDrive(accessToken,{name:filename,content:jsonContent,mimeType:"application/json",parentId:targetParentId,description:"نسخة احتياطية كاملة لبيانات نسقو برو ERP"});
        }
        onBackupUploaded?.(savedName);
        triggerHaptic("success");
        onNotify(`تم حفظ النسخة الاحتياطية في Google Drive: ${savedName}`);
        await loadDriveContents(accessToken, currentFolder.id);
      });
    } catch (err) {
      triggerHaptic("warning");
      if (err instanceof DriveAuthExpiredError) {
        setAccessToken(null);
      }
      setErrorMsg(err instanceof Error ? err.message : "فشل رفع النسخة الاحتياطية إلى Drive.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed || !accessToken) return;
    keyboard.hide();
    setBusyAction("mkdir");
    setErrorMsg(null);
    try {
      await runWithBrandLoader(`جاري إنشاء المجلد «${trimmed}»...`, async () => {
        await createDriveFolder(accessToken, trimmed, currentFolder.id ?? undefined);
        setNewFolderName("");
        setNewFolderOpen(false);
        triggerHaptic("success");
        onNotify(`تم إنشاء المجلد «${trimmed}» على Google Drive`);
        await loadDriveContents(accessToken, currentFolder.id);
      });
    } catch (err) {
      triggerHaptic("warning");
      setErrorMsg(err instanceof Error ? err.message : "تعذر إنشاء المجلد.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleNativeUpload=async()=>{
    if(!accessToken||busyAction!==null)return;
    setBusyAction("upload");setErrorMsg(null);
    try{
      const result=await nativeDriveCall<{id?:string;name?:string;cancelled?:boolean}>("uploadLocal",{parentId:currentFolder.id});
      if(result.cancelled)return;
      if(!result.id)throw new Error("لم يتأكد رفع الملف.");
      onNotify("تم رفع الملف إلى Google Drive");
      await loadDriveContents(accessToken,currentFolder.id);
    }catch(err){setErrorMsg(err instanceof Error?err.message:"تعذر رفع الملف.");}
    finally{setBusyAction(null);}
  };
  const handleDownloadFile = async (file: DriveFileRecord) => {
    if (!accessToken) return;
    keyboard.hide();
    setBusyAction(`dl:${file.id}`);
    setErrorMsg(null);
    try {
      await runWithBrandLoader(`جاري تنزيل «${file.name}» من Google Drive...`, async () => {
        if(nativeDrive){
          const result=await nativeDriveCall<{completed:boolean;name:string}>("saveFile",{fileId:file.id});
          if(result.completed)onNotify("تم حفظ "+result.name);
          return;
        }
        const { bytes, downloadName, mimeType } = await downloadDriveFileBytes(accessToken, file);
        triggerBrowserBytesDownload(downloadName, bytes, mimeType);
        triggerHaptic("success");
        onNotify(`تم تنزيل «${downloadName}» من Google Drive`);
      });
    } catch (err) {
      triggerHaptic("warning");
      if (err instanceof DriveAuthExpiredError) {
        setAccessToken(null);
      }
      setErrorMsg(err instanceof Error ? err.message : "تعذر تنزيل الملف من Drive.");
    } finally {
      setBusyAction(null);
    }
  };

  const executeConfirmedAction = async () => {
    if (!pendingConfirm || !accessToken) return;
    const action = pendingConfirm;
    keyboard.hide();
    setBusyAction(`confirm:${action.file.id}`);
    setErrorMsg(null);
    const actionLabel =
      action.kind === "restore"
        ? `جاري استعادة «${action.file.name}» من Google Drive...`
        : action.kind === "overwrite"
          ? `جاري تحديث «${action.file.name}» على Google Drive...`
          : action.kind === "trash"
            ? `جاري نقل «${action.file.name}» إلى سلة المهملات...`
            : `جاري حذف «${action.file.name}» نهائيًا...`;
    try {
      await runWithBrandLoader(actionLabel, async () => {
        if (action.kind === "restore") {
          if(nativeDrive){
            const result=await nativeDriveCall<{completed:boolean}>("restoreNative",{fileId:action.file.id});
            setPendingConfirm(null);
            if(result.completed)window.location.reload();
            return;
          }
          const { bytes } = await downloadDriveFileBytes(accessToken, action.file);
          await onRestoreBackupBytes(bytes, action.file.name);
          setPendingConfirm(null);
        } else if (action.kind === "overwrite") {
          if(nativeDrive){
            const result=await nativeDriveCall<{id?:string;name?:string;cancelled?:boolean}>("overwriteNative",{fileId:action.file.id,name:action.file.name});
            if(result.cancelled){setPendingConfirm(null);return;}
            if(!result.id)throw new Error("لم يتأكد تحديث النسخة.");
            onBackupUploaded?.(result.name??action.file.name);
            setPendingConfirm(null);
            onNotify("تم تحديث نسخة Drive");
            await loadDriveContents(accessToken,currentFolder.id);
            return;
          }
          const updatedJson = buildBackupPayloadJson(action.file.name);
          await updateDriveFileContent(accessToken, action.file.id, {
            name: action.file.name,
            content: updatedJson,
            mimeType: "application/json",
            description: "تحديث نسخة احتياطية كاملة لبيانات نسقو برو ERP",
          });
          onBackupUploaded?.(action.file.name);
          triggerHaptic("success");
          onNotify(`تم تحديث واستبدال «${action.file.name}» على Google Drive`);
          setPendingConfirm(null);
          await loadDriveContents(accessToken, currentFolder.id);
        } else if (action.kind === "trash") {
          if(nativeDrive){
            const result=await nativeDriveCall<{completed?:boolean;cancelled?:boolean}>("trashFile",{fileId:action.file.id});
            if(!result.completed){setPendingConfirm(null);return;}
          }else await trashDriveFile(accessToken, action.file.id);
          triggerHaptic("warning");
          onNotify(`تم نقل «${action.file.name}» إلى سلة مهملات Drive`);
          setPendingConfirm(null);
          await loadDriveContents(accessToken, currentFolder.id);
        } else if (action.kind === "delete") {
          await deleteDriveFilePermanently(accessToken, action.file.id);
          triggerHaptic("warning");
          onNotify(`تم حذف «${action.file.name}» نهائيًا من Google Drive`);
          setPendingConfirm(null);
          await loadDriveContents(accessToken, currentFolder.id);
        }
      });
    } catch (err) {
      triggerHaptic("warning");
      if (err instanceof DriveAuthExpiredError) {
        setAccessToken(null);
        setPendingConfirm(null);
      }
      setErrorMsg(err instanceof Error ? err.message : "تعذر تنفيذ العملية على Google Drive.");
    } finally {
      setBusyAction(null);
    }
  };

  const visibleFiles = useMemo(
    () => filterDriveFiles(files, search, category),
    [files, search, category],
  );

  if (!open) return null;

  const accountInfo = getConnectedGoogleAccountInfo();
  const connectedEmail = about?.user?.emailAddress || accountInfo.email;
  const connectedName = about?.user?.displayName || accountInfo.displayName;
  const quotaUsed = Number(about?.storageQuota?.usage ?? 0);
  const quotaLimit = Number(about?.storageQuota?.limit ?? 0);
  const quotaPct =
    quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : null;

  return (
    <div className="center-modal-layer" data-testid="google-drive-modal">
      <button
        type="button"
        className="center-modal-backdrop"
        onClick={handleClose}
        aria-label="إغلاق مدير Google Drive"
      />
      <section
        className="exec-modal gdrive-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gdrive-modal-title"
      >
        <header className="gdrive-header">
          <div className="gdrive-title-wrap">
            <span className="gdrive-logo-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path fill="#0F9D58" d="M8.3 3L1.5 14.8l3.4 5.9L11.7 9z" />
                <path fill="#4285F4" d="M22.5 14.8H8.9l-3.4 5.9h13.6z" />
                <path fill="#F4B400" d="M15.7 3H8.3l6.8 11.8h7.4z" />
              </svg>
            </span>
            <div>
              <h2 id="gdrive-modal-title">Google Drive السحابي</h2>
              <small>
                {accessToken
                  ? connectedEmail || connectedName || "حساب Google متصل"
                  : "ربط الحساب وإدارة النسخ الاحتياطية والملفات"}
              </small>
            </div>
          </div>
          <button
            type="button"
            className="gdrive-close-btn"
            onClick={handleClose}
            aria-label="إغلاق"
          >
            <Cross2Icon />
          </button>
        </header>

        {errorMsg ? (
          <div className="gdrive-alert error" role="alert" data-testid="gdrive-error-banner">
            <ExclamationTriangleIcon />
            <span>{errorMsg}</span>
          </div>
        ) : null}

        {!accessToken ? (
          <div className="gdrive-connect-gate" data-testid="gdrive-connect-gate">
            <div className="gdrive-connect-hero">
              <CheckCircledIcon />
              <h3>اتصال مباشر وآمن بحساب Google Drive</h3>
              <p>
                اربط حسابك لحفظ نسخ نسقو برو الاحتياطية ورفع فواتير PDF.
                سيعرض التطبيق الملفات التي ينشئها أو يرفعها عبر نسق برو فقط،
                وليس جميع ملفاتك الأخرى في Google Drive.
              </p>
            </div>
            <div className="gdrive-signin-holder">
              <GoogleSignInButton
                onClick={() => void handleAuthorizeDrive()}
                disabled={busyAction === "auth"}
                label={busyAction === "auth" ? "جاري الربط..." : "Sign in with Google"}
                testId="drive-google-signin-btn"
                fullWidth
              />
            </div>
            <p className="gdrive-token-note">
              يُحفظ رمز الجلسة مؤقتًا في الذاكرة فقط أثناء الاستخدام، ويُمسح تلقائيًا عند تسجيل الخروج.
            </p>
          </div>
        ) : (
          <>
            <div className="gdrive-status-strip">
              <div className="gdrive-quota-copy">
                <strong>{connectedName || connectedEmail || "متصل بـ Google Drive"}</strong>
                <span>
                  {quotaLimit > 0
                    ? `المساحة المستخدمة: ${formatDriveFileSize(quotaUsed)} من ${formatDriveFileSize(quotaLimit)} (${quotaPct}%)`
                    : `${files.length} ملف في العرض الحالي`}
                </span>
                {quotaPct !== null ? (
                  <div className="gdrive-quota-bar" aria-hidden="true">
                    <span style={{ width: `${quotaPct}%` }} />
                  </div>
                ) : null}
              </div>
              <div className="gdrive-status-btns">
                <button
                  type="button"
                  className="gdrive-icon-btn"
                  title="تحديث الملفات"
                  aria-label="تحديث ملفات Drive"
                  disabled={loading}
                  onClick={() => void loadDriveContents(accessToken, currentFolder.id)}
                >
                  <ReloadIcon />
                </button>
                <button
                  type="button"
                  className="gdrive-chip-action"
                  onClick={() => void handleAuthorizeDrive(true)}
                  disabled={busyAction !== null || loading}
                >
                  تبديل الحساب
                </button>
                <button
                  type="button"
                  className="gdrive-chip-action danger"
                  disabled={busyAction !== null || loading}
                  onClick={() => {
                    if(nativeDrive){
                      void disconnectNativeDrive().then(()=>onNotify("تم فصل جلسة Google Drive")).catch(e=>setErrorMsg(e instanceof Error?e.message:"تعذر فصل Drive."));
                    }else{
                      clearGoogleAccessToken();
                      onNotify("تم فصل جلسة Google Drive");
                    }
                  }}
                >
                  فصل
                </button>
              </div>
            </div>

            <div className="gdrive-primary-actions">
              <button
                type="button"
                className="gdrive-action-btn primary"
                disabled={busyAction !== null}
                onClick={() => void handleBackupWorkspaceNow()}
                data-testid="gdrive-backup-now-btn"
              >
                <ArchiveIcon />
                <span>{busyAction === "backup" ? "جاري الرفع..." : "نسخ قاعدة البيانات لـ Drive"}</span>
              </button>
              <button
                type="button"
                className="gdrive-action-btn"
                disabled={busyAction !== null}
                onClick={() => nativeDrive ? void handleNativeUpload() : uploadInputRef.current?.click()}
                data-testid="gdrive-upload-file-btn"
              >
                <PlusIcon />
                <span>{busyAction === "upload" ? "جاري الرفع..." : "رفع ملف"}</span>
              </button>
              <button
                type="button"
                className="gdrive-action-btn"
                disabled={busyAction !== null}
                onClick={() => setNewFolderOpen((v) => !v)}
                data-testid="gdrive-new-folder-toggle"
              >
                <LayersIcon />
                <span>مجلد جديد</span>
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                hidden
                onChange={(e) => void handleUploadLocalFile(e)}
              />
            </div>

            {newFolderOpen ? (
              <div className="gdrive-mkdir-row" data-testid="gdrive-mkdir-form">
                <KeyboardInput
                  placeholder="اسم المجلد الجديد في Drive"
                  aria-label="اسم المجلد الجديد"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                />
                <button
                  type="button"
                  className="gdrive-action-btn primary"
                  disabled={!newFolderName.trim() || busyAction === "mkdir"}
                  onClick={() => void handleCreateFolder()}
                >
                  {busyAction === "mkdir" ? "..." : "إنشاء"}
                </button>
              </div>
            ) : null}

            <div className="gdrive-search-row">
              <MagnifyingGlassIcon />
              <KeyboardInput
                placeholder="بحث في ملفات Google Drive..."
                aria-label="بحث في ملفات Google Drive"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="gdrive-search-input"
              />
              {search ? (
                <button
                  type="button"
                  aria-label="مسح البحث"
                  onClick={() => setSearch("")}
                >
                  <Cross2Icon />
                </button>
              ) : null}
            </div>

            <div className="gdrive-tabs" role="tablist" aria-label="تصنيف ملفات Drive">
              {CATEGORY_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={category === tab.id}
                  className={category === tab.id ? "active" : ""}
                  onClick={() => setCategory(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {breadcrumbs.length > 1 ? (
              <div className="gdrive-breadcrumbs">
                <button
                  type="button"
                  className="gdrive-back-folder"
                  onClick={() =>
                    setBreadcrumbs((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
                  }
                >
                  <ArrowRightIcon />
                  <span>رجوع</span>
                </button>
                <div className="gdrive-crumbs-trail">
                  {breadcrumbs.map((crumb, idx) => (
                    <button
                      key={`${crumb.id ?? "root"}-${idx}`}
                      type="button"
                      className={idx === breadcrumbs.length - 1 ? "current" : ""}
                      onClick={() => setBreadcrumbs((prev) => prev.slice(0, idx + 1))}
                    >
                      {crumb.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <MobileScroll className="gdrive-files-scroll">
              {loading ? (
                <NasqoBrandLoader size="sm" label="جاري تحميل ملفات Google Drive..." />
              ) : visibleFiles.length === 0 ? (
                <div className="gdrive-empty">
                  <p>لا توجد ملفات مطابقة في هذا العرض.</p>
                </div>
              ) : (
                <ul className="gdrive-files-list" data-testid="gdrive-files-list">
                  {visibleFiles.map((file) => {
                    const kind = classifyDriveMimeType(file.mimeType, file.name);
                    const isFolder = file.mimeType === DRIVE_FOLDER_MIME;
                    const isBackup = kind === "backup";
                    const modifiedLabel = file.modifiedTime
                      ? new Date(file.modifiedTime).toLocaleDateString("en-GB")
                      : "";

                    return (
                      <li key={file.id} className="gdrive-file-card">
                        <div className="gdrive-file-head">
                          <span className={`gdrive-file-icon ${kind}`} aria-hidden="true">
                            {isFolder ? (
                              <LayersIcon />
                            ) : isBackup ? (
                              <ArchiveIcon />
                            ) : kind === "spreadsheet" ? (
                              <TableIcon />
                            ) : (
                              <FileTextIcon />
                            )}
                          </span>
                          <div className="gdrive-file-meta">
                            <strong>{file.name}</strong>
                            <span>
                              {getDriveMimeLabelAr(kind)}
                              {!isFolder && file.size ? ` · ${formatDriveFileSize(file.size)}` : ""}
                              {modifiedLabel ? ` · ${modifiedLabel}` : ""}
                            </span>
                          </div>
                        </div>
                        <div className="gdrive-file-actions">
                          {isFolder ? (
                            <button
                              type="button"
                              className="gdrive-row-btn primary"
                              onClick={() =>
                                setBreadcrumbs((prev) => [...prev, { id: file.id, name: file.name }])
                              }
                            >
                              فتح المجلد
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="gdrive-row-btn"
                              disabled={busyAction !== null}
                              onClick={() => void handleDownloadFile(file)}
                            >
                              <DownloadIcon />
                              <span>{busyAction === `dl:${file.id}` ? "..." : "تنزيل"}</span>
                            </button>
                          )}

                          {isBackup ? (
                            <>
                              <button
                                type="button"
                                className="gdrive-row-btn success"
                                disabled={busyAction !== null}
                                onClick={() => setPendingConfirm({ kind: "restore", file })}
                              >
                                <ReloadIcon />
                                <span>استعادة</span>
                              </button>
                              <button
                                type="button"
                                className="gdrive-row-btn warn"
                                disabled={busyAction !== null}
                                onClick={() => setPendingConfirm({ kind: "overwrite", file })}
                              >
                                <UpdateIcon />
                                <span>تحديث</span>
                              </button>
                            </>
                          ) : null}

                          {!nativeDrive && file.webViewLink ? (
                            <a
                              className="gdrive-row-btn"
                              href={file.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="فتح في Google Drive"
                            >
                              <ExternalLinkIcon />
                              <span>Drive</span>
                            </a>
                          ) : null}

                          <button
                            type="button"
                            className="gdrive-row-btn danger"
                            disabled={busyAction !== null}
                            onClick={() => setPendingConfirm({ kind: "trash", file })}
                            aria-label={`نقل ${file.name} إلى سلة المهملات`}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </MobileScroll>
          </>
        )}

        {pendingConfirm ? (
          <div className="gdrive-confirm-overlay" data-testid="gdrive-confirm-dialog">
            <div className="gdrive-confirm-card" role="alertdialog" aria-modal="true">
              <div className="gdrive-confirm-head">
                <ExclamationTriangleIcon />
                <strong>
                  {pendingConfirm.kind === "restore"
                    ? "تأكيد استعادة النسخة الاحتياطية"
                    : pendingConfirm.kind === "overwrite"
                      ? "تأكيد تحديث واستبدال الملف"
                      : pendingConfirm.kind === "delete"
                        ? "تأكيد الحذف النهائي"
                        : "تأكيد النقل إلى سلة مهملات Drive"}
                </strong>
              </div>
              <p>
                {pendingConfirm.kind === "restore"
                  ? nativeDrive ? `سيتم تنزيل «${pendingConfirm.file.name}» ثم فحصها واستعادتها محليًا بعد تأكيدك وحفظ نسخة أمان من قاعدة العمل.` : `سيتم تنزيل «${pendingConfirm.file.name}» من Google Drive ودمج بياناتها في مساحة عمل نسقو برو الحالية.`
                  : pendingConfirm.kind === "overwrite"
                    ? `سيتم استبدال محتوى الملف «${pendingConfirm.file.name}» على Google Drive بأحدث بيانات قاعدة البيانات الحالية.`
                    : pendingConfirm.kind === "delete"
                      ? `سيتم حذف الملف «${pendingConfirm.file.name}» نهائيًا من Google Drive ولا يمكن التراجع عن ذلك.`
                      : `هل تريد نقل «${pendingConfirm.file.name}» إلى سلة المهملات في Google Drive؟`}
              </p>
              <div className="gdrive-confirm-actions">
                <button
                  type="button"
                  className="ref-btn purple"
                  disabled={busyAction !== null}
                  onClick={() => setPendingConfirm(null)}
                >
                  إلغاء
                </button>
                {!nativeDrive && pendingConfirm.kind === "trash" ? (
                  <button
                    type="button"
                    className="ref-btn orange"
                    disabled={busyAction !== null}
                    onClick={() =>
                      setPendingConfirm({ kind: "delete", file: pendingConfirm.file })
                    }
                  >
                    حذف نهائي
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`ref-btn ${pendingConfirm.kind === "restore" ? "green" : "red"}`}
                  disabled={busyAction !== null}
                  onClick={() => void executeConfirmedAction()}
                  data-testid="gdrive-confirm-execute-btn"
                >
                  {busyAction ? "جاري التنفيذ..." : "تأكيد التنفيذ"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
