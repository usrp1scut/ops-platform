import type { SessionAuditRecord } from "../api/sessions";

export type SessionStatusFilter = "all" | "active" | "closed" | "error";

export type SessionFilters = {
  assetID: string;
  status: SessionStatusFilter;
  userID: string;
};

export type SessionCounts = {
  active: number;
  closed: number;
  errors: number;
  recordings: number;
  total: number;
};

export type RecordingPreview = {
  cols: number;
  durationSeconds: number;
  frames: number;
  outputSample: string;
  rows: number;
  version: number;
};

export function sessionStatus(session: SessionAuditRecord) {
  if (session.error) return "error";
  if (session.ended_at) return "closed";
  return "active";
}

export function sessionStatusTone(session: SessionAuditRecord) {
  const status = sessionStatus(session);
  if (status === "active") return "info";
  if (status === "closed") return "ok";
  return "warn";
}

export function filterSessionsByStatus(items: SessionAuditRecord[], status: SessionStatusFilter) {
  if (status === "all") return items;

  return items.filter((item) => sessionStatus(item) === status);
}

export function sessionCounts(items: SessionAuditRecord[]): SessionCounts {
  return {
    active: items.filter((item) => sessionStatus(item) === "active").length,
    closed: items.filter((item) => sessionStatus(item) === "closed").length,
    errors: items.filter((item) => sessionStatus(item) === "error").length,
    recordings: items.filter((item) => item.has_recording).length,
    total: items.length,
  };
}

export function formatDurationMs(value: number | undefined) {
  if (!value || value <= 0) return "-";

  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatBytes(value: number | undefined) {
  const bytes = value || 0;
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex++;
  }

  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function recordingLabel(session: SessionAuditRecord) {
  return `${session.user_name || session.user_id} @ ${session.asset_name || session.asset_id}`;
}

export function parseAsciicast(text: string, sampleLimit = 4000): RecordingPreview {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    throw new Error("Recording is empty.");
  }

  const header = JSON.parse(lines[0]) as { height?: number; version?: number; width?: number };
  if (header.version !== 2) {
    throw new Error(`Unsupported cast version ${header.version || "unknown"}.`);
  }

  let frames = 0;
  let durationSeconds = 0;
  let outputSample = "";

  for (const line of lines.slice(1)) {
    try {
      const frame = JSON.parse(line) as unknown;
      if (!Array.isArray(frame) || frame.length < 3 || frame[1] !== "o") continue;
      frames++;
      if (typeof frame[0] === "number") durationSeconds = frame[0];
      if (typeof frame[2] === "string" && outputSample.length < sampleLimit) {
        outputSample += frame[2].slice(0, sampleLimit - outputSample.length);
      }
    } catch {
      // Recordings are best-effort audit artifacts. Skip malformed frames
      // instead of throwing away an otherwise readable preview.
    }
  }

  return {
    cols: header.width || 80,
    durationSeconds,
    frames,
    outputSample,
    rows: header.height || 24,
    version: header.version,
  };
}
