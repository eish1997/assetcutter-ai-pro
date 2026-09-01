import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  DSH_MODULE_ENTRIES,
  isLeasedRoomView,
  shellViewForSurface,
  fingerSurfaceForShellView,
  normalizeResidentShellView,
} = require('../companion-desktop/shell-rooms.cjs') as {
  DSH_MODULE_ENTRIES: Record<string, { surface: string; shellView: string }>;
  isLeasedRoomView: (view: string) => boolean;
  shellViewForSurface: (surface: string) => string;
  fingerSurfaceForShellView: (view: string) => string;
  normalizeResidentShellView: (view: string) => string;
};
const {
  createLeasedRoomRecord,
  parseLeasedRooms,
  createLeasedRoomStore,
} = require('../companion-desktop/shell-leased-rooms.cjs') as {
  createLeasedRoomRecord: (now?: number, index?: number) => { id: string; title: string; createdAt: number };
  parseLeasedRooms: (raw: unknown) => Array<{ id: string; title: string }>;
  createLeasedRoomStore: (opts: { getPath: () => string }) => {
    list: () => Array<{ id: string; title: string }>;
    has: (id: string) => boolean;
    create: () => { id: string; title: string };
    remove: (id: string) => Array<{ id: string; title: string }> | null;
  };
};

describe('shell rooms catalog', () => {
  it('maps concierge surfaces onto every resident shell view', () => {
    expect(shellViewForSurface('canvas')).toBe('workbench');
    expect(shellViewForSurface('workflow')).toBe('workflow');
    expect(shellViewForSurface('tools')).toBe('tools');
    expect(shellViewForSurface('connections')).toBe('connections');
    expect(shellViewForSurface('settings')).toBe('settings');
    expect(shellViewForSurface('workbench')).toBe('workbench');
    expect(fingerSurfaceForShellView('workbench')).toBe('canvas');
    expect(fingerSurfaceForShellView('workflow')).toBe('workflow');
    expect(fingerSurfaceForShellView('settings')).toBe('settings');
    expect(normalizeResidentShellView('home')).toBe('workbench');
    expect(normalizeResidentShellView('scripts')).toBe('workflow');
    expect(DSH_MODULE_ENTRIES.workflow.shellView).toBe('workflow');
  });

  it('treats leased room ids as extra shell views', () => {
    const room = createLeasedRoomRecord(1, 0);
    expect(isLeasedRoomView(room.id)).toBe(true);
    expect(shellViewForSurface(room.id)).toBe(room.id);
    expect(fingerSurfaceForShellView(room.id)).toBe(room.id);
    expect(parseLeasedRooms({ rooms: [room, { id: 'nope' }] })).toEqual([
      { id: room.id, title: room.title, createdAt: room.createdAt },
    ]);
  });

  it('persists leased rooms to a json file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-leased-rooms-'));
    const file = path.join(dir, 'shell-leased-rooms.json');
    const store = createLeasedRoomStore({ getPath: () => file });
    const room = store.create();
    expect(store.has(room.id)).toBe(true);
    expect(store.list()).toHaveLength(1);
    const again = createLeasedRoomStore({ getPath: () => file });
    expect(again.list().map((row) => row.id)).toEqual([room.id]);
    expect(again.remove(room.id)?.map((row) => row.id)).toEqual([]);
    expect(again.has(room.id)).toBe(false);
  });
});
