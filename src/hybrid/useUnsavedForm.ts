import { useCallback, useEffect, useRef, useState } from "react";
import { useBackLayer } from "./backCoordinator";

type UnsavedFormOptions = {
  active: boolean;
  dirty: boolean;
  onClose: () => void;
  /** Local UI draft only. Never pass a posting/domain-save callback here. */
  saveDraft: () => boolean;
  discardDraft: () => boolean;
  priority?: number;
};

/** Shared guard for hardware Back, toolbar Back, cancel and backdrop dismissal. */
export function useUnsavedForm({ active, dirty, onClose, saveDraft, discardDraft, priority = 10 }: UnsavedFormOptions) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [error, setError] = useState("");
  const closing = useRef(false);
  const continueEditing = useCallback(() => {
    setPromptOpen(false);
    setError("");
  }, []);
  useEffect(() => { if (!active) { closing.current = false; continueEditing(); } }, [active, continueEditing]);
  const closeNow = useCallback(() => {
    closing.current = true;
    onClose();
  }, [onClose]);
  const requestClose = useCallback(() => {
    if (!active) return;
    if (dirty) {
      setError("");
      setPromptOpen(true);
    } else closeNow();
  }, [active, dirty, closeNow]);
  useBackLayer(active, () => {
    if (closing.current) return false;
    requestClose(); return true;
  }, priority);
  useBackLayer(active && promptOpen, () => {
    if (closing.current) return false;
    continueEditing(); return true;
  }, 100);
  const discard = useCallback(() => {
    if (!discardDraft()) {
      setError("تعذر إزالة المسودة المحلية. بقيت التعديلات مفتوحة.");
      return;
    }
    continueEditing();
    closeNow();
  }, [discardDraft, continueEditing, closeNow]);
  const saveAndClose = useCallback(() => {
    if (!saveDraft()) {
      setError("تعذر حفظ المسودة محليًا. بقيت التعديلات مفتوحة ولم تُرحّل.");
      return;
    }
    continueEditing();
    closeNow();
  }, [saveDraft, continueEditing, closeNow]);
  return { promptOpen: active && promptOpen, error, requestClose, continueEditing, discard, saveAndClose,
    closeAfterSave: closeNow };
}
