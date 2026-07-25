/**
 * 工作流生视频类型与历史 HTTP 桥实现。
 * **用户可达路径已统一 AI Gateway Job**（`aiGatewayVideoExecution`）；
 * `requestWorkflowVideoFromEnv` / `VITE_WORKFLOW_VIDEO_API_URL` 仅保留兼容/单测，业务勿再调用。
 */

function readViteEnvTrim(key: string): string {
  try {
    return String(
      ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key] || "").trim()
    );
  } catch {
    return "";
  }
}

export type WorkflowVideoJobInput = {
  prompt: string;
  referenceImages?: string[];
  registryId?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  resolution?: string;
  motionStrength?: number;
};

/** `videoUrl` 可为 `https:` 地址或 `data:video/...;base64,...` */
export type WorkflowVideoJobResult = {
  videoUrl: string;
  mimeType?: string;
  providerId?: string;
};

/** 供应商未就绪或未配置桥 URL 时抛出 */
export class WorkflowVideoNotAvailableError extends Error {
  readonly code = "WORKFLOW_VIDEO_NOT_AVAILABLE" as const;
  constructor(message = "生视频未启用：请确认 AI Gateway 视频路由与供应商 Key 已配置。") {
    super(message);
    this.name = "WorkflowVideoNotAvailableError";
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * 调用已配置的桥接端点（单测可注入 `fetchImpl`）。
 * 期望 JSON：`videoUrl` | `url` | `videoDataUrl` | `dataUrl`，或 `videoBase64` + `mimeType`。
 */
export async function requestWorkflowVideoWithEndpoint(
  endpoint: string,
  input: WorkflowVideoJobInput,
  options?: { fetchImpl?: typeof fetch }
): Promise<WorkflowVideoJobResult> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const res = await fetchFn(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: (input.prompt || "").trim(),
      referenceImages: (input.referenceImages ?? []).filter((s) => typeof s === "string" && s.trim()),
      registryId: typeof input.registryId === "string" && input.registryId.trim() ? input.registryId.trim() : undefined,
      durationSeconds: Number.isFinite(input.durationSeconds) ? input.durationSeconds : undefined,
      aspectRatio: typeof input.aspectRatio === "string" && input.aspectRatio.trim() ? input.aspectRatio.trim() : undefined,
      resolution: typeof input.resolution === "string" && input.resolution.trim() ? input.resolution.trim() : undefined,
      motionStrength: Number.isFinite(input.motionStrength) ? input.motionStrength : undefined,
    }),
    cache: "no-store",
  });

  const text = await res.text();
  let j: unknown;
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`工作流生视频：响应非 JSON（HTTP ${res.status}）`);
  }
  const obj = j && typeof j === "object" ? (j as Record<string, unknown>) : {};

  if (!res.ok) {
    const msg =
      pickString(obj, ["error", "message", "detail"]) || `HTTP ${res.status}`;
    throw new Error(`工作流生视频：${msg}`);
  }

  const videoUrl = pickString(obj, ["videoUrl", "url", "video_uri", "videoUri"]);
  const videoDataUrl = pickString(obj, ["videoDataUrl", "dataUrl"]);
  const mimeType = pickString(obj, ["mimeType", "mime_type"]);
  const base64 = pickString(obj, ["videoBase64", "base64"]);

  if (videoDataUrl?.startsWith("data:")) {
    return { videoUrl: videoDataUrl, mimeType: mimeType || undefined };
  }
  if (videoUrl) {
    return { videoUrl, mimeType: mimeType || undefined };
  }
  if (base64 && mimeType) {
    return { videoUrl: `data:${mimeType};base64,${base64}`, mimeType };
  }
  if (base64) {
    return { videoUrl: `data:video/mp4;base64,${base64}`, mimeType: "video/mp4" };
  }

  throw new Error("工作流生视频：响应缺少 videoUrl / videoDataUrl / videoBase64");
}

export function isWorkflowVideoBridgeConfigured(): boolean {
  return readViteEnvTrim("VITE_WORKFLOW_VIDEO_API_URL").length > 0;
}

export async function requestWorkflowVideoFromEnv(input: WorkflowVideoJobInput): Promise<WorkflowVideoJobResult> {
  const endpoint = readViteEnvTrim("VITE_WORKFLOW_VIDEO_API_URL");
  if (!endpoint) throw new WorkflowVideoNotAvailableError();
  return requestWorkflowVideoWithEndpoint(endpoint, input);
}
