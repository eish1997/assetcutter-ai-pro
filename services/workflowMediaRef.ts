/**
 * Companion key helpers for Locator / open-folder (not a full MediaRef persistence spine).
 * Runtime preview URLs (blob/data/http) must never be treated as durable truth.
 */

import type { WorkflowAsset } from '../types';
import { resolveWorkflowStepModelCompanionKeys } from './workflowStepModels';

export type WorkflowMediaKind = 'original' | 'result' | 'model' | 'preview';

/** Collect durable local companion keys currently projected on a WorkflowAsset. */
export function collectWorkflowAssetCompanionKeys(asset: WorkflowAsset): Array<{
  kind: WorkflowMediaKind;
  variantId: string;
  slot?: number;
  key: string;
}> {
  const out: Array<{ kind: WorkflowMediaKind; variantId: string; slot?: number; key: string }> = [];
  const assetId = String(asset.id || '').trim();
  if (!assetId) return out;

  const ok = String(asset.originalCompanionKey || '').trim();
  if (ok) out.push({ kind: 'original', variantId: 'original', key: ok });

  const rck = asset.resultsCompanionKeys || {};
  for (const stepId of Object.keys(rck)) {
    const key = String(rck[stepId] || '').trim();
    if (key) out.push({ kind: 'result', variantId: stepId, key });
  }

  const rpck = asset.resultsPreviewCompanionKeys || {};
  for (const stepId of Object.keys(rpck)) {
    const key = String(rpck[stepId] || '').trim();
    if (key) out.push({ kind: 'preview', variantId: stepId, key });
  }

  const smck = asset.stepModelCompanionKeys || {};
  for (const stepId of Object.keys(smck)) {
    const keys = smck[stepId] || [];
    for (let i = 0; i < keys.length; i += 1) {
      const key = String(keys[i] || '').trim();
      if (key) out.push({ kind: 'model', variantId: stepId, slot: i, key });
    }
  }

  const legacy = asset.modelCompanionKeys || [];
  for (let i = 0; i < legacy.length; i += 1) {
    const key = String(legacy[i] || '').trim();
    if (!key) continue;
    const already = out.some((x) => x.key === key);
    if (already) continue;
    out.push({ kind: 'model', variantId: String(asset.displayKey || 'original'), slot: i, key });
  }

  return out;
}

/** Preferred companion key for a display variant (model → result → original). */
export function resolveActiveVariantCompanionKey(asset: WorkflowAsset, displayKey?: string): string {
  const dk = String(displayKey || asset.displayKey || 'original').trim() || 'original';
  const modelKey = resolveWorkflowStepModelCompanionKeys(asset, dk).find((k) => String(k || '').trim());
  if (modelKey) return String(modelKey).trim();
  if (dk !== 'original') return String(asset.resultsCompanionKeys?.[dk] || '').trim();
  return String(asset.originalCompanionKey || '').trim();
}
