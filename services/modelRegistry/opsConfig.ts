import { modelRegistryLog } from "./log";
import { apiUrl } from "../apiBase";
import type { ModelOpsConfig } from "./opsTypes";
import type { SupplierId, WiringEdge } from "./hubGraph/types";
import {
  DEFAULT_IMAGE_MODEL_REGISTRY_ID,
  DIALOG_IMAGE_REGISTRY,
  isRegisteredImageModelId,
  LEGACY_IMAGE_GEAR_TO_REGISTRY,
} from "./imageModels";
import { getCanonicalModel } from "./canonicalModelCatalog";

type BindingFallbackPolicy = NonNullable<NonNullable<ModelOpsConfig["bindingOverrides"]>[number]["fallbackPolicy"]>;

const DEFAULT_IMAGE_MODEL_PREFERENCE: string[] = [
  DEFAULT_IMAGE_MODEL_REGISTRY_ID,
  ...DIALOG_IMAGE_REGISTRY.map((e) => e.registryId),
].filter((id, index, arr) => arr.indexOf(id) === index);

export const DEFAULT_MODEL_OPS_CONFIG: ModelOpsConfig = {
  version: 1,
  imageRegistryAllowlist: null,
  publishedCanonicalModelAllowlist: null,
  imageModelPreference: DEFAULT_IMAGE_MODEL_PREFERENCE,
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

const SUPPLIER_IDS = new Set<SupplierId>([
  "vertex-site",
  "toapis",
  "302ai",
  "aihubmix",
  "tinysnow",
  "vectorengine",
  "openai-official",
  "volcengine-ark",
  "gemini-aistudio",
]);

const FALLBACK_POLICIES = new Set([
  "none",
  "on_error",
  "on_rate_limit",
  "on_timeout",
  "on_provider_degraded",
  "cost_optimized",
  "quality_first",
]);
const isFallbackPolicy = (value: unknown): value is BindingFallbackPolicy =>
  typeof value === "string" && FALLBACK_POLICIES.has(value);
const ENDPOINT_MAPPING_METHODS = new Set(["GET", "POST"]);

function normalizeWiringEdges(raw: unknown): WiringEdge[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const edges: WiringEdge[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const edgeId = String(row.edgeId ?? "").trim();
    if (!edgeId) continue;
    const fromRaw = row.from;
    const toRaw = row.to;
    if (!fromRaw || typeof fromRaw !== "object" || !toRaw || typeof toRaw !== "object") continue;
    const from = fromRaw as Record<string, unknown>;
    const to = toRaw as Record<string, unknown>;
    const supplierId = String(from.supplierId ?? "").trim() as SupplierId;
    const outletId = String(from.outletId ?? "").trim();
    const hubInId = String(to.hubInId ?? "").trim();
    if (!SUPPLIER_IDS.has(supplierId) || !outletId || !hubInId) continue;
    const priority =
      typeof row.priority === "number" && Number.isFinite(row.priority) ? Math.floor(row.priority) : 10;
    const enabled = row.enabled === undefined ? undefined : row.enabled === true;
    const upstreamOverride =
      typeof row.upstreamOverride === "string" && row.upstreamOverride.trim()
        ? row.upstreamOverride.trim()
        : undefined;
    edges.push({
      edgeId,
      from: { supplierId, outletId },
      to: { hubInId },
      priority,
      enabled,
      upstreamOverride,
    });
  }
  return edges.length > 0 ? edges : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function cleanEndpointPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith("/")) return undefined;
  return trimmed;
}

function cleanProviderBaseUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}

function cleanProviderRequestTimeoutMs(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.max(1000, Math.min(900_000, Math.floor(n)));
}

function normalizeProviderOverrides(raw: unknown): ModelOpsConfig["providerOverrides"] {
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;
  const rows = raw
    .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
    .map((row) => {
      const providerId = typeof row.providerId === "string" ? row.providerId.trim() : "";
      if (!providerId) return null;
      const baseUrl = cleanProviderBaseUrl(row.baseUrl);
      const requestTimeoutMs = cleanProviderRequestTimeoutMs(row.requestTimeoutMs);
      return {
        providerId,
        ...(baseUrl ? { baseUrl } : {}),
        ...(requestTimeoutMs ? { requestTimeoutMs } : {}),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  return rows.length > 0 ? rows : null;
}

function normalizeEndpointMappings(raw: unknown): ModelOpsConfig["endpointMappings"] {
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;
  const rows = raw
    .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
    .map((row) => {
      const routeId = typeof row.routeId === "string" ? row.routeId.trim() : "";
      if (!routeId) return null;
      const methodRaw = typeof row.method === "string" ? row.method.trim().toUpperCase() : "";
      const method = ENDPOINT_MAPPING_METHODS.has(methodRaw) ? (methodRaw as "GET" | "POST") : undefined;
      const priority =
        typeof row.priority === "number" && Number.isFinite(row.priority) ? Math.floor(row.priority) : undefined;
      return {
        routeId,
        ...(method ? { method } : {}),
        ...(cleanEndpointPath(row.requestPath) ? { requestPath: cleanEndpointPath(row.requestPath) } : {}),
        ...(cleanEndpointPath(row.pollPath) ? { pollPath: cleanEndpointPath(row.pollPath) } : {}),
        ...(typeof row.statusPath === "string" && row.statusPath.trim() ? { statusPath: row.statusPath.trim() } : {}),
        ...(typeof row.artifactPath === "string" && row.artifactPath.trim() ? { artifactPath: row.artifactPath.trim() } : {}),
        ...(typeof row.taskIdPath === "string" && row.taskIdPath.trim() ? { taskIdPath: row.taskIdPath.trim() } : {}),
        ...(typeof row.errorPath === "string" && row.errorPath.trim() ? { errorPath: row.errorPath.trim() } : {}),
        ...(typeof row.statusValuePath === "string" && row.statusValuePath.trim()
          ? { statusValuePath: row.statusValuePath.trim() }
          : {}),
        ...(typeof row.artifactUrlPath === "string" && row.artifactUrlPath.trim()
          ? { artifactUrlPath: row.artifactUrlPath.trim() }
          : {}),
        ...(typeof row.upstreamOverride === "string" && row.upstreamOverride.trim()
          ? { upstreamOverride: row.upstreamOverride.trim() }
          : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(row.enabled !== undefined ? { enabled: row.enabled === true } : {}),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  return rows.length > 0 ? rows : null;
}

function normalizePublishedCanonicalAllowlist(raw: unknown): string[] | null | undefined {
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;
  const ids = uniqueStrings(raw.filter((x): x is string => typeof x === "string").map((x) => x.trim()));
  const known = ids.filter((id) => Boolean(getCanonicalModel(id)));
  if (known.length === 0 && ids.length > 0) {
    modelRegistryLog("warn", "ops publishedCanonicalModelAllowlist had no known ids; ignoring allowlist");
    return null;
  }
  if (known.length === 0) return null;
  return known;
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
  const publishedCanonicalModelAllowlist = normalizePublishedCanonicalAllowlist(
    o.publishedCanonicalModelAllowlist
  );
  let imageModelPreference: string[] | undefined;
  const rawPref = o.imageModelPreference ?? o.gearPreference;
  if (Array.isArray(rawPref)) {
    const gp = rawPref
      .filter((x): x is string => typeof x === "string")
      .map((x) => {
        const t = x.trim();
        if (isRegisteredImageModelId(t)) return t;
        return LEGACY_IMAGE_GEAR_TO_REGISTRY[t] ?? "";
      })
      .filter(Boolean);
    if (gp.length > 0) imageModelPreference = gp;
  }
  let bindingOverrides: ModelOpsConfig["bindingOverrides"] = undefined;
  if (Array.isArray(o.bindingOverrides)) {
    const rows = o.bindingOverrides
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
      .map((row) => {
        const bindingId = String(row.bindingId ?? "").trim();
        if (!bindingId) return null;
        const enabled = row.enabled === undefined ? undefined : row.enabled === true;
        const priority =
          typeof row.priority === "number" && Number.isFinite(row.priority) ? Math.floor(row.priority) : undefined;
        const fallbackMaxAttempts =
          typeof row.fallbackMaxAttempts === "number" && Number.isFinite(row.fallbackMaxAttempts)
            ? Math.max(1, Math.min(5, Math.floor(row.fallbackMaxAttempts)))
            : undefined;
        const upstreamOverride =
          typeof row.upstreamOverride === "string" && row.upstreamOverride.trim()
            ? row.upstreamOverride.trim()
            : undefined;
        const fallbackPolicy = isFallbackPolicy(row.fallbackPolicy) ? row.fallbackPolicy : undefined;
        return { bindingId, enabled, priority, fallbackPolicy, fallbackMaxAttempts, upstreamOverride };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    if (rows.length > 0) bindingOverrides = rows;
  }
  const wiringEdges = normalizeWiringEdges(o.wiringEdges);
  const providerOverrides = normalizeProviderOverrides(o.providerOverrides);
  const endpointMappings = normalizeEndpointMappings(o.endpointMappings);
  return {
    version,
    imageRegistryAllowlist,
    publishedCanonicalModelAllowlist,
    imageModelPreference: imageModelPreference ?? DEFAULT_MODEL_OPS_CONFIG.imageModelPreference,
    bindingOverrides,
    providerOverrides,
    endpointMappings,
    wiringEdges,
  };
}

let cached: ModelOpsConfig = { ...DEFAULT_MODEL_OPS_CONFIG };
let inflight: Promise<ModelOpsConfig> | null = null;

/** 上次成功 GET 返回的校验元数据（用于条件请求；见 `refreshModelOpsConfig`） */
let lastOpsEtag: string | null = null;
let lastOpsLastModified: string | null = null;

/** 构建期 / 运维：`VITE_MODEL_OPS_CONFIG_URL`（便于排障或将来设置页展示） */
export function getModelOpsConfigUrl(): string {
  return readViteEnvTrim("VITE_MODEL_OPS_CONFIG_URL") || apiUrl("/api/model-ops-config");
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
    const payload =
      json && typeof json === "object" && "config" in json ? (json as { config?: unknown }).config : json;
    const next = normalizeOpsPayload(payload);
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
