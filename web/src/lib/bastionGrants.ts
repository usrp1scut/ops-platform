export function formatGrantTimeRemaining(expiresAt: string, now = new Date()) {
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return "-";

  const remainingSeconds = Math.ceil((expires.getTime() - now.getTime()) / 1000);
  if (remainingSeconds <= 0) return "expired";

  const days = Math.floor(remainingSeconds / 86400);
  const hours = Math.floor((remainingSeconds % 86400) / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);

  if (days > 0 && hours > 0) return `${days}d ${hours}h left`;
  if (days > 0) return `${days}d left`;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m left`;
  if (hours > 0) return `${hours}h left`;
  if (minutes > 0) return `${minutes}m left`;
  return `${remainingSeconds}s left`;
}
