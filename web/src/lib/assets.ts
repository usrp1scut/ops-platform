export function formatAssetRange(total: number, offset: number, count: number) {
  if (total <= 0 || count <= 0) return "0 assets";

  const from = offset + 1;
  const to = Math.min(offset + count, total);

  return `${from}-${to} of ${total}`;
}

export function previousAssetOffset(offset: number, limit: number) {
  return Math.max(0, offset - limit);
}

export function nextAssetOffset(offset: number, limit: number, total: number) {
  if (limit <= 0) return offset;
  if (offset + limit >= total) return offset;

  return offset + limit;
}
