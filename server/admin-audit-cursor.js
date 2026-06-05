export function encodeAuditCursor(row) {
  if (!row?.createdAt || !row?.id) return null;
  const payload = JSON.stringify({ t: row.createdAt, i: row.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeAuditCursor(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const { t, i } = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (!t || !i) return null;
    return { createdAt: String(t), id: String(i) };
  } catch {
    return null;
  }
}

export function rowBeforeCursor(row, cursor) {
  if (!cursor) return true;
  const rowMs = new Date(row.createdAt).getTime();
  const curMs = new Date(cursor.createdAt).getTime();
  if (rowMs < curMs) return true;
  if (rowMs > curMs) return false;
  return String(row.id) < String(cursor.id);
}
