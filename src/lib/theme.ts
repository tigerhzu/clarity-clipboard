import lightStyles from "../app/glass.css?inline";
import type { ClipboardColorTheme } from "../types/clipboard";

const STORAGE_KEY = "clarity-clipboard:color-theme:v1";
const STYLE_ID = "clarity-light-theme";

export function applyColorTheme(value: unknown, persist = true) {
  const theme: ClipboardColorTheme = value === "light" ? "light" : "dark";
  document.documentElement.dataset.colorTheme = theme;
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (theme === "light" && !style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = lightStyles;
    document.head.append(style);
  }
  // Disable the complete light material: no pale cards or orange highlights leak into dark mode.
  if (style) style.media = theme === "light" ? "all" : "not all";
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* Native settings remain authoritative. */ }
  }
}

export function restoreColorTheme() {
  let saved: string | null = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* Start with the dark default. */ }
  applyColorTheme(saved, false);
}
