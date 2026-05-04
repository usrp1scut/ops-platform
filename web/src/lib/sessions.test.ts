import { describe, expect, it } from "vitest";

import {
  filterSessionsByStatus,
  formatBytes,
  formatDurationMs,
  parseAsciicast,
  sessionCounts,
  sessionStatus,
  sessionStatusTone,
  type SessionStatusFilter,
} from "./sessions";
import type { SessionAuditRecord } from "../api/sessions";

const baseSession: SessionAuditRecord = {
  asset_id: "asset-1",
  asset_name: "db-prod",
  bytes_in: 1024,
  bytes_out: 2048,
  duration_ms: 125000,
  has_recording: false,
  id: "session-1",
  started_at: "2026-05-04T00:00:00Z",
  user_id: "user-1",
  user_name: "Ada",
};

describe("session status helpers", () => {
  it("derives active, closed, and error states", () => {
    expect(sessionStatus(baseSession)).toBe("active");
    expect(sessionStatus({ ...baseSession, ended_at: "2026-05-04T00:02:00Z" })).toBe("closed");
    expect(sessionStatus({ ...baseSession, error: "connection failed" })).toBe("error");
  });

  it("maps status to UI tones", () => {
    expect(sessionStatusTone(baseSession)).toBe("info");
    expect(sessionStatusTone({ ...baseSession, ended_at: "2026-05-04T00:02:00Z" })).toBe("ok");
    expect(sessionStatusTone({ ...baseSession, error: "connection failed" })).toBe("warn");
  });
});

describe("filterSessionsByStatus", () => {
  const sessions = [
    baseSession,
    { ...baseSession, ended_at: "2026-05-04T00:02:00Z", id: "session-2" },
    { ...baseSession, error: "connection failed", id: "session-3" },
  ];

  it.each([
    ["all", ["session-1", "session-2", "session-3"]],
    ["active", ["session-1"]],
    ["closed", ["session-2"]],
    ["error", ["session-3"]],
  ] satisfies [SessionStatusFilter, string[]][])("filters %s sessions", (status, expected) => {
    expect(filterSessionsByStatus(sessions, status).map((item) => item.id)).toEqual(expected);
  });
});

describe("sessionCounts", () => {
  it("counts visible session states", () => {
    expect(
      sessionCounts([
        baseSession,
        { ...baseSession, ended_at: "2026-05-04T00:02:00Z", has_recording: true, id: "session-2" },
        { ...baseSession, error: "connection failed", id: "session-3" },
      ]),
    ).toEqual({
      active: 1,
      closed: 1,
      errors: 1,
      recordings: 1,
      total: 3,
    });
  });
});

describe("formatters", () => {
  it("formats durations and byte counts", () => {
    expect(formatDurationMs(125000)).toBe("2m 5s");
    expect(formatDurationMs(3900000)).toBe("1h 5m");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(12 * 1024 * 1024)).toBe("12.0 MB");
  });
});

describe("parseAsciicast", () => {
  it("parses v2 headers and output frames", () => {
    expect(
      parseAsciicast(
        [
          JSON.stringify({ version: 2, width: 100, height: 30 }),
          JSON.stringify([0.1, "o", "hello "]),
          JSON.stringify([0.3, "i", "ignored"]),
          JSON.stringify([1.5, "o", "world"]),
        ].join("\n"),
      ),
    ).toEqual({
      cols: 100,
      durationSeconds: 1.5,
      frames: 2,
      outputSample: "hello world",
      rows: 30,
      version: 2,
    });
  });

  it("rejects empty or unsupported recordings", () => {
    expect(() => parseAsciicast("")).toThrow("Recording is empty.");
    expect(() => parseAsciicast(JSON.stringify({ version: 1 }))).toThrow("Unsupported cast version 1.");
  });
});
