/**
 * Minimal ZIP writer (store only, no compression) for shell tool packs.
 * Avoids adding fflate when disk/install is constrained.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

export type ZipFileEntry = { path: string; data: Uint8Array };

export function collectDirFiles(dir: string, base = dir): ZipFileEntry[] {
  const out: ZipFileEntry[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    const rel = relative(base, full).replace(/\\/g, '/');
    if (ent.isDirectory()) out.push(...collectDirFiles(full, base));
    else out.push({ path: rel, data: new Uint8Array(readFileSync(full)) });
  }
  return out;
}

/** Build an uncompressed ZIP buffer from path→bytes entries. */
export function buildStoreZip(files: ZipFileEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path, 'utf8');
    const data = Buffer.from(f.data);
    const crc = crc32(f.data);
    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    localParts.push(localHeader);
    centralParts.push(central);
    offset += localHeader.length;
  }
  const localBlob = Buffer.concat(localParts);
  const centralBlob = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBlob.length),
    u32(localBlob.length),
    u16(0),
  ]);
  return Buffer.concat([localBlob, centralBlob, end]);
}

export async function writeStoreZipFile(
  destZipPath: string,
  files: ZipFileEntry[],
): Promise<{ sha256: string; bytes: number }> {
  const buf = buildStoreZip(files);
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(destZipPath);
    ws.on('finish', () => resolve());
    ws.on('error', reject);
    ws.end(buf);
  });
  return {
    sha256: createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
  };
}

export function assertDirHasFiles(dir: string): void {
  if (!statSync(dir).isDirectory()) throw new Error('not_a_directory');
}
