/**
 * P2-2 切片：本机引擎「注册表」——集中 id / 展示名 / 环境键 / 健康探测策略，
 * 由 `runtime-status` 的 `localEnginesStatus` 输出，避免每能力散落硬编码。
 * 新增引擎时：在 `LOCAL_ENGINES_REGISTRY` 追加条目，在 `buildRuntimeLocalEnginesStatus` 中为对应 `healthStrategy` 接线探测（Sam HTTP、rembg Python 等）。
 */

export type LocalEngineHealthStrategy =
  | 'companion_http_probe_sam'
  | 'companion_http_probe_paddleocr'
  | 'companion_python_probe_rembg'
  | 'none';

export type LocalEngineRegistryEntryV1 = {
  id: string;
  displayName: string;
  /** 主要配置入口（URL 或可执行路径类 env） */
  primaryEnvKey: string;
  healthStrategy: LocalEngineHealthStrategy;
  /** healthStrategy 为 none 时写入 runtime 的说明 */
  healthNoteWhenUnchecked?: string;
};

export const LOCAL_ENGINES_REGISTRY: readonly LocalEngineRegistryEntryV1[] = [
  {
    id: 'sam_segment',
    displayName: '本机分割（SamLocal）',
    primaryEnvKey: 'COMPANION_SAM_SEGMENT_URL',
    healthStrategy: 'companion_http_probe_sam',
  },
  {
    id: 'remove_bg',
    displayName: '去背景（Python rembg）',
    primaryEnvKey: 'COMPANION_REMBG_PYTHON',
    healthStrategy: 'companion_python_probe_rembg',
  },
  {
    id: 'paddle_ocr',
    displayName: 'OCR / 文档解析（PaddleOCR）',
    primaryEnvKey: 'COMPANION_PADDLEOCR_URL',
    healthStrategy: 'companion_http_probe_paddleocr',
  },
] as const;

export type RuntimeLocalEngineStatusV1 = {
  id: string;
  displayName: string;
  primaryEnvKey: string;
  healthStrategy: LocalEngineHealthStrategy;
  health: {
    checked: boolean;
    ok?: boolean;
    latencyMs?: number;
    code?: string;
    error?: string;
    note?: string;
  };
};

/** 与 `probeSamSegmentBackendHealth` 返回值兼容的最小形状（避免循环依赖） */
export type SamHttpProbeLike = {
  ok: boolean;
  code?: string;
  error?: string;
  samLocal?: { latencyMs?: number };
};

export type RembgProbeLike = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  code?: string;
};

export type PaddleOcrProbeLike = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  code?: string;
};

export type LocalEnginesProbesInput = {
  sam: SamHttpProbeLike;
  rembg: RembgProbeLike;
  paddleOcr: PaddleOcrProbeLike;
};

export function buildRuntimeLocalEnginesStatus(probes: LocalEnginesProbesInput): RuntimeLocalEngineStatusV1[] {
  return LOCAL_ENGINES_REGISTRY.map((e) => {
    if (e.healthStrategy === 'companion_http_probe_sam') {
      return {
        id: e.id,
        displayName: e.displayName,
        primaryEnvKey: e.primaryEnvKey,
        healthStrategy: e.healthStrategy,
        health: {
          checked: true,
          ok: probes.sam.ok,
          latencyMs: probes.sam.samLocal?.latencyMs,
          code: probes.sam.code,
          error: probes.sam.error,
        },
      };
    }
    if (e.healthStrategy === 'companion_python_probe_rembg') {
      return {
        id: e.id,
        displayName: e.displayName,
        primaryEnvKey: e.primaryEnvKey,
        healthStrategy: e.healthStrategy,
        health: {
          checked: true,
          ok: probes.rembg.ok,
          latencyMs: probes.rembg.latencyMs,
          code: probes.rembg.code,
          error: probes.rembg.error,
        },
      };
    }
    if (e.healthStrategy === 'companion_http_probe_paddleocr') {
      return {
        id: e.id,
        displayName: e.displayName,
        primaryEnvKey: e.primaryEnvKey,
        healthStrategy: e.healthStrategy,
        health: {
          checked: true,
          ok: probes.paddleOcr.ok,
          latencyMs: probes.paddleOcr.latencyMs,
          code: probes.paddleOcr.code,
          error: probes.paddleOcr.error,
        },
      };
    }
    const note = e.healthNoteWhenUnchecked?.trim();
    return {
      id: e.id,
      displayName: e.displayName,
      primaryEnvKey: e.primaryEnvKey,
      healthStrategy: e.healthStrategy,
      health: {
        checked: false,
        ...(note ? { note } : {}),
      },
    };
  });
}
