import { modelRegistryLog } from "./log";
import type { ModelOpsConfig } from "./opsTypes";
import type { DialogImageGear } from "./imageModels";
import { isRegisteredImageModelId } from "./imageModels";

const DEFAULT_GEAR_PREFERENCE: DialogImageGear[] = ["standard", "fast", "pro"];

export const DEFAULT_MODEL_OPS_CONFIG: ModelOpsConfig = {
  version: 1,
  imageRegistryAllowlist: null,
  gearPreference: DEFAULT_GEAR_PREFERENCE,
};

function readViteEnvTrim(key: string): string {
  try {
    return String(
      ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key] || "").trim()
    );
  } catch {
    return "";
  }
}

function normalizeOpsPayload(raw: unknown): ModelOpsConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MODEL_OPS_CONFIG };
  const o = raw as Record<string, unknown>;
  const version = typeof o.version === "number" && Number.isFinite(o.version) ? o.version : DEFAULT_MODEL_OPS_CONFIG.version;
  let imageRegistryAllowlist: string[] | null | undefined = undefined;
  if (o.imageRegistryAllowlist === null) imageRegistryAllowlist = null;
  else if (Array.isArray(o.imageRegistryAllowlist)) {
    const ids = o.imageRegistryAllowlist.filter((x): x is string => typeof x === "string").map((x) => x.trim());
    const known = ids.filter((id) => isRegisteredImageModelId(id));
    if (known.length === 0 && ids.length > 0) {
      modelRegistryLog("warn", "ops imageRegistryAllowlist had no known ids; ignoring allowlist");
      imageRegistryAllowlist = null;
    } else if (known.length === 0) {
      imageRegistryAllowlist = null;
    } else {
      imageRegistryAllowlist = known;
    }
  }
  let gearPreference: DialogImageGear[] | undefined;
  if (Array.isArray(o.gearPreference)) {
    const allowed = new Set(["fast", "standard", "pro"]);
    const gp = o.gearPreference.filter((x): x is DialogImageGear => typeof x === "string" && allowed.has(x));
    if (gp.length > 0) gearPreference = gp;
  }
  return {
    version,
    imageRegistryAllowlist,
    gearPreference: gearPreference ?? DEFAULT_MODEL_OPS_CONFIG.gearPreference,
  };
}

let cached: ModelOpsConfig = { ...DEFAULT_MODEL_OPS_CONFIG };
let inflight: Promise<ModelOpsConfig> | null = null;

/** 上次成功 GET 返回的校验元数据（用于条件请求；见 `refreshModelOpsConfig`） */
let lastOpsEtag: string | null = null;
let lastOpsLastModified: string | null = null;

/** 构建期 / 运维：`VITE_MODEL_OPS_CONFIG_URL`（便于排障或将来设置页展示） */
export function getModelOpsConfigUrl(): string {
  return readViteEnvTrim("VITE_MODEL_OPS_CONFIG_URL");
}

/**
 * 是否附带 `If-None-Match` / `If-Modified-Since`。
 * - 浏览器跨域时附加会触发 CORS 预检，许多静态 JSON 托管未放行 → **仅同源**时启用条件请求。
 * - Vitest/SSR 无 `window` 时视为可附加（由 `fetch` mock 验证行为）。
 */
function shouldAttachConditionalValidators(url: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const u = new URL(url, window.location.href);
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}

function conditionalRequestHeaders(url: string): Headers | undefined {
  if (!shouldAttachConditionalValidators(url)) return undefined;
  const h = new Headers();
  if (lastOpsEtag) h.set("If-None-Match", lastOpsEtag);
  else if (lastOpsLastModified) h.set("If-Modified-Since", lastOpsLastModified);
  return h.has("If-None-Match") || h.has("If-Modified-Since") ? h : undefined;
}

function captureValidatorsFromResponse(res: Response): void {
  const etag = res.headers.get("ETag")?.trim();
  lastOpsEtag = etag && etag.length > 0 ? etag : null;
  const lm = res.headers.get("Last-Modified")?.trim();
  lastOpsLastModified = lm && lm.length > 0 ? lm : null;
}

/** 单测：重置条件请求状态与并发锁（不改动 `cached`） */
export function _resetModelOpsRemoteStateForTests(): void {
  lastOpsEtag = null;
  lastOpsLastModified = null;
  inflight = null;
}

/** 同步视图（首帧与未设置远端 URL 时使用） */
export function getModelOpsConfigSync(): ModelOpsConfig {
  return cached;
}

export function dispatchModelOpsUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("ac-model-ops-updated"));
}

async function runFetchModelOps(url: string): Promise<ModelOpsConfig> {
  try {
    const reqInit: RequestInit = { cache: "no-store" };
    const cond = conditionalRequestHeaders(url);
    if (cond) reqInit.headers = cond;
    const res = await fetch(url, reqInit);
    if (res.status === 304) {
      modelRegistryLog("info", "ops config unchanged", "304 Not Modified");
      return cached;
    }
    if (!res.ok) {
      modelRegistryLog("warn", "ops fetch failed", `HTTP ${res.status} ${url}`);
      return cached;
    }
    captureValidatorsFromResponse(res);
    const json: unknown = await res.json();
    const next = normalizeOpsPayload(json);
    cached = next;
    modelRegistryLog("info", "ops config loaded", `version=${next.version}`);
    dispatchModelOpsUpdated();
    return cached;
  } catch (e) {
    modelRegistryLog("warn", "ops fetch error", e instanceof Error ? e.message : String(e));
    return cached;
  }
}

function startFetchModelOps(url: string): Promise<ModelOpsConfig> {
  if (inflight) return inflight;
  inflight = runFetchModelOps(url).finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * 拉取运营配置（`VITE_MODEL_OPS_CONFIG_URL` 指向可 CORS 的 JSON）。
 * 失败时保留上次缓存或默认，并打 `[model-registry]` 日志。
 *
 * **条件请求**：若上次 200 响应含 `ETag` / `Last-Modified`，下一次拉取会带 `If-None-Match` / `If-Modified-Since`；
 * 服务端可返回 **304**，此时不解析 body、不触发 `ac-model-ops-updated`。
 * 浏览器下**仅当运营 URL 与当前页同源**时附加上述请求头（跨域会触发 CORS 预检，许多静态托管未放行）。
 */
export async function refreshModelOpsConfig(): Promise<ModelOpsConfig> {
  const url = getModelOpsConfigUrl();
  if (!url) {
    cached = { ...DEFAULT_MODEL_OPS_CONFIG };
    lastOpsEtag = null;
    lastOpsLastModified = null;
    return cached;
  }
  return startFetchModelOps(url);
}

/**
 * 单测：对指定 URL 拉取（不读 `VITE_MODEL_OPS_CONFIG_URL`），与生产路径共用条件请求与解析逻辑。
 */
export async function _refreshModelOpsConfigAtUrlForTests(url: string): Promise<ModelOpsConfig> {
  const trimmed = (url || "").trim();
  if (!trimmed) {
    cached = { ...DEFAULT_MODEL_OPS_CONFIG };
    lastOpsEtag = null;
    lastOpsLastModified = null;
    return cached;
  }
  return startFetchModelOps(trimmed);
}

/** 测试或管理员工具：覆盖内存缓存 */
export function _setModelOpsConfigForTests(cfg: ModelOpsConfig): void {
  cached = normalizeOpsPayload(cfg);
  dispatchModelOpsUpdated();
}
