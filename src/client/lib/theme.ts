import { useSyncExternalStore } from "react";
import { useMediaQuery } from "./use-media-query";

export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

/** Remembered per device. The inline script in index.html reads the same key before first paint. */
export const THEME_KEY = "sg-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function stored(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(preference: ThemePreference): Theme {
  if (preference === "system") return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  return preference;
}

/**
 * Puts the theme on <html> (the tokens switch on data-theme) and moves what
 * the browser draws around the page with it: the status bar / toolbar color
 * and the install manifest (its splash colors).
 */
export function applyTheme(preference: ThemePreference) {
  const theme = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = theme;
  // The page's own paper color, read back from the token so the two never drift.
  const paper = getComputedStyle(root).getPropertyValue("--sg-paper").trim();
  if (paper) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", paper);
  document
    .querySelector('link[rel="manifest"]')
    ?.setAttribute("href", theme === "dark" ? "/manifest-dark.webmanifest" : "/manifest.webmanifest");
}

let preference: ThemePreference = "system";
const listeners = new Set<() => void>();

/** Applies the remembered choice and follows the system while it is "system". Call once at start. */
export function initTheme() {
  preference = stored();
  applyTheme(preference);
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (preference === "system") applyTheme("system");
  });
  window.addEventListener("storage", (event) => {
    // Another tab changed it.
    if (event.key !== THEME_KEY) return;
    preference = stored();
    applyTheme(preference);
    for (const listener of listeners) listener();
  });
}

export function setThemePreference(next: ThemePreference) {
  preference = next;
  try {
    if (next === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  } catch {
    // Private mode: the choice lasts until the tab closes.
  }
  applyTheme(next);
  for (const listener of listeners) listener();
}

/** The chosen preference, the theme it resolves to right now, and a setter. */
export function useTheme() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => preference,
    () => "system" as const,
  );
  const systemDark = useMediaQuery(DARK_QUERY);
  const resolved: Theme = current === "system" ? (systemDark ? "dark" : "light") : current;
  return { preference: current, resolved, setPreference: setThemePreference };
}
