import type { IncomingMessage } from 'node:http';

const DEFAULT_MAX = 104_857_600; // 100MB

function maxBytes(): number {
  const raw = process.env.COMPANION_MAX_UPLOAD_BYTES?.trim();
  if (!raw) return DEFAULT_MAX;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX;
  return Math.min(n, 512 * 1024 * 1024); // 硬顶 512MB
}

export function readRequestBodyRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cap = maxBytes();
    const chunks: Buffer[] = [];
    let len = 0;
    const fail = (e: Error) => {
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      reject(e);
    };
    req.on('data', (c: Buffer) => {
      len += c.length;
      if (len > cap) {
        fail(new Error('payload_too_large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0)));
    req.on('error', (e) => fail(e instanceof Error ? e : new Error(String(e))));
  });
}
