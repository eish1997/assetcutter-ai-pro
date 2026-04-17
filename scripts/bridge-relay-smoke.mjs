/**
 * 最小联调：管理员 Cookie + 已在线 deviceId。
 * 用法（PowerShell）：
 *   $env:BRIDGE_BASE='http://127.0.0.1:9100'
 *   $env:BRIDGE_COOKIE='ac_session=你的会话值'
 *   $env:BRIDGE_DEVICE_ID='local-dev-device'
 *   node scripts/bridge-relay-smoke.mjs
 */
const base = String(process.env.BRIDGE_BASE || 'http://127.0.0.1:9100').replace(/\/$/, '');
const cookie = String(process.env.BRIDGE_COOKIE || '').trim();
const deviceId = String(process.env.BRIDGE_DEVICE_ID || 'local-dev-device').trim();

if (!cookie) {
  console.error('请设置 BRIDGE_COOKIE（例如 ac_session=...）');
  process.exit(1);
}

async function api(path, init = {}) {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Cookie: cookie,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

const mid = `smoke-${Date.now()}`;
const body = {
  deviceId,
  text: 'smoke ping',
  messageId: mid,
  connectorId: 'gemini-web',
};

console.log('[smoke] GET /api/bridge/devices');
console.log(await api('/api/bridge/devices'));

console.log('[smoke] POST send-message #1');
const r1 = await api('/api/bridge/tasks/send-message', {
  method: 'POST',
  body: JSON.stringify(body),
});
console.log(r1);

console.log('[smoke] POST send-message #2 (same messageId, expect deduped)');
const r2 = await api('/api/bridge/tasks/send-message', {
  method: 'POST',
  body: JSON.stringify(body),
});
console.log(r2);
if (!r2.deduped) {
  console.error('预期第二次 deduped=true');
  process.exit(1);
}

const taskId = r1.taskId;
if (taskId) {
  console.log('[smoke] GET events', taskId);
  const ev = await api(`/api/bridge/tasks/${encodeURIComponent(taskId)}/events`);
  console.log(JSON.stringify(ev, null, 2));
}

console.log('[smoke] ok');
