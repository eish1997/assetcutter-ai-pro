/** 即梦 SKU 模态 */
export type JimengModality = "image" | "video";

export type JimengAsyncMode = "submit_poll";

export type JimengVisibility = "warehouseOnly" | "vendor_extended";

/** §4.4 catalog 条目 */
export type JimengCatalogEntry = {
  registryId: string;
  label: string;
  modality: JimengModality;
  upstreamReqKey: string;
  docRef: string;
  verified: boolean;
  warehouseOnly: boolean;
  visibility?: JimengVisibility;
  asyncMode: JimengAsyncMode;
  maxReferenceImages?: number;
};

/** §4.4 提交输入 */
export type JimengSubmitInput = {
  registryId: string;
  prompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  /** URL 或 data URL；server 转 base64 */
  referenceImages?: string[];
  extra?: Record<string, unknown>;
};

/** §4.4 轮询结果 */
export type JimengPollResult =
  | { status: "pending" | "running"; progress?: number }
  | { status: "done"; images?: string[]; videoUrl?: string; raw: unknown }
  | { status: "failed"; code: number; message: string };

export type JimengParamsValidationError = {
  field: string;
  message: string;
};

export type JimengParamsValidationResult =
  | { ok: true }
  | { ok: false; errors: JimengParamsValidationError[] };

export function isJimengParamsValidationFailure(
  result: JimengParamsValidationResult
): result is { ok: false; errors: JimengParamsValidationError[] } {
  return result.ok === false;
}
