/** 模型 / 能力 → billingSku 映射 — 请使用 observability/metering/resolveBillingSku */
export {
  resolveBillingSkuForGeminiModel,
  resolveBillingSkuForOpenAiModel,
  resolveBillingSkuForTripoTask,
  resolveBillingSkuForTencent3dTask,
  resolveBillingSkuForWorkflowVideo,
  resolveBillingSkuForJimeng,
  resolveProviderForGeminiPath,
  resolveBillingSkuFromRegistry,
  isLikelyImageRegistryId,
  isLikelyOpenAiRegistryId,
} from './observability/metering/resolveBillingSku';
