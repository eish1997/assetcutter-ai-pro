/**
 * B13: 用户可达路径 — BYOK / 工具级旁路审计表（机器可读）。
 * 规则权威仍是 `shared/billingRoute.ts` 的 resolveBillingRoute；本表供文档与防回归。
 */

export type AiGatewayByokPathAuditRow = {
  pathId: string;
  /** 用户/运营可见入口 */
  entry: string;
  jobKind: string;
  /** 默认（无 explicitByok）路由 */
  defaultRouteKind: 'platform' | 'byok' | 'exempt';
  /** BYOK 是否必须显式工具/参数 */
  byokOnlyWhenExplicit: boolean;
  /** 预检与结算是否同一套 resolveBillingRoute */
  precheckEqualsSettlement: true;
  notes: string;
};

/** Catalog `byokSupported` 仅表示「可接自备 Key」，不等于默认 BYOK。 */
export const BYOK_SUPPORTED_IS_NOT_DEFAULT_BYOK =
  'providerCatalog.byokSupported 是能力旗标，不翻转默认 platform 计费。';

/** workflowCreditsBypass 是「计划步骤全 BYOK 时跳过站点预扣」的派生，不是第二套路由表。 */
export const WORKFLOW_CREDITS_BYPASS_IS_DERIVED =
  'workflowCreditsBypass / proxyCreditsBypassed* 派生自 plan*Routes → requiresPlatformCredits，仍走 resolveBillingRoute。';

export const AI_GATEWAY_BYOK_PATH_AUDIT: readonly AiGatewayByokPathAuditRow[] = Object.freeze([
  {
    pathId: 'workflow.chat',
    entry: '工作流 · 对话 / 理解',
    jobKind: 'workflow_chat',
    defaultRouteKind: 'platform',
    byokOnlyWhenExplicit: true,
    precheckEqualsSettlement: true,
    notes: '默认 AI Gateway + 站点积分；explicitByok 才允许 BYOK channel pin',
  },
  {
    pathId: 'workflow.understand',
    entry: '工作流 · 图像理解',
    jobKind: 'workflow_understand',
    defaultRouteKind: 'platform',
    byokOnlyWhenExplicit: true,
    precheckEqualsSettlement: true,
    notes: '同 chat',
  },
  {
    pathId: 'workflow.text_to_image',
    entry: '工作流 · 文生图 / 统一生成',
    jobKind: 'workflow_text_to_image',
    defaultRouteKind: 'platform',
    byokOnlyWhenExplicit: true,
    precheckEqualsSettlement: true,
    notes: 'B3 后默认 createAiJob；本地 Gemini Key 不自动 BYOK',
  },
  {
    pathId: 'workflow.image_edit',
    entry: '工作流 · 图编辑',
    jobKind: 'workflow_image_edit',
    defaultRouteKind: 'platform',
    byokOnlyWhenExplicit: true,
    precheckEqualsSettlement: true,
    notes: '同文生图',
  },
  {
    pathId: 'workflow.jimeng_image',
    entry: '工作流 · 即梦出图',
    jobKind: 'workflow_jimeng_image',
    defaultRouteKind: 'platform',
    byokOnlyWhenExplicit: true,
    precheckEqualsSettlement: true,
    notes: 'ALWAYS_PLATFORM；Gateway-only jimeng-visual（无 legacy 旁路）',
  },
  {
    pathId: 'workflow.jimeng_video',
    entry: '工作流 · 即梦视频',
    jobKind: 'workflow_jimeng_video',
    defaultRouteKind: 'platform',
    byokOnlyWhenExplicit: true,
    precheckEqualsSettlement: true,
    notes: 'ALWAYS_PLATFORM；Gateway-only jimeng-visual',
  },
  {
    pathId: 'workflow.generate_video',
    entry: '工作流 · 视频任务',
    jobKind: 'workflow_generate_video',
    defaultRouteKind: 'platform',
    byokOnlyWhenExplicit: true,
    precheckEqualsSettlement: true,
    notes: 'ALWAYS_PLATFORM',
  },
  {
    pathId: 'workflow.generate_3d.platform',
    entry: '工作流 · 3D（Tripo / 腾讯混元）默认',
    jobKind: 'workflow_generate_3d',
    defaultRouteKind: 'platform',
    byokOnlyWhenExplicit: true,
    precheckEqualsSettlement: true,
    notes: '本机 Tripo Key / 腾讯 session 凭证默认不翻 BYOK（A6）',
  },
  {
    pathId: 'workflow.generate_3d.explicit_byok',
    entry: '显式自备 Key · 3D 工具',
    jobKind: 'workflow_generate_3d',
    defaultRouteKind: 'byok',
    byokOnlyWhenExplicit: true,
    precheckEqualsSettlement: true,
    notes: '仅 explicitByok=true 且有对应凭证时 BYOK',
  },
  {
    pathId: 'tool.explicit_byok_channel',
    entry: '显式自备 Key 工具（Gemini/OpenAI 兼容 channel）',
    jobKind: 'workflow_chat',
    defaultRouteKind: 'byok',
    byokOnlyWhenExplicit: true,
    precheckEqualsSettlement: true,
    notes: '调用方必须传 explicitByok；BYOK_CHANNELS  alone 不够',
  },
  {
    pathId: 'admin.byok_supported_flag',
    entry: '管理后台 · 供应商 byokSupported 列',
    jobKind: 'n/a',
    defaultRouteKind: 'platform',
    byokOnlyWhenExplicit: true,
    precheckEqualsSettlement: true,
    notes: BYOK_SUPPORTED_IS_NOT_DEFAULT_BYOK,
  },
  {
    pathId: 'workflow.credits_bypass_helper',
    entry: 'proxyCreditsBypassed* / workflowCreditsBypass',
    jobKind: 'n/a',
    defaultRouteKind: 'platform',
    byokOnlyWhenExplicit: true,
    precheckEqualsSettlement: true,
    notes: WORKFLOW_CREDITS_BYPASS_IS_DERIVED,
  },
]);

export function listAiGatewayByokPathAudit(): AiGatewayByokPathAuditRow[] {
  return [...AI_GATEWAY_BYOK_PATH_AUDIT];
}

export function listPlatformDefaultJobKindsFromAudit(): string[] {
  return AI_GATEWAY_BYOK_PATH_AUDIT.filter(
    (row) => row.defaultRouteKind === 'platform' && row.jobKind !== 'n/a'
  ).map((row) => row.jobKind);
}
