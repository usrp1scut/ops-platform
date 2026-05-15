import { useCallback, useEffect, useSyncExternalStore } from "react";

// Three modes the operator can land on:
//   - "system" (default): follow the OS preference, no attribute on <html>.
//   - "light":  always render the light token set.
//   - "dark":   always render the dark token set.
//
// The CSS in tokens.css is structured so a missing `data-theme` attribute
// means "follow the prefers-color-scheme media query", and the explicit
// attribute values lock the mode.
export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "ops_platform_theme";
const SUPPORTED: ReadonlyArray<ThemeMode> = ["system", "light", "dark"];

function isThemeMode(value: string | null): value is ThemeMode {
  return value !== null && (SUPPORTED as ReadonlyArray<string>).includes(value);
}

function readStored(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isThemeMode(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

function applyThemeAttribute(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
}

const listeners = new Set<() => void>();
let current: ThemeMode = readStored();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function snapshot(): ThemeMode {
  return current;
}

function publish(mode: ThemeMode) {
  current = mode;
  applyThemeAttribute(mode);
  try {
    if (mode === "system") {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, mode);
    }
  } catch {
    // localStorage is best-effort; the in-memory value still drives the UI.
  }
  for (const listener of listeners) listener();
}

// Apply the persisted preference once at module load so the very first
// paint already reflects it (no flash of the wrong theme).
applyThemeAttribute(current);

/**
 * React binding for the cross-tab theme store. Returns the current mode
 * and a setter that updates the DOM attribute, persists the choice, and
 * notifies every other useTheme caller.
 *
 * `resolvedTheme` is the concrete "light" | "dark" actually rendered —
 * useful when an UI element (e.g. an icon) wants to show the active
 * appearance even while the mode is "system".
 */
export function useTheme(): {
  mode: ThemeMode;
  resolvedTheme: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
} {
  const mode = useSyncExternalStore(subscribe, snapshot, snapshot);
  const resolvedTheme = useResolvedTheme(mode);
  const setMode = useCallback((next: ThemeMode) => publish(next), []);
  const cycleMode = useCallback(() => {
    const order: ThemeMode[] = ["system", "light", "dark"];
    const idx = order.indexOf(snapshot());
    publish(order[(idx + 1) % order.length]);
  }, []);
  return { mode, resolvedTheme, setMode, cycleMode };
}

function useResolvedTheme(mode: ThemeMode): "light" | "dark" {
  // For explicit modes the answer is trivial. For "system" we mirror the
  // media query into React state so consumers re-render when the OS
  // preference flips (Win11 / macOS) without needing a page reload.
  const subscribeMedia = useCallback((callback: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
  }, []);
  const getMediaSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) return "light" as const;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }, []);
  const systemResolved = useSyncExternalStore(subscribeMedia, getMediaSnapshot, () => "light" as const);
  if (mode === "light" || mode === "dark") return mode;
  return systemResolved;
}
