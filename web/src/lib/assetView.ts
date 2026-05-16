// Persisted CMDB list/tree view preference.
//
// Uses the same localStorage key the legacy classic-script portal used
// (`ops_platform_asset_view_mode`) so an operator who switches between
// /portal/ and /portal-legacy/ during the observation window keeps the
// same view. "list" is the default; only an explicit "tree" flips it.

export type AssetViewMode = "list" | "tree";

export const ASSET_VIEW_MODE_KEY = "ops_platform_asset_view_mode";

export function readAssetViewMode(): AssetViewMode {
  if (typeof window === "undefined") return "list";
  try {
    return window.localStorage.getItem(ASSET_VIEW_MODE_KEY) === "tree" ? "tree" : "list";
  } catch {
    return "list";
  }
}

export function writeAssetViewMode(mode: AssetViewMode): void {
  try {
    window.localStorage.setItem(ASSET_VIEW_MODE_KEY, mode);
  } catch {
    // localStorage is best-effort; the in-memory state still drives the UI.
  }
}
