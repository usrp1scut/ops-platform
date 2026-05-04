import { describe, expect, it } from "vitest";

import { formatAssetRange, nextAssetOffset, previousAssetOffset } from "./assets";

describe("formatAssetRange", () => {
  it("formats an empty result", () => {
    expect(formatAssetRange(0, 0, 0)).toBe("0 assets");
  });

  it("formats a partial last page", () => {
    expect(formatAssetRange(53, 50, 3)).toBe("51-53 of 53");
  });
});

describe("asset pagination offsets", () => {
  it("does not move before the first page", () => {
    expect(previousAssetOffset(10, 25)).toBe(0);
  });

  it("does not move beyond the last page", () => {
    expect(nextAssetOffset(50, 25, 53)).toBe(50);
  });

  it("moves to the next page when available", () => {
    expect(nextAssetOffset(25, 25, 100)).toBe(50);
  });
});
