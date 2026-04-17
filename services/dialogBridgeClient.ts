import { apiUrl } from './apiBase';
import { HttpRequestError, requestJson } from './httpClient';

export type BridgeDeviceRow = { deviceId: string; connections: number };

export type BridgeImagePayload = { mimeType: string; dataBase64: string };

export async function fetchBridgeUserDevices(): Promise<{ devices: BridgeDeviceRow[] }> {
  return requestJson(apiUrl('/api/bridge/user/devices'));
}

export async function sendBridgeUserMessage(body: {
  deviceId: string;
  text: string;
  threadId?: string;
  connectorId?: string;
  messageId?: string;
  images?: BridgeImagePayload[];
}): Promise<{ ok: boolean; taskId: string; messageId: string; deduped: boolean }> {
  return requestJson(apiUrl('/api/bridge/user/send-message'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function fetchBridgeUserTaskEvents(taskId: string): Promise<{
  taskId: string;
  events: Array<{ at: string; event: Record<string, unknown> }>;
}> {
  return requestJson(apiUrl(`/api/bridge/user/tasks/${encodeURIComponent(taskId)}/events`));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type BridgePollResult =
  | { ok: true; text: string; images: string[] }
  | { ok: false; code: string; message: string };

/**
 * 轮询任务事件直到 reply.completed / task.failed / 超时。
 * 仅处理自 lastIndex 起的新事件，避免重复累计 delta。
 */
export async function pollBridgeTaskUntilDone(
  taskId: string,
  options: {
    onDelta?: (fullText: string) => void;
    intervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<BridgePollResult> {
  const interval = options.intervalMs ?? 200;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const deadline = Date.now() + timeoutMs;
  let lastIndex = 0;
  let text = '';
  let images: string[] = [];

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      return { ok: false, code: 'aborted', message: '已取消' };
    }
    let events: Array<{ at: string; event: Record<string, unknown> }>;
    try {
      ({ events } = await fetchBridgeUserTaskEvents(taskId));
    } catch (e) {
      if (e instanceof HttpRequestError && e.status === 403) {
        return {
          ok: false,
          code: 'E_BRIDGE_FORBIDDEN',
          message: '无权拉取该任务事件（请检查是否已登录、设备是否绑定同一账号）',
        };
      }
      throw e;
    }
    const slice = events.slice(lastIndex);
    lastIndex = events.length;

    for (const row of slice) {
      const ev = row.event;
      const type = typeof ev.type === 'string' ? ev.type : '';
      if (type === 'reply.delta' && typeof ev.delta === 'string') {
        const d = ev.delta;
        /** Gemini 等连接器常每次下发「当前全文」；旧逻辑 += 会重复拼接且 UI 异常 */
        if (text === '' || d.startsWith(text)) {
          text = d;
        } else {
          text += d;
        }
        options.onDelta?.(text);
      }
      if (type === 'reply.completed') {
        if (typeof ev.text === 'string') text = ev.text;
        if (Array.isArray(ev.images)) {
          images = ev.images.filter((x): x is string => typeof x === 'string');
        }
        return { ok: true, text, images };
      }
      if (type === 'task.failed') {
        const code = typeof ev.code === 'string' ? ev.code : 'E_CONNECTOR_RUNTIME';
        const message = typeof ev.message === 'string' ? ev.message : '任务失败';
        return { ok: false, code, message };
      }
      if (type === 'task.timeout') {
        return { ok: false, code: 'E_TASK_TIMEOUT', message: '任务超时' };
      }
    }

    await sleep(interval);
  }

  return { ok: false, code: 'E_TASK_TIMEOUT', message: '等待回复超时' };
}
