import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

export const DEFAULT_THEME_MODE: ThemeMode = "light";

const THEME_STORAGE_KEY = "nasqo-theme-mode-v2";

export function readStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") return DEFAULT_THEME_MODE;
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
  } catch {
    // Ignore storage access restriction
  }
  return DEFAULT_THEME_MODE;
}

export function resolveEffectiveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export function applyThemeMode(mode: ThemeMode): "light" | "dark" {
  const effective = resolveEffectiveTheme(mode);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.dataset.theme = effective;
    root.dataset.themeMode = mode;
    root.classList.toggle("dark", effective === "dark");
    root.style.colorScheme = effective;
  }
  return effective;
}

export function useThemeMode() {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredThemeMode());
  const [effectiveTheme, setEffectiveTheme] = useState<"light" | "dark">(() =>
    applyThemeMode(readStoredThemeMode()),
  );

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Ignore storage access restriction
    }
  }, []);

  useEffect(() => {
    setEffectiveTheme(applyThemeMode(mode));

    if (mode !== "system" || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      setEffectiveTheme(applyThemeMode("system"));
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [mode]);

  return {
    mode,
    effectiveTheme,
    setMode,
  };
}
