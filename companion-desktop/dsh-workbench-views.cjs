'use strict';

const { fingerSurfaceForShellView, isLeasedRoomView } = require('./shell-rooms.cjs');
const { ROOM_SESSION_PARTITION } = require('./shell-room-compartment.cjs');

const DSH_SESSION_PARTITION = 'persist:assetcutter-dsh';
const TEAM_SESSION_PARTITION = 'persist:assetcutter-team';

function shellViewShowsDsh(_shellView) {
  return true;
}

function sameDshOrigin(currentUrl, targetUrl) {
  try {
    const cur = new URL(String(currentUrl || ''));
    const target = new URL(String(targetUrl || ''));
    if (cur.origin !== target.origin) return false;
    const host = String(cur.hostname || '').toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

function viewsForShellView(shellView, attached) {
  const v = String(shellView || '');
  const workbench = attached && attached.workbench;
  const dsh = attached && attached.dsh;
  const room = attached && attached.room;
  if (v === 'workbench') return [workbench, dsh].filter(Boolean);
  if (isLeasedRoomView(v)) return [room, dsh].filter(Boolean);
  return [dsh].filter(Boolean);
}

function isDshPartitionAllowed(partition) {
  const p = String(partition || '');
  return p === DSH_SESSION_PARTITION;
}

module.exports = {
  DSH_SESSION_PARTITION,
  TEAM_SESSION_PARTITION,
  ROOM_SESSION_PARTITION,
  viewsForShellView,
  shellViewShowsDsh,
  sameDshOrigin,
  fingerSurfaceForShellView,
  isDshPartitionAllowed,
};
