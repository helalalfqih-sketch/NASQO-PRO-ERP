/** Fixed event names and ephemeral instance counters only; never log state, records or bridge payloads. */
export function observeHybridLifecycle(): () => void {
  const instance = Math.random().toString(36).slice(2, 10);
  const emit = (event: "mounted" | "hidden" | "visible" | "pagehide" | "disposed") => {
    console.info(`[NASQO_UI_LIFECYCLE] event=${event} page=${instance}`);
  };
  const visibility = () => emit(document.visibilityState === "hidden" ? "hidden" : "visible");
  const pagehide = () => emit("pagehide");
  emit("mounted");
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", pagehide);
  return () => {
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", pagehide);
    emit("disposed");
  };
}
