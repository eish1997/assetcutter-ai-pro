function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function normalizeInlineBase64Data(value) {
  const raw = nonEmptyString(value);
  if (!raw) return '';
  const dataUrl = raw.match(/^data:([^;,]+);base64,(.+)$/is);
  const payload = dataUrl ? dataUrl[2] || '' : raw;
  return String(payload).replace(/\\r|\\n/g, '').replace(/\s+/g, '');
}

export function normalizeInlineDataPayload(value) {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const normalized = normalizeInlineDataPayload(item);
      if (normalized !== item) changed = true;
      return normalized;
    });
    return changed ? next : value;
  }
  if (!value || typeof value !== 'object') return value;
  let changed = false;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'inlineData' || key === 'inline_data') && child && typeof child === 'object' && !Array.isArray(child)) {
      const inline = { ...child };
      const rawData = inline.data;
      if (typeof rawData === 'string') {
        const nextData = normalizeInlineBase64Data(rawData);
        if (nextData !== rawData) {
          inline.data = nextData;
          changed = true;
        }
      }
      out[key] = inline;
      if (inline !== child) changed = true;
      continue;
    }
    const normalized = normalizeInlineDataPayload(child);
    out[key] = normalized;
    if (normalized !== child) changed = true;
  }
  return changed ? out : value;
}
