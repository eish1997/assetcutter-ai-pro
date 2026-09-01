'use strict';

/** 楼里常驻房间：三家店 + 通讯室 + 配电间。加号租出的房不在这里。 */
const RESIDENT_ROOMS = [
  { shellView: 'workbench', surface: 'canvas' },
  { shellView: 'workflow', surface: 'workflow' },
  { shellView: 'tools', surface: 'tools' },
  { shellView: 'connections', surface: 'connections' },
  { shellView: 'settings', surface: 'settings' },
];

const DSH_MODULE_ENTRIES = Object.fromEntries(
  RESIDENT_ROOMS.map((row) => [row.surface, { surface: row.surface, shellView: row.shellView }]),
);

const RESIDENT_SHELL_VIEWS = new Set(RESIDENT_ROOMS.map((row) => row.shellView));

const LEASED_ROOM_VIEW_RE = /^room-[a-z0-9]+-[a-z0-9]+$/i;

function isLeasedRoomView(view) {
  return LEASED_ROOM_VIEW_RE.test(String(view || ''));
}

function shellViewForSurface(surface) {
  const key = String(surface || '');
  if (DSH_MODULE_ENTRIES[key]) return DSH_MODULE_ENTRIES[key].shellView;
  for (const row of RESIDENT_ROOMS) {
    if (row.shellView === key) return row.shellView;
  }
  if (isLeasedRoomView(key)) return key;
  return '';
}

function fingerSurfaceForShellView(shellView) {
  const v = String(shellView || '');
  for (const row of RESIDENT_ROOMS) {
    if (row.shellView === v) return row.surface;
  }
  if (isLeasedRoomView(v)) return v;
  return 'other';
}

function normalizeResidentShellView(view) {
  const v = String(view || '');
  if (v === 'scripts') return 'workflow';
  if (v === 'home') return 'workbench';
  if (RESIDENT_SHELL_VIEWS.has(v)) return v;
  if (isLeasedRoomView(v)) return v;
  return '';
}

module.exports = {
  RESIDENT_ROOMS,
  RESIDENT_SHELL_VIEWS,
  DSH_MODULE_ENTRIES,
  isLeasedRoomView,
  shellViewForSurface,
  fingerSurfaceForShellView,
  normalizeResidentShellView,
};
