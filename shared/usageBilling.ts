/** 用量计费共享类型 — 前后端对齐 */

export type UsageMeterKind = 'token' | 'image' | 'second' | 'task' | 'byte';

export type UsageCostConfidence = 'exact' | 'estimated' | 'unknown';

export type UsageEventStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';

export type UsageGeminiMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

export type UsageEventInput = {
  idempotencyKey: string;
  provider: string;
  billingSku: string;
  meterKind: UsageMeterKind;
  quantity?: number;
  quantityIn?: number;
  quantityOut?: number;
  unit: string;
  registryId?: string;
  workspaceId?: string;
  projectId?: string;
  workflowStepId?: string;
  auditLogId?: string;
  upstreamTaskId?: string;
  requestId?: string;
  jobKind?: string;
  costUsdEst?: number | null;
  costConfidence?: UsageCostConfidence;
  creditsCharged?: number | null;
  status?: UsageEventStatus;
  meta?: Record<string, unknown>;
};

export type PriceCatalogEntry = {
  billingSku: string;
  meterKind: UsageMeterKind;
  inputPer1m?: number;
  /** 文本/推理类输出 token 单价（USD / 1M） */
  outputPer1m?: number;
  /** 生图 SKU 的图像输出 token 单价（USD / 1M）；缺省回退 outputPer1m */
  imageOutputPer1m?: number;
  perUnit?: number;
  /** Admin 运营档位；优先于 perUnit×CREDITS_PER_USD */
  userCreditsPerUnit?: number | null;
  vendorSkuRef?: string;
  displayName?: string;
  markupPct?: number;
};

export type UsageEventRow = UsageEventInput & {
  id: string;
  userId: string;
  createdAt: string;
};
