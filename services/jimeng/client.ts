/**
 * 即梦站内代理客户端 — 调 `/api/jimeng/*`（AK/SK 仅服务端）。
 * 业务请经 `unifiedAiGateway`；单测可注入 `fetchImpl`。
 */
import type { JimengPollResult, JimengSubmitInput } from "./types";
import { JimengNotConfiguredError } from "./errors";

export type JimengStatusResponse = {
  enabled: boolean;
  configured: boolean;
};

export type JimengClientOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

function resolveFetch(fetchImpl?: typeof fetch): typeof fetch {
  return fetchImpl ?? fetch;
}

function resolveApiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${p}`;
  }
  return p;
}

async function readJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`即梦 API 响应非 JSON（HTTP ${res.status}）`);
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function normalizePollResult(raw: unknown): JimengPollResult {
  if (!raw || typeof raw !== "object") {
    return { status: "pending" };
  }
  const obj = raw as Record<string, unknown>;
  const status = String(obj.status || "").trim().toLowerCase();
  if (status === "done") {
    const images = Array.isArray(obj.images)
      ? obj.images.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      : undefined;
    const videoUrl =
      typeof obj.videoUrl === "string" && obj.videoUrl.trim()
        ? obj.videoUrl.trim()
        : typeof obj.video_url === "string" && obj.video_url.trim()
          ? obj.video_url.trim()
          : undefined;
    return { status: "done", images, videoUrl, raw };
  }
  if (status === "failed" || status === "error") {
    const code = Number(obj.code ?? obj.errorCode ?? -1);
    const message =
      pickString(obj, ["message", "error", "detail"]) || "即梦任务失败";
    return { status: "failed", code: Number.isFinite(code) ? code : -1, message };
  }
  if (status === "running") {
    const progress = Number(obj.progress);
    return {
      status: "running",
      progress: Number.isFinite(progress) ? progress : undefined,
    };
  }
  return { status: "pending" };
}

/** GET /api/jimeng/status */
export async function fetchJimengStatus(options?: JimengClientOptions): Promise<JimengStatusResponse> {
  const fetchFn = resolveFetch(options?.fetchImpl);
  const res = await fetchFn(resolveApiUrl("/api/jimeng/status"), {
    method: "GET",
    cache: "no-store",
    signal: options?.signal,
    credentials: "include",
  });
  const body = (await readJsonResponse(res)) as Record<string, unknown>;
  if (!res.ok) {
    const msg = pickString(body, ["error", "message"]) || `HTTP ${res.status}`;
    throw new Error(`即梦状态查询失败：${msg}`);
  }
  return {
    enabled: Boolean(body.enabled),
    configured: Boolean(body.configured),
  };
}

function readViteJimengFlag(): boolean | null {
  try {
    const raw = String(
      ((import.meta as unknown as { env?: Record<string, string | undefined> }).env
        ?.VITE_JIMENG_API_ENABLED || ""
      ).trim()
    );
    if (!raw) return null;
    return raw === "1" || raw.toLowerCase() === "true";
  } catch {
    return null;
  }
}

/** 浏览器侧可用性：优先 status API，构建变量仅作辅助 */
export async function isJimengAvailable(options?: JimengClientOptions): Promise<boolean> {
  const viteFlag = readViteJimengFlag();
  if (viteFlag === false) return false;
  try {
    const status = await fetchJimengStatus(options);
    return Boolean(status.enabled && status.configured);
  } catch {
    return viteFlag === true;
  }
}

/** POST /api/jimeng/tasks */
export async function jimengSubmitTask(
  input: JimengSubmitInput,
  options?: JimengClientOptions
): Promise<{ taskId: string }> {
  const fetchFn = resolveFetch(options?.fetchImpl);
  const res = await fetchFn(resolveApiUrl("/api/jimeng/tasks"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    signal: options?.signal,
    credentials: "include",
  });
  const body = (await readJsonResponse(res)) as Record<string, unknown>;
  if (res.status === 503) {
    throw new JimengNotConfiguredError(
      pickString(body, ["error", "message"]) || "即梦 AI 未启用或未配置。"
    );
  }
  if (!res.ok) {
    const msg = pickString(body, ["error", "message", "detail"]) || `HTTP ${res.status}`;
    throw new Error(`即梦提交失败：${msg}`);
  }
  const taskId = pickString(body, ["taskId", "task_id"]);
  if (!taskId) throw new Error("即梦提交响应缺少 taskId");
  return { taskId };
}

/** GET /api/jimeng/tasks/:taskId */
export async function jimengPollTask(
  taskId: string,
  registryId: string,
  options?: JimengClientOptions
): Promise<JimengPollResult> {
  const fetchFn = resolveFetch(options?.fetchImpl);
  const q = new URLSearchParams({ registryId: String(registryId || "").trim() });
  const res = await fetchFn(
    resolveApiUrl(`/api/jimeng/tasks/${encodeURIComponent(taskId)}?${q}`),
    {
      method: "GET",
      cache: "no-store",
      signal: options?.signal,
      credentials: "include",
    }
  );
  const body = await readJsonResponse(res);
  if (res.status === 503) {
    const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    throw new JimengNotConfiguredError(
      pickString(obj, ["error", "message"]) || "即梦 AI 未启用或未配置。"
    );
  }
  if (!res.ok) {
    const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const msg = pickString(obj, ["error", "message", "detail"]) || `HTTP ${res.status}`;
    throw new Error(`即梦轮询失败：${msg}`);
  }
  return normalizePollResult(body);
}

