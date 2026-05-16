import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ASSET_VIEW_MODE_KEY, readAssetViewMode, writeAssetViewMode } from "./assetView";

// Vitest runs in the node environment here (no jsdom), so stub a minimal
// localStorage on a fake window the same way client.test.ts stubs fetch.
function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe("assetView", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: makeStorage() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to list when nothing is stored", () => {
    expect(readAssetViewMode()).toBe("list");
  });

  it("only treats an explicit 'tree' value as tree", () => {
    window.localStorage.setItem(ASSET_VIEW_MODE_KEY, "tree");
    expect(readAssetViewMode()).toBe("tree");
    window.localStorage.setItem(ASSET_VIEW_MODE_KEY, "garbage");
    expect(readAssetViewMode()).toBe("list");
  });

  it("round-trips through write/read", () => {
    writeAssetViewMode("tree");
    expect(readAssetViewMode()).toBe("tree");
    writeAssetViewMode("list");
    expect(readAssetViewMode()).toBe("list");
  });

  it("falls back to list when localStorage throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(readAssetViewMode()).toBe("list");
  });

  it("uses the legacy portal's localStorage key", () => {
    expect(ASSET_VIEW_MODE_KEY).toBe("ops_platform_asset_view_mode");
  });
});
