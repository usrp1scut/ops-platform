import type { BastionRequestStatus } from "../api/bastion";

export function requestStatusTone(status: BastionRequestStatus) {
  switch (status) {
    case "approved":
      return "ok";
    case "pending":
      return "info";
    case "rejected":
    case "cancelled":
    case "expired":
      return "warn";
  }
}

export function formatDurationSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}
