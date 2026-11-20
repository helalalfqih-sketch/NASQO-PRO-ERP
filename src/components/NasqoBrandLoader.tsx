import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { APP_ICON_URL } from "../utils/appBrand";
import { getActiveBrandLoaderLabel, subscribeBrandLoader } from "../utils/brandLoaderBus";

export interface NasqoBrandLoaderProps {
  /** Render as a full-screen floating overlay (for heavy async operations) */
  overlay?: boolean;
  /** Controls visibility when overlay=true */
  open?: boolean;
  /** Optional Arabic status label shown beneath the animated NASQO emblem */
  label?: string;
  /** Size preset for the emblem */
  size?: "sm" | "md" | "lg";
  /** Optional custom logo override if the user configured one */
  logoUrl?: string;
  testId?: string;
}

function NasqoEmblem({
  size = "md",
  logoUrl,
}: {
  size: "sm" | "md" | "lg";
  logoUrl?: string;
}) {
  return (
    <div className={`nasqo-loader-emblem size-${size}`} aria-hidden="true">
      <span className="nasqo-loader-glow" />
      <svg className="nasqo-loader-ring" viewBox="0 0 100 100">
        <circle className="nasqo-loader-ring-track" cx="50" cy="50" r="44" />
        <circle className="nasqo-loader-ring-arc primary" cx="50" cy="50" r="44" />
        <circle className="nasqo-loader-ring-arc secondary" cx="50" cy="50" r="44" />
      </svg>
      <span className="nasqo-loader-icon-wrap">
        <img
          src={logoUrl || APP_ICON_URL}
          alt=""
          className="nasqo-loader-icon"
          draggable={false}
        />
      </span>
    </div>
  );
}

export function NasqoBrandLoader({
  overlay = false,
  open = true,
  label = "جاري التحميل...",
  size = "md",
  logoUrl,
  testId,
}: NasqoBrandLoaderProps) {
  if (overlay) {
    return (
      <AnimatePresence>
        {open ? (
          <motion.div
            key="nasqo-global-loader"
            className="nasqo-loader-overlay"
            role="status"
            aria-live="polite"
            aria-busy="true"
            data-testid={testId ?? "nasqo-global-loader"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.div
              className="nasqo-loader-stage"
              initial={{ opacity: 0, scale: 0.86, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 10 }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
            >
              <NasqoEmblem size={size === "sm" ? "md" : "lg"} logoUrl={logoUrl} />
              {label ? <span className="nasqo-loader-label">{label}</span> : null}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    );
  }

  return (
    <div
      className={`nasqo-loader-inline size-${size}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid={testId ?? "nasqo-inline-loader"}
    >
      <NasqoEmblem size={size} logoUrl={logoUrl} />
      {label ? <span className="nasqo-loader-inline-label">{label}</span> : null}
    </div>
  );
}

export function GlobalNasqoBrandLoader({ logoUrl }: { logoUrl?: string }) {
  const [activeLabel, setActiveLabel] = useState<string | null>(() =>
    getActiveBrandLoaderLabel(),
  );

  useEffect(() => subscribeBrandLoader(setActiveLabel), []);

  return (
    <NasqoBrandLoader
      overlay
      open={Boolean(activeLabel)}
      label={activeLabel ?? "جاري التحميل..."}
      logoUrl={logoUrl}
    />
  );
}

