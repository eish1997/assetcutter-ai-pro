/**
 * 即梦 Submit + Poll 适配器（§4.6 默认轮询策略）。
 * 仅 unifiedAiGateway / 单测引用。
 */
import { getJimengCatalogEntry } from "./catalog";
import {
  jimengPollTask,
  jimengSubmitTask,
  type JimengClientOptions,
} from "./client";
import { JimengPollTimeoutError, JimengUpstreamRejectedError } from "./errors";
import type { JimengModality, JimengSubmitInput } from "./types";

/** §4.6 默认轮询参数 */
export const JIMENG_DEFAULT_POLL_INTERVAL_MS = 2000;
export const JIMENG_DEFAULT_POLL_INTERVAL_MAX_MS = 10000;
export const JIMENG_DEFAULT_POLL_BACKOFF_FACTOR = 1.5;
export const JIMENG_DEFAULT_MAX_WAIT_IMAGE_MS = 180_000;
export const JIMENG_DEFAULT_MAX_WAIT_VIDEO_MS = 600_000;

export type JimengPollStrategy = {
  pollIntervalMs?: number;
  pollIntervalMaxMs?: number;
  pollBackoffFactor?: number;
  maxWaitMs?: number;
};

export type JimengAdapterOptions = JimengClientOptions & JimengPollStrategy;

export type JimengImageJobResult = {
  taskId: string;
  images: string[];
  raw: unknown;
};

export type JimengVideoJobResult = {
  taskId: string;
  videoUrl: string;
  raw: unknown;
};

function resolveMaxWaitMs(modality: JimengModality, override?: number): number {
  if (override != null && Number.isFinite(override) && override > 0) return override;
  if (modality === "video") return JIMENG_DEFAULT_MAX_WAIT_VIDEO_MS;
  return JIMENG_DEFAULT_MAX_WAIT_IMAGE_MS;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function pollJimengUntilDone(
  taskId: string,
  registryId: string,
  modality: JimengModality,
  options?: JimengAdapterOptions
): Promise<{ images?: string[]; videoUrl?: string; raw: unknown }> {
  const started = Date.now();
  const maxWaitMs = resolveMaxWaitMs(modality, options?.maxWaitMs);
  const maxInterval = options?.pollIntervalMaxMs ?? JIMENG_DEFAULT_POLL_INTERVAL_MAX_MS;
  const backoff = options?.pollBackoffFactor ?? JIMENG_DEFAULT_POLL_BACKOFF_FACTOR;
  let interval = options?.pollIntervalMs ?? JIMENG_DEFAULT_POLL_INTERVAL_MS;

  while (true) {
    if (options?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (Date.now() - started > maxWaitMs) {
      throw new JimengPollTimeoutError(undefined, taskId, registryId);
    }

    const polled = await jimengPollTask(taskId, registryId, options);
    if (polled.status === "done") {
      return {
        images: polled.images,
        videoUrl: polled.videoUrl,
        raw: polled.raw,
      };
    }
    if (polled.status === "failed") {
      throw new JimengUpstreamRejectedError(
        polled.message,
        polled.code,
        registryId,
        taskId
      );
    }

    await sleep(interval, options?.signal);
    interval = Math.min(Math.round(interval * backoff), maxInterval);
  }
}

export async function submitAndPollJimengImage(
  input: JimengSubmitInput,
  options?: JimengAdapterOptions
): Promise<JimengImageJobResult> {
  const entry = getJimengCatalogEntry(input.registryId);
  if (!entry || entry.modality !== "image") {
    throw new Error(`未知即梦图类 SKU：${input.registryId}`);
  }
  const { taskId } = await jimengSubmitTask(input, options);
  const done = await pollJimengUntilDone(taskId, input.registryId, "image", options);
  const images = (done.images ?? []).filter((u) => typeof u === "string" && u.trim());
  if (images.length === 0) {
    throw new JimengUpstreamRejectedError("即梦图类任务完成但无 image_urls", 10001, input.registryId, taskId);
  }
  return { taskId, images, raw: done.raw };
}

export async function submitAndPollJimengVideo(
  input: JimengSubmitInput,
  options?: JimengAdapterOptions
): Promise<JimengVideoJobResult> {
  const entry = getJimengCatalogEntry(input.registryId);
  if (!entry || entry.modality !== "video") {
    throw new Error(`未知即梦视频 SKU：${input.registryId}`);
  }
  const { taskId } = await jimengSubmitTask(input, options);
  const done = await pollJimengUntilDone(taskId, input.registryId, "video", options);
  const videoUrl = String(done.videoUrl || "").trim();
  if (!videoUrl) {
    throw new JimengUpstreamRejectedError("即梦视频任务完成但无 video_url", 10001, input.registryId, taskId);
  }
  return { taskId, videoUrl, raw: done.raw };
}
