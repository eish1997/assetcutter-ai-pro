function toWellFormedString(value: string): string {
  const nativeToWellFormed = (String.prototype as unknown as { toWellFormed?: () => string }).toWellFormed;
  if (typeof nativeToWellFormed === 'function') {
    return nativeToWellFormed.call(value);
  }
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i] + value[i + 1];
        i += 1;
      } else {
        out += '\uFFFD';
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += '\uFFFD';
      continue;
    }
    out += value[i];
  }
  return out;
}

export function safeEncodeURIComponent(value: string): string {
  return encodeURIComponent(toWellFormedString(String(value ?? '')));
}

export function safeSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${safeEncodeURIComponent(svg)}`;
}
