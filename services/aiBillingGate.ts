/**
 * 工作流 / 能力执行统一 AI 积分规划与准入（L1）。
 */
import type { CapabilitySet, CustomAppModule } from '../types';
import {
  creditsBalanceLoadingMessage,
  creditsBalanceUnavailableMessage,
  creditsExceededUserMessage,
  fmtCredits,
  CREDITS_EXCEEDED_CODE,
  LOGIN_REQUIRED_CODE,
  platformAiLoginRequiredMessage,
  proxyGateJobKindForWorkflowBranch,
  proxyGateMinCreditsForJob,
} from '../shared/credits';
import { assertCreditBalanceAtLeast, prechargePlatformCredits } from './creditsApi';
import { getGeminiFairnessUserId } from './geminiFairnessBridge';
import { HttpRequestError } from './httpClient';
import { DEFAULT_MODEL_TEXT } from './modelRegistry/constants';
import { coerceImageModelRegistryId, resolveImageModelRegistryId } from './modelRegistry/imageModels';
import { coerceTextModelRegistryId } from './modelRegistry/textModels';
import { pickBinding } from './modelRegistry/pickBinding';
import type { ChannelId } from './modelRegistry/types';
import { isPlatformMeteredGeminiPath, isPlatformMeteredJobKind } from './platformAiPath';
import { classifyWorkflowRunTaskBranch } from './workflowRunTaskBranch';

export type CapabilityCreditOverrides = {
  overrideImageModelRegistryId?: string | null;
  overrideImageGear?: string | null;
  overrideTextModelRegistryId?: string | null;
  overrideSkipUnderstand?: boolean;
};

export type AiBillingRouteKind = 'platform' | 'byok' | 'exempt';

export type AiBillingRouteStep = {
  registryId: string;
  role: 'text' | 'image';
  channel?: ChannelId;
  jobKind: string;
  minCredits: number;
  kind: AiBillingRouteKind;
};

export function creditOverridesFromTaskLike(
  src: CapabilityCreditOverrides | null | undefined
): CapabilityCreditOverrides | undefined {
  if (!src) return undefined;
  const has =
    Boolean(src.overrideImageModelRegistryId || src.overrideImageGear) ||
    Boolean(src.overrideTextModelRegistryId) ||
    typeof src.overrideSkipUnderstand === 'boolean';
  return has ? src : undefined;
}

function routeKindForRegistry(registryId: string, role: 'text' | 'image'): AiBillingRouteKind {
  return isPlatformMeteredGeminiPath(registryId, role) ? 'platform' : 'byok';
}

function routeKindForJobKind(jobKind: string): AiBillingRouteKind {
  return isPlatformMeteredJobKind(jobKind) ? 'platform' : 'exempt';
}

function billingStep(
  jobKind: string,
  kind: AiBillingRouteKind,
  extra: { registryId: string; role: 'text' | 'image'; channel?: ChannelId }
): AiBillingRouteStep {
  return {
    jobKind,
    kind,
    minCredits: kind === 'platform' ? proxyGateMinCreditsForJob(jobKind) : 0,
    registryId: extra.registryId,
    role: extra.role,
    channel: extra.channel,
  };
}

function billingStepForJobKind(jobKind: string, kind: AiBillingRouteKind): AiBillingRouteStep {
  return {
    jobKind,
    kind,
    minCredits: kind === 'platform' ? proxyGateMinCreditsForJob(jobKind) : 0,
    registryId: jobKind,
    role: 'text',
  };
}

function effectiveTextRegistryId(module: CustomAppModule, ov?: CapabilityCreditOverrides): string {
  const raw = ov?.overrideTextModelRegistryId ?? module.textModelRegistryId ?? DEFAULT_MODEL_TEXT;
  return coerceTextModelRegistryId(String(raw || DEFAULT_MODEL_TEXT));
}

function effectiveImageRegistryId(module: CustomAppModule, ov?: CapabilityCreditOverrides): string {
  const raw =
    ov?.overrideImageModelRegistryId ??
    ov?.overrideImageGear ??
    module.imageModelRegistryId ??
    module.imageGear;
  return resolveImageModelRegistryId(coerceImageModelRegistryId(raw ?? undefined));
}

function effectiveSkipUnderstand(module: CustomAppModule, ov?: CapabilityCreditOverrides): boolean {
  if (typeof ov?.overrideSkipUnderstand === 'boolean') return ov.overrideSkipUnderstand;
  return module.skipUnderstand === true;
}

function capabilityTextRegistryId(module: CustomAppModule): string {
  return String(module.textModelRegistryId || DEFAULT_MODEL_TEXT).trim() || DEFAULT_MODEL_TEXT;
}

function capabilityImageRegistryId(module: Pick<CustomAppModule, 'imageModelRegistryId' | 'imageGear'>): string {
  return resolveImageModelRegistryId(module.imageModelRegistryId ?? module.imageGear ?? undefined);
}

function capabilityEngineKind(preset: CustomAppModule): 'gen_image' | 'gen_text' | 'builtin' {
  const cat = preset.category;
  if (cat === 'image_to_image' && (preset.engine === 'gen_image' || preset.engine === 'gen_text')) {
    return preset.engine;
  }
  if (preset.engine) return preset.engine;
  if (cat === 'text_to_text' || cat === 'image_to_text') return 'gen_text';
  if (cat === 'text_to_image' || cat === 'image_to_image') return 'gen_image';
  if (cat === 'generate_3d' || cat === 'generate_video') return 'builtin';
  return 'builtin';
}

export function resolveJobKindBillingStep(jobKind: string, registryId?: string): AiBillingRouteStep {
  const jk = String(jobKind || 'workflow_chat').trim() || 'workflow_chat';
  if (registryId?.trim()) {
    const role: 'text' | 'image' =
      jk.includes('image') || jk.includes('video') || jk.includes('digital') ? 'image' : 'text';
    return resolveRegistryBillingStep({ registryId: registryId.trim(), role, jobKind: jk });
  }
  return billingStepForJobKind(jk, routeKindForJobKind(jk));
}

export function resolveRegistryBillingStep(params: {
  registryId: string;
  role: 'text' | 'image';
  jobKind: string;
}): AiBillingRouteStep {
  const role = params.role;
  const registryId = String(params.registryId || '').trim();
  const jobKind = String(params.jobKind || (role === 'image' ? 'workflow_text_to_image' : 'workflow_chat')).trim();
  const picked = pickBinding(registryId, role);
  const channel = picked?.channel;
  const kind = routeKindForRegistry(registryId, role);
  return billingStep(jobKind, kind, { registryId, role, channel });
}

export function planCapabilityModuleRoutes(
  module: CustomAppModule,
  overrides?: CapabilityCreditOverrides
): AiBillingRouteStep[] {
  const ov = creditOverridesFromTaskLike(overrides);
  const engine = capabilityEngineKind(module);
  if (engine === 'gen_image') {
    const steps: AiBillingRouteStep[] = [];
    if (!effectiveSkipUnderstand(module, ov)) {
      const textId = effectiveTextRegistryId(module, ov);
      steps.push(
        billingStep('workflow_understand', routeKindForRegistry(textId, 'text'), {
          registryId: textId,
          role: 'text',
        })
      );
    }
    const imageId = effectiveImageRegistryId(module, ov);
    steps.push(
      billingStep('workflow_text_to_image', routeKindForRegistry(imageId, 'image'), {
        registryId: imageId,
        role: 'image',
      })
    );
    return steps;
  }
  if (engine === 'gen_text') {
    const textId = effectiveTextRegistryId(module, ov);
    const jk = proxyGateJobKindForWorkflowBranch('branch_preset_execute_capability', module);
    return [
      billingStep(jk, routeKindForRegistry(textId, 'text'), {
        registryId: textId,
        role: 'text',
      }),
    ];
  }
  const cat = String(module.category || '').trim();
  if (cat === 'generate_3d') {
    return [resolveJobKindBillingStep('workflow_generate_3d')];
  }
  if (cat === 'generate_video') {
    return [billingStepForJobKind('workflow_generate_video', 'platform')];
  }
  return [];
}

export function planCapabilitySetRoutes(set: CapabilitySet, presets: CustomAppModule[]): AiBillingRouteStep[] {
  const steps: AiBillingRouteStep[] = [];
  for (const node of set.nodes) {
    if (node.type === 'textGen') {
      steps.push(
        resolveRegistryBillingStep({
          registryId: DEFAULT_MODEL_TEXT,
          role: 'text',
          jobKind: 'workflow_chat',
        })
      );
      continue;
    }
    if (node.type !== 'preset' || !node.data.presetId) continue;
    const preset = presets.find((p) => p.id === node.data.presetId);
    if (!preset) continue;
    const engine = capabilityEngineKind(preset);
    if (engine !== 'gen_image' && engine !== 'gen_text') continue;
    steps.push(...planCapabilityModuleRoutes(preset));
  }
  return steps;
}

export function planWorkflowActionRoutes(
  actionType: string,
  module: CustomAppModule | null,
  opts?: {
    capabilitySet?: CapabilitySet | null;
    presets?: CustomAppModule[];
    overrides?: CapabilityCreditOverrides;
  }
): AiBillingRouteStep[] {
  const branch = classifyWorkflowRunTaskBranch({ actionType, module });
  if (branch === 'branch_capability_set') {
    const set = opts?.capabilitySet;
    if (!set) return [];
    return planCapabilitySetRoutes(set, opts?.presets ?? []);
  }
  if (branch === 'branch_generate_3d') {
    return [resolveJobKindBillingStep('workflow_generate_3d')];
  }
  if (branch === 'branch_preset_execute_capability' && module) {
    return planCapabilityModuleRoutes(module, opts?.overrides);
  }
  return [];
}

export function planQuickComposeRoutes(params: {
  mode: 'text' | 'image' | '3d';
  promptCards: ReadonlyArray<{ presetId: string }>;
  resolveModule: (presetId: string) => CustomAppModule | null | undefined;
  imageModelRegistryId?: string | null;
  textModelRegistryId?: string | null;
}): AiBillingRouteStep[] {
  if (params.promptCards.length === 0) {
    if (params.mode === '3d') return [resolveJobKindBillingStep('workflow_generate_3d')];
    if (params.mode === 'image') {
      const imageId = resolveImageModelRegistryId(
        coerceImageModelRegistryId(params.imageModelRegistryId ?? undefined)
      );
      return [
        resolveRegistryBillingStep({
          registryId: imageId,
          role: 'image',
          jobKind: 'workflow_text_to_image',
        }),
      ];
    }
    const textId = coerceTextModelRegistryId(
      String(params.textModelRegistryId || DEFAULT_MODEL_TEXT).trim() || DEFAULT_MODEL_TEXT
    );
    return [
      resolveRegistryBillingStep({
        registryId: textId,
        role: 'text',
        jobKind: 'workflow_chat',
      }),
    ];
  }
  const steps: AiBillingRouteStep[] = [];
  for (const card of params.promptCards) {
    const mod = params.resolveModule(card.presetId);
    if (!mod) continue;
    steps.push(...planWorkflowActionRoutes(mod.id, mod));
  }
  return steps;
}

export function requiresPlatformCredits(steps: AiBillingRouteStep[]): boolean {
  return steps.some((s) => s.kind === 'platform');
}

export function sumPlatformMinCredits(steps: AiBillingRouteStep[]): number {
  return steps
    .filter((s) => s.kind === 'platform')
    .reduce((sum, s) => sum + Math.max(0, s.minCredits), 0);
}

export function fmtPlanGateEstimate(steps: AiBillingRouteStep[]): string {
  const n = sumPlatformMinCredits(steps);
  if (n <= 0) return '';
  return `约 ${fmtCredits(n)} 积分起`;
}

function stepBillingLabel(step: AiBillingRouteStep): string {
  const jk = step.jobKind;
  if (jk === 'workflow_understand') return '理解';
  if (jk === 'workflow_text_to_image' || jk === 'workflow_image_edit') return '生图';
  if (jk === 'workflow_generate_3d') return '3D';
  if (jk === 'workflow_generate_video') return '生视频';
  if (jk === 'workflow_chat') return '对话';
  return '执行';
}

/** 分步计费明细（UI 策略 B：只读展示，不预扣） */
export function fmtPlanStepsBreakdown(steps: AiBillingRouteStep[]): string[] {
  return steps.map((step) => {
    const label = stepBillingLabel(step);
    if (step.kind === 'platform') {
      return `${label} — 约 ${fmtCredits(step.minCredits)} 积分`;
    }
    if (step.kind === 'byok') {
      return `${label} — 自备 Key · 不扣积分`;
    }
    return `${label} — 不计费`;
  });
}

export type UsageQuoteStepLike = {
  jobKind: string;
  minCredits: number;
  label?: string;
};

/** 用服务端 /api/usage/quote 结果覆盖 platform 步骤 minCredits（Admin 改价后 UI 对齐）。 */
export function fmtPlanStepsBreakdownWithQuote(
  steps: AiBillingRouteStep[],
  quote?: { steps?: UsageQuoteStepLike[] } | null
): string[] {
  const quoteMap = new Map((quote?.steps ?? []).map((s) => [s.jobKind, s]));
  return steps.map((step) => {
    const label = stepBillingLabel(step);
    if (step.kind === 'platform') {
      const q = quoteMap.get(step.jobKind);
      const min = q?.minCredits ?? step.minCredits;
      return `${label} — 约 ${fmtCredits(min)} 积分`;
    }
    if (step.kind === 'byok') {
      return `${label} — 自备 Key · 不扣积分`;
    }
    return `${label} — 不计费`;
  });
}

export function sumPlatformMinCreditsWithQuote(
  steps: AiBillingRouteStep[],
  quote?: { steps?: UsageQuoteStepLike[] } | null
): number {
  const quoteMap = new Map((quote?.steps ?? []).map((s) => [s.jobKind, s]));
  return steps
    .filter((s) => s.kind === 'platform')
    .reduce((sum, step) => {
      const q = quoteMap.get(step.jobKind);
      return sum + Math.max(0, q?.minCredits ?? step.minCredits);
    }, 0);
}

export function fmtCreditsEstimateFooterWithQuote(
  steps: AiBillingRouteStep[],
  balance?: number | null,
  quote?: { steps?: UsageQuoteStepLike[] } | null
): { totalMin: number; shortfall: number; lines: string[] } {
  const lines = fmtPlanStepsBreakdownWithQuote(steps, quote);
  const totalMin = sumPlatformMinCreditsWithQuote(steps, quote);
  let shortfall = 0;
  if (balance != null && Number.isFinite(balance) && totalMin > 0 && balance < totalMin) {
    shortfall = totalMin - balance;
  }
  return { totalMin, shortfall, lines };
}

export function fmtCreditsEstimateFooter(
  steps: AiBillingRouteStep[],
  balance?: number | null
): { totalMin: number; shortfall: number; lines: string[] } {
  const lines = fmtPlanStepsBreakdown(steps);
  const totalMin = sumPlatformMinCredits(steps);
  let shortfall = 0;
  if (balance != null && Number.isFinite(balance) && totalMin > 0 && balance < totalMin) {
    shortfall = Math.max(1, Math.ceil(totalMin - balance));
  }
  return { totalMin, shortfall, lines };
}

export function isSubmitBlockedForPlatformPlan(
  steps: AiBillingRouteStep[],
  userId: string | null | undefined,
  balance: number | null,
  loading: boolean,
  opts?: { minCreditsOverride?: number | null }
): { blocked: boolean; reason?: string; estimatedMinCredits?: number } {
  const clientMin = sumPlatformMinCredits(steps);
  const override = opts?.minCreditsOverride;
  const min =
    override != null && Number.isFinite(override) && override >= 0
      ? Math.max(0, Math.floor(override))
      : clientMin;
  if (!requiresPlatformCredits(steps)) {
    return { blocked: false, estimatedMinCredits: 0 };
  }
  if (!userId?.trim()) {
    return { blocked: true, reason: platformAiLoginRequiredMessage(), estimatedMinCredits: min };
  }
  if (loading && balance == null) {
    return { blocked: true, reason: creditsBalanceLoadingMessage(), estimatedMinCredits: min };
  }
  if (balance == null) {
    return { blocked: true, reason: creditsBalanceUnavailableMessage(), estimatedMinCredits: min };
  }
  if (balance < min) {
    return { blocked: true, reason: creditsExceededUserMessage(balance, min), estimatedMinCredits: min };
  }
  return { blocked: false, estimatedMinCredits: min };
}

function resolvePlatformUserId(userId?: string | null): string {
  return String(userId ?? getGeminiFairnessUserId() ?? '').trim();
}

function maxPlatformStepMin(steps: AiBillingRouteStep[]): number {
  let max = 1;
  for (const s of steps) {
    if (s.kind !== 'platform') continue;
    max = Math.max(max, s.minCredits);
  }
  return max;
}

/**
 * 执行层单步 reserve（经 unifiedAiGateway / proxyCreditsGate）。
 * UI 入队须只用 {@link isSubmitBlockedForPlatformPlan}，勿传任务级 precharge。
 */
export async function assertAiGateForSteps(
  steps: AiBillingRouteStep[],
  opts?: {
    scopeKey?: string | null;
    userId?: string | null;
  }
): Promise<void> {
  if (!requiresPlatformCredits(steps)) return;
  if (!resolvePlatformUserId(opts?.userId)) {
    throw new HttpRequestError(platformAiLoginRequiredMessage(), 401, LOGIN_REQUIRED_CODE);
  }

  const maxStepMin = maxPlatformStepMin(steps);
  const scopeKey = String(opts?.scopeKey ?? '').trim() || undefined;

  if (steps.length === 1 && steps[0]?.kind === 'platform') {
    await prechargePlatformCredits(maxStepMin, scopeKey);
    return;
  }

  if (scopeKey) {
    await prechargePlatformCredits(maxStepMin, scopeKey);
    return;
  }

  const amount = Math.max(1, sumPlatformMinCredits(steps));
  await assertCreditBalanceAtLeast(amount);
}

export async function assertAiGateForRegistry(
  registryId: string,
  role: 'text' | 'image',
  jobKind: string,
  scopeKey?: string | null
): Promise<void> {
  const step = resolveRegistryBillingStep({ registryId, role, jobKind });
  if (step.kind !== 'platform') return;
  await assertAiGateForSteps([step], { scopeKey });
}
