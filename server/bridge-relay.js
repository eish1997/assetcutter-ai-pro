import crypto from 'crypto';
import { WebSocketServer } from 'ws';

function toJsonSafe(raw) {
  try {
    const text = typeof raw === 'string' ? raw : String(raw || '');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

const DISPATCH_DEDUP_MS = Number(process.env.BRIDGE_DISPATCH_DEDUP_MS || 30 * 60 * 1000);
const DISPATCH_DEDUP_MAX = Number(process.env.BRIDGE_DISPATCH_DEDUP_MAX || 2000);
const MAX_IMAGE_BASE64_CHARS = Number(
  process.env.BRIDGE_MAX_IMAGE_BASE64_CHARS || 8_000_000
);

export function createBridgeRelay({ requireAuth, resolveSessionUser }) {
  const wss = new WebSocketServer({ noServer: true });
  const deviceSockets = new Map();
  const deviceOwners = new Map();
  const taskEvents = new Map();
  const taskEventOrder = [];
  /** 用户下发任务归属（仅 user API 写入） */
  const taskOwners = new Map();
  /** @type {Map<string, { taskId: string; deviceId: string; ts: number }>} */
  const dispatchDedup = new Map();

  const MAX_IMAGE_PARTS = 4;

  function addSocket(deviceId, ws) {
    const set = deviceSockets.get(deviceId) || new Set();
    set.add(ws);
    deviceSockets.set(deviceId, set);
  }

  function removeSocket(deviceId, ws) {
    const set = deviceSockets.get(deviceId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      deviceSockets.delete(deviceId);
      deviceOwners.delete(deviceId);
    }
  }

  function pruneDispatchDedup(now) {
    for (const [key, row] of dispatchDedup.entries()) {
      if (now - row.ts > DISPATCH_DEDUP_MS) dispatchDedup.delete(key);
    }
    while (dispatchDedup.size > DISPATCH_DEDUP_MAX) {
      const firstKey = dispatchDedup.keys().next().value;
      if (firstKey == null) break;
      dispatchDedup.delete(firstKey);
    }
  }

  function recordTaskEvent(taskId, event) {
    if (!taskId) return;
    const list = taskEvents.get(taskId) || [];
    if (!taskEvents.has(taskId)) {
      taskEventOrder.push(taskId);
    }
    list.push({ at: nowIso(), event });
    if (list.length > 200) list.shift();
    taskEvents.set(taskId, list);
    while (taskEventOrder.length > 500) {
      const oldestTaskId = taskEventOrder.shift();
      if (oldestTaskId) {
        taskEvents.delete(oldestTaskId);
        taskOwners.delete(oldestTaskId);
      }
    }
  }

  wss.on('connection', (ws, request, context) => {
    const deviceId = context.deviceId;
    const sessionUserId = context.sessionUserId || null;
    addSocket(deviceId, ws);
    ws.send(
      JSON.stringify({
        type: 'bridge.connected',
        deviceId,
        connectedAt: Date.now(),
      })
    );
    console.log(`[bridge-relay] device connected: ${deviceId}${sessionUserId ? ` user=${sessionUserId}` : ''}`);

    ws.on('message', (raw) => {
      const message = toJsonSafe(raw);
      if (!message || typeof message !== 'object') return;
      const taskId = typeof message.taskId === 'string' ? message.taskId : '';
      if (taskId) recordTaskEvent(taskId, message);
      if (message.type === 'bridge.pong') return;
      if (message.type === 'transport.ack') {
        const mid = typeof message.messageId === 'string' ? message.messageId : '';
        if (mid && taskId) {
          recordTaskEvent(taskId, message);
        }
        return;
      }
      if (message.type === 'task.failed') {
        console.warn(`[bridge-relay] task failed: ${taskId} code=${message.code || 'unknown'}`);
      }
    });

    ws.on('close', () => {
      removeSocket(deviceId, ws);
      console.log(`[bridge-relay] device disconnected: ${deviceId}`);
    });
  });

  async function handleUpgrade(req, socket, head) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/ws/bridge') return false;

    const deviceId = String(req.headers['x-a-driver-device-id'] || '').trim();
    if (!deviceId) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\nmissing x-a-driver-device-id');
      socket.destroy();
      return true;
    }

    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
    let sessionUserId = null;
    if (requireAuth) {
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\nmissing bearer token');
        socket.destroy();
        return true;
      }
      const user = await resolveSessionUser(token);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\ninvalid session token');
        socket.destroy();
        return true;
      }
      sessionUserId = user.id != null ? String(user.id) : null;
    }

    if (requireAuth) {
      const owner = deviceOwners.get(deviceId);
      if (
        owner != null &&
        sessionUserId != null &&
        String(owner) !== String(sessionUserId)
      ) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\ndeviceId already bound to another user');
        socket.destroy();
        return true;
      }
      if (sessionUserId) {
        deviceOwners.set(deviceId, sessionUserId);
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, { deviceId, sessionUserId });
    });
    return true;
  }

  function listDevices() {
    return [...deviceSockets.entries()].map(([deviceId, set]) => ({
      deviceId,
      connections: set.size,
    }));
  }

  function listDevicesForUser(userId) {
    if (!requireAuth) {
      return [...deviceSockets.entries()].map(([deviceId, set]) => ({
        deviceId,
        connections: set.size,
      }));
    }
    const out = [];
    for (const [deviceId, uid] of deviceOwners.entries()) {
      if (String(uid) !== String(userId)) continue;
      const set = deviceSockets.get(deviceId);
      out.push({ deviceId, connections: set?.size ?? 0 });
    }
    return out;
  }

  function normalizeImages(images) {
    if (!Array.isArray(images) || images.length === 0) {
      return { parts: undefined, requested: 0, accepted: 0, rejectedTooLarge: 0 };
    }
    let rejectedTooLarge = 0;
    const parts = images.slice(0, MAX_IMAGE_PARTS).map((row) => {
      const mimeType = String(row?.mimeType || 'image/jpeg').trim() || 'image/jpeg';
      const dataBase64 = String(row?.dataBase64 || '').trim();
      if (!dataBase64 || dataBase64.length > MAX_IMAGE_BASE64_CHARS) {
        if (dataBase64.length > MAX_IMAGE_BASE64_CHARS) rejectedTooLarge += 1;
        return null;
      }
      return { mimeType, dataBase64 };
    }).filter(Boolean);
    return {
      parts: parts.length ? parts : undefined,
      requested: images.length,
      accepted: parts.length,
      rejectedTooLarge,
    };
  }

  function sendTask(task, options = {}) {
    const userId = options.userId != null ? String(options.userId) : null;
    const deviceId = String(task.deviceId || '').trim();
    if (!deviceId) {
      return { ok: false, error: 'deviceId 不能为空' };
    }
    if (userId) {
      const owner = deviceOwners.get(deviceId);
      if (owner != null && String(owner) !== String(userId)) {
        return { ok: false, error: '设备不属于当前用户' };
      }
    }
    const set = deviceSockets.get(deviceId);
    if (!set || set.size === 0) {
      return { ok: false, error: `设备未连接：${deviceId}` };
    }
    const now = Date.now();
    pruneDispatchDedup(now);
    const messageId = String(task.messageId || '').trim() || crypto.randomUUID();
    const dedupKey = `${deviceId}:${messageId}`;
    const existing = dispatchDedup.get(dedupKey);
    if (existing && now - existing.ts <= DISPATCH_DEDUP_MS) {
      if (userId) {
        taskOwners.set(existing.taskId, userId);
      }
      return {
        ok: true,
        deduped: true,
        taskId: existing.taskId,
        messageId,
      };
    }
    const normalizedImages = normalizeImages(task.images);
    const images = normalizedImages.parts;
    if (Array.isArray(task.images) && task.images.length > 0 && !images) {
      return {
        ok: false,
        error:
          `图片未通过中继校验（请求 ${normalizedImages.requested} 张，` +
          `超限 ${normalizedImages.rejectedTooLarge} 张；` +
          `单图 base64 上限 ${MAX_IMAGE_BASE64_CHARS} 字符）`,
      };
    }
    const payload = {
      type: 'task.send_message',
      taskId: String(task.taskId || crypto.randomUUID()),
      connectorId: String(task.connectorId || 'gemini-web'),
      messageId,
      payload: {
        text: String(task.text || ''),
        ...(task.threadId ? { threadId: String(task.threadId) } : {}),
        ...(images ? { images } : {}),
      },
    };
    dispatchDedup.set(dedupKey, { taskId: payload.taskId, deviceId, ts: now });
    if (userId) {
      taskOwners.set(payload.taskId, userId);
    }
    for (const ws of set) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(payload));
      }
    }
    recordTaskEvent(payload.taskId, {
      type: 'task.dispatched',
      deviceId,
      connectorId: payload.connectorId,
      messageId,
      imageCount: images?.length || 0,
    });
    return { ok: true, taskId: payload.taskId, messageId, deduped: false };
  }

  function getTaskEvents(taskId, viewerUserId = null) {
    if (viewerUserId != null && viewerUserId !== '') {
      const owner = taskOwners.get(taskId);
      if (String(owner ?? '') !== String(viewerUserId)) {
        return null;
      }
    }
    return taskEvents.get(taskId) || [];
  }

  return {
    handleUpgrade,
    listDevices,
    listDevicesForUser,
    sendTask,
    getTaskEvents,
  };
}

