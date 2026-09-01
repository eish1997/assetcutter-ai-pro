'use strict';

const fs = require('fs');
const { isLeasedRoomView } = require('./shell-rooms.cjs');

function createLeasedRoomRecord(now = Date.now(), index = 0) {
  const suffix = (Math.random().toString(36).slice(2) + 'xxxxxx').slice(0, 6);
  const id = `room-${Number(now).toString(36)}-${suffix}`;
  return {
    id,
    title: `空房 ${index + 1}`,
    createdAt: Number(now) || Date.now(),
  };
}

function parseLeasedRooms(raw) {
  const list = raw && Array.isArray(raw.rooms) ? raw.rooms : Array.isArray(raw) ? raw : [];
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || '');
    if (!isLeasedRoomView(id)) continue;
    const title = String(row.title || '').trim() || id;
    const createdAt = Number(row.createdAt) || 0;
    out.push({ id, title, createdAt });
  }
  return out;
}

function createLeasedRoomStore(opts = {}) {
  const getPath = typeof opts.getPath === 'function' ? opts.getPath : () => '';

  function load() {
    const p = String(getPath() || '');
    if (!p) return [];
    try {
      if (!fs.existsSync(p)) return [];
      return parseLeasedRooms(JSON.parse(fs.readFileSync(p, 'utf8')));
    } catch {
      return [];
    }
  }

  function save(rooms) {
    const p = String(getPath() || '');
    if (!p) return;
    fs.writeFileSync(p, `${JSON.stringify({ rooms }, null, 2)}\n`, 'utf8');
  }

  function list() {
    return load();
  }

  function has(id) {
    return load().some((row) => row.id === id);
  }

  function create(opts) {
    const rooms = load();
    const room = createLeasedRoomRecord(Date.now(), rooms.length);
    const title = opts && typeof opts.title === 'string' ? opts.title.trim() : '';
    if (title) room.title = title;
    rooms.push(room);
    save(rooms);
    return room;
  }

  function remove(id) {
    const wanted = String(id || '');
    const rooms = load();
    const next = rooms.filter((row) => row.id !== wanted);
    if (next.length === rooms.length) return null;
    save(next);
    return next;
  }

  return { list, has, create, remove };
}

module.exports = {
  createLeasedRoomRecord,
  parseLeasedRooms,
  createLeasedRoomStore,
};
