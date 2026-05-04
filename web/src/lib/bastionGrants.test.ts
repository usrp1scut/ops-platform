import { describe, expect, it } from "vitest";

import { formatGrantTimeRemaining } from "./bastionGrants";

describe("formatGrantTimeRemaining", () => {
  const now = new Date("2026-05-03T00:00:00.000Z");

  it("formats active grant expiry relative to a provided clock", () => {
    expect(formatGrantTimeRemaining("2026-05-03T00:00:45.000Z", now)).toBe("45s left");
    expect(formatGrantTimeRemaining("2026-05-03T00:30:00.000Z", now)).toBe("30m left");
    expect(formatGrantTimeRemaining("2026-05-03T01:00:00.000Z", now)).toBe("1h left");
    expect(formatGrantTimeRemaining("2026-05-04T02:00:00.000Z", now)).toBe("1d 2h left");
  });

  it("handles invalid and expired values", () => {
    expect(formatGrantTimeRemaining("not-a-date", now)).toBe("-");
    expect(formatGrantTimeRemaining("2026-05-02T23:59:59.000Z", now)).toBe("expired");
  });
});
