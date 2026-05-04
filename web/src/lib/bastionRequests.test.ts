import { describe, expect, it } from "vitest";

import { formatDurationSeconds, requestStatusTone } from "./bastionRequests";

describe("requestStatusTone", () => {
  it("maps request statuses to stable UI tones", () => {
    expect(requestStatusTone("approved")).toBe("ok");
    expect(requestStatusTone("pending")).toBe("info");
    expect(requestStatusTone("rejected")).toBe("warn");
    expect(requestStatusTone("cancelled")).toBe("warn");
    expect(requestStatusTone("expired")).toBe("warn");
  });
});

describe("formatDurationSeconds", () => {
  it("formats common request durations", () => {
    expect(formatDurationSeconds(45)).toBe("45s");
    expect(formatDurationSeconds(1800)).toBe("30m");
    expect(formatDurationSeconds(3600)).toBe("1h");
    expect(formatDurationSeconds(5400)).toBe("1h 30m");
  });
});
