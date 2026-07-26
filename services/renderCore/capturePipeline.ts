/**
 * Capture helpers for adapter canvases.
 * WebGPU paths may need caller to render a frame with preserveDrawingBuffer-like behavior first.
 */

export function captureCanvasDataUrl(
  canvas: HTMLCanvasElement | null | undefined,
  mimeType = 'image/png',
  quality?: number
): string | null {
  if (!canvas || typeof canvas.toDataURL !== 'function') return null;
  try {
    if (typeof quality === 'number') {
      return canvas.toDataURL(mimeType, quality);
    }
    return canvas.toDataURL(mimeType);
  } catch {
    return null;
  }
}
