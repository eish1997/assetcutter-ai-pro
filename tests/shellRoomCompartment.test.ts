import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  roomDir,
  ensureEmptyRoom,
  removeRoomDir,
  packStoredZip,
  exportRoomZip,
  unpackRoomZip,
  validateRoomZip,
} = require('../companion-desktop/shell-room-compartment.cjs') as {
  roomDir: (userData: string, roomId: string) => string;
  ensureEmptyRoom: (opts: { userData: string; roomId: string; title?: string }) => { dir: string; entry: string };
  removeRoomDir: (opts: { userData: string; roomId: string }) => { removed: boolean };
  packStoredZip: (entries: Array<{ name: string; data: Buffer | string }>) => Buffer;
  exportRoomZip: (opts: { userData: string; roomId: string; title?: string }) => Buffer;
  unpackRoomZip: (buf: Buffer, destDir: string) => { manifest: { title: string; entry: string } };
  validateRoomZip: (buf: Buffer) => { manifest: { kind: string; title: string; entry: string } };
};
const {
  createLeasedRoomStore,
} = require('../companion-desktop/shell-leased-rooms.cjs') as {
  createLeasedRoomStore: (opts: { getPath: () => string }) => {
    create: (opts?: { title?: string }) => { id: string; title: string };
    remove: (id: string) => unknown;
  };
};

function u16(n: number) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32(n: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function packRawZip(name: string, data: Buffer) {
  const nameBuf = Buffer.from(name, 'utf8');
  const local = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(data.length),
    u32(data.length),
    u16(nameBuf.length),
    u16(0),
    nameBuf,
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
    u32(0),
    u32(data.length),
    u32(data.length),
    u16(nameBuf.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    nameBuf,
  ]);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(central.length),
    u32(local.length),
    u16(0),
  ]);
  return Buffer.concat([local, central, eocd]);
}

describe('shell room compartment', () => {
  it('writes an empty entry page and removes the directory with the lease', () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-room-'));
    const store = createLeasedRoomStore({ getPath: () => path.join(userData, 'shell-leased-rooms.json') });
    const room = store.create();
    const made = ensureEmptyRoom({ userData, roomId: room.id, title: room.title });
    expect(fs.existsSync(made.entry)).toBe(true);
    expect(fs.readFileSync(made.entry, 'utf8')).toContain('<title>');
    expect(made.dir).toBe(roomDir(userData, room.id));
    store.remove(room.id);
    expect(removeRoomDir({ userData, roomId: room.id }).removed).toBe(true);
    expect(fs.existsSync(made.dir)).toBe(false);
  });

  it('round-trips a room zip onto a new lease id without writing the old id', () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-room-'));
    const store = createLeasedRoomStore({ getPath: () => path.join(userData, 'shell-leased-rooms.json') });
    const first = store.create();
    ensureEmptyRoom({ userData, roomId: first.id, title: first.title });
    const painted = '<html><body>painted-room</body></html>';
    fs.writeFileSync(path.join(roomDir(userData, first.id), 'index.html'), painted, 'utf8');
    const zip = exportRoomZip({ userData, roomId: first.id, title: first.title });
    const { manifest } = validateRoomZip(zip);
    expect(manifest.kind).toBe('assetcutter-room');
    expect(manifest.entry).toBe('index.html');
    expect(JSON.stringify(manifest)).not.toContain(first.id);
    const second = store.create({ title: manifest.title });
    expect(second.id).not.toBe(first.id);
    unpackRoomZip(zip, roomDir(userData, second.id));
    expect(fs.readFileSync(path.join(roomDir(userData, second.id), 'index.html'), 'utf8')).toBe(painted);
  });

  it('rejects zip names that escape the room directory', () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-room-unpack-'));
    const zip = packRawZip('../escape.html', Buffer.from('<html></html>'));
    expect(() => unpackRoomZip(zip, dest)).toThrow(/zip_path_traversal/);
    expect(() => packStoredZip([{ name: '../escape.html', data: Buffer.from('x') }])).toThrow(/zip_path_invalid/);
  });
});
