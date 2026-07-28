import React, { useMemo, useState } from 'react';
import type { WorkflowAsset } from '../types';
import { useExecutionElapsedSeconds } from '../hooks/useExecutionElapsedSeconds';
import type { ImageVersion, PromptArtifact, VgpAssetExtension } from '../types/vgp';
import {
  DEFAULT_WORKFLOW_STEP_TIMELINE_ORDER,
  deriveWorkflowStepTimelineRows,
  formatWorkflowStepExecutedAt,
  type WorkflowStepTimelineOrder,
} from '../services/workflowStepTimeline';
import { ensureWorkflowAssetVgp } from '../services/vgp/migrateLegacyAsset';
import { stripResultKeyToBaseActionId } from './workflow/workflowIds';
import { isWorkflowGenerate3dResultStep, getWorkflowStepModelPersistStatus, workflowModelPersistStatusLabel } from '../services/workflowStepModels';

function parentStepLabel(
  vgp: VgpAssetExtension,
  parentVersionId: string | null,
  getStepLabel: (stepKey: string) => string
): string {
  if (parentVersionId == null) return '—';
  const pv = vgp.versionsById[parentVersionId];
  if (!pv) return '—';
  if (pv.role === 'original') return '原图';
  return `第 ${pv.stepIndex} 步：${getStepLabel(pv.stepKey)}`;
}

function findVgpVersionForResultKey(vgp: VgpAssetExtension, resultKey: string): ImageVersion | null {
  for (const id of vgp.versionOrder) {
    const v = vgp.versionsById[id];
    if (!v) continue;
    const key = v.imageRef.kind === 'original_field' ? 'original' : v.imageRef.key;
    if (key === resultKey) return v;
  }
  return null;
}

function overlayDocSummary(doc: NonNullable<WorkflowAsset['imageOverlayAnnotations']>[string]): string {
  const nItem = doc.items?.length ?? 0;
  const nCrop = doc.crops?.length ?? 0;
  const parts: string[] = [];
  if (nItem) parts.push(`标注 ${nItem} 项`);
  if (nCrop) parts.push(`裁切 ${nCrop} 块`);
  if (doc.localEdit) parts.push('局部重绘选区');
  if (doc.panoViewportCrop || doc.panoLocalEditViewport || (doc.panoLocalEditEquirect?.length ?? 0) > 0) parts.push('全景相关选区');
  return parts.length ? parts.join(' · ') : '文档为空壳';
}

function pickResultImageSrc(asset: WorkflowAsset, resultKey: string): string {
  if (resultKey === 'original') return asset.original ?? '';
  if (resultKey === 'cut_image') {
    return asset.displayKey === 'cut_image' ? asset.original : asset.results?.[resultKey] ?? asset.original;
  }
  const r = asset.results?.[resultKey];
  return r != null && String(r).trim() !== '' ? r : '';
}

type StepResultMetaEntry = NonNullable<WorkflowAsset['resultMeta']>[string];

function artifactHasPresetUnderstand(art: PromptArtifact | undefined): boolean {
  return Boolean(art?.applied_rules?.some((r) => r.ruleId === 'capability.preset_understand'));
}

function artifactHasUserPromptOverrideRule(art: PromptArtifact | undefined): boolean {
  return Boolean(art?.applied_rules?.some((r) => r.ruleId === 'user.prompt_override'));
}

function extractUnderstandPresetIds(art: PromptArtifact | undefined): string[] {
  if (!art?.applied_rules) return [];
  const out: string[] = [];
  for (const r of art.applied_rules) {
    if (r.ruleId === 'capability.preset_understand' && r.detail) out.push(r.detail);
  }
  return out;
}

function resolveUsedCapabilityUnderstand(meta: StepResultMetaEntry | undefined, art: PromptArtifact | undefined): boolean {
  if (meta?.usedCapabilityUnderstand === true) return true;
  if (meta?.usedCapabilityUnderstand === false) return false;
  return artifactHasPresetUnderstand(art);
}

function truncateText(s: string, max: number): string {
  const t = String(s);
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export type WorkflowStepTimelineDetailPanelProps = {
  asset: WorkflowAsset;
  getStepLabel: (stepKey: string) => string;
  /** 与 `WorkflowStepTimelinePanel` 的 `currentDisplayKey`、时间线条目点击一致 */
  selectedResultKey: string;
  timelineOrder?: WorkflowStepTimelineOrder;
  /** 将预设 id 解析为展示名（缺省则显示 id） */
  resolvePresetLabel?: (presetId: string) => string;
  /** 预设 instruction 等，用于与入队覆写对照 */
  getPresetInstruction?: (presetId: string) => string | undefined;
  onPullTripoModels?: () => void | Promise<void>;
  onPullTencentModels?: () => void | Promise<void>;
  pullTripoBusy?: boolean;
  pullTencentBusy?: boolean;
  /** 大图预览时：该资产当前有队列任务正在执行 */
  executionActive?: boolean;
  /** 当前执行任务的已运行秒数（legacy；优先用 executionStartedAt） */
  executionElapsedSeconds?: number | null;
  /** 当前执行任务开始时间戳；组件内本地 tick */
  executionStartedAt?: number | null;
  /** 当前执行中的能力/步骤展示名 */
  executionStepLabel?: string | null;
};

export const WorkflowStepTimelineDetailPanel: React.FC<WorkflowStepTimelineDetailPanelProps> = ({
  asset,
  getStepLabel,
  selectedResultKey,
  timelineOrder: timelineOrderProp,
  resolvePresetLabel,
  getPresetInstruction,
  onPullTripoModels,
  onPullTencentModels,
  pullTripoBusy = false,
  pullTencentBusy = false,
  executionActive = false,
  executionElapsedSeconds = null,
  executionStartedAt = null,
  executionStepLabel = null,
}) => {
  const localElapsed = useExecutionElapsedSeconds(executionStartedAt, Boolean(executionActive));
  const displayElapsed =
    executionStartedAt != null ? localElapsed : executionElapsedSeconds;
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [presetInstrExpanded, setPresetInstrExpanded] = useState(false);
  const order = timelineOrderProp ?? DEFAULT_WORKFLOW_STEP_TIMELINE_ORDER;
  const displayAsset = useMemo(() => ensureWorkflowAssetVgp(asset), [asset]);
  const vgp = displayAsset.vgp;

  const rows = useMemo(
    () => deriveWorkflowStepTimelineRows(displayAsset, getStepLabel, { order }),
    [displayAsset, getStepLabel, order]
  );

  const timelineRow = useMemo(
    () => rows.find((r) => r.resultKey === selectedResultKey) ?? null,
    [rows, selectedResultKey]
  );

  const meta = displayAsset.resultMeta?.[selectedResultKey];
  const baseActionId = stripResultKeyToBaseActionId(selectedResultKey);
  const textBody = displayAsset.textResults?.[selectedResultKey];
  const imgSrc = pickResultImageSrc(displayAsset, selectedResultKey);
  const vMatch = vgp ? findVgpVersionForResultKey(vgp, selectedResultKey) : null;
  const sem = vMatch && vgp ? vgp.semanticsById[vMatch.semanticStateId] : undefined;
  const art = vMatch?.promptArtifactId && vgp ? vgp.promptsById[vMatch.promptArtifactId] : undefined;
  const fullPrompt = art?.compiled_prompt ?? '';
  const usedUnderstand = useMemo(() => resolveUsedCapabilityUnderstand(meta, art), [meta, art]);
  const understandPresetIds = useMemo(() => extractUnderstandPresetIds(art), [art]);
  const presetMetaId = meta?.presetActionIdSnapshot ?? baseActionId;
  const presetDisplayName = (resolvePresetLabel?.(presetMetaId) ?? presetMetaId).trim();
  const presetInstrRaw = (getPresetInstruction?.(presetMetaId) ?? '').trim();
  const rawUnderstood = (art?.raw_understood_instruction ?? '').trim();
  const showRawUnderstoodDiff =
    Boolean(rawUnderstood) && Boolean(fullPrompt.trim()) && rawUnderstood !== fullPrompt.trim();
  const tags = (displayAsset.imageTags?.[selectedResultKey] || []).filter(Boolean);
  const overlayFlat = displayAsset.imageOverlayAnnotations?.[selectedResultKey];
  const overlayPano = displayAsset.imageOverlayAnnotationsPano?.[selectedResultKey];
  const rKey = displayAsset.resultsObjectKeys?.[selectedResultKey];
  const rCompanion = displayAsset.resultsCompanionKeys?.[selectedResultKey];

  const isGenerate3dStep = isWorkflowGenerate3dResultStep(displayAsset, selectedResultKey);
  const modelPersistLabel = useMemo(() => {
    if (!isGenerate3dStep) return '';
    const d = getWorkflowStepModelPersistStatus(displayAsset, selectedResultKey);
    return workflowModelPersistStatusLabel(d);
  }, [displayAsset, isGenerate3dStep, selectedResultKey]);

  const exportCurrentTxt = () => {
    const lines: string[] = [
      `资产 ${displayAsset.id.slice(0, 8)}… — 步骤时间线详情（单步）`,
      `导出时间 ${new Date().toLocaleString()}`,
      '',
      `展示键：${selectedResultKey}`,
      `时间线条目：${timelineRow ? timelineRow.label : '（不在 resultOrder 中）'}`,
      `执行时间：${meta?.executedAt ? formatWorkflowStepExecutedAt(meta.executedAt) : '未记录'}`,
      `展示用标签：${meta?.displayStepLabel?.trim() || '—'}`,
      `媒体类型：${meta?.mediaKind ?? '—'}`,
      `Tripo 任务：${meta?.tripoTaskId ?? '—'}`,
      `Tripo 最近错误：${meta?.tripoLastError ?? '—'}`,
      `混元 JobId：${meta?.tencentJobId ?? '—'}`,
      `混元最近错误：${meta?.tencentLastError ?? '—'}`,
      '',
      '--- 入队侧快照（若有） ---',
      `选用预设/能力基 id：${meta?.presetActionIdSnapshot ?? '—'}`,
      `用户覆写提示词：${meta?.promptOverrideSnapshot ?? '（无或未落盘）'}`,
      `文卡/附加正文：${meta?.inputTextSnapshot ?? '（无或未落盘）'}`,
      `经过能力理解：${usedUnderstand ? '是' : '否'}`,
      `入队时跳过理解标记：${meta?.skipUnderstandSnapshot === true ? '是' : '否'}`,
      '',
      usedUnderstand ? '--- 理解后的提示词（送模） ---' : '--- 送模或记录文案（未走理解或未落盘理解） ---',
      fullPrompt || '（无）',
      '',
      `上一步（VGP）：${vgp && vMatch ? parentStepLabel(vgp, vMatch.parentVersionId, getStepLabel) : '—'}`,
      `当时目标：${sem?.target?.summary ?? '—'}`,
      '',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `workflow-step-${selectedResultKey.replace(/[^\w.-]+/g, '_').slice(0, 48)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportAllTxt = () => {
    if (!vgp) return;
    const lines: string[] = [`资产 ${displayAsset.id.slice(0, 8)}… 全步骤导出`, `导出时间 ${new Date().toLocaleString()}`, ''];
    const ordered = vgp.versionOrder.map((id) => vgp.versionsById[id]).filter(Boolean) as ImageVersion[];
    for (const v of ordered) {
      const s = vgp.semanticsById[v.semanticStateId];
      const ar = v.promptArtifactId ? vgp.promptsById[v.promptArtifactId] : undefined;
      lines.push(`--- 步骤 ${v.stepIndex} (${getStepLabel(v.stepKey)}) ---`);
      lines.push(`上一步：${parentStepLabel(vgp, v.parentVersionId, getStepLabel)}`);
      lines.push(`目标：${s?.target?.summary ?? '—'}`);
      lines.push(`生成说明：${ar?.compiled_prompt ?? '（无）'}`);
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `workflow-gen-record-${displayAsset.id.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="min-h-0 w-full border-t border-white/10 bg-transparent px-3 pt-3 pb-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[8px] font-black text-gray-500 uppercase tracking-wide">步骤时间线的详情</div>
          <p className="mt-1 text-[8px] text-gray-600 leading-relaxed">
            与上方「步骤时间线」同一选中项：含入队时的预设/用户输入快照、是否经过「理解」、以及理解后或直送的送模文案（与 VGP 链一致）。
          </p>
        </div>
        <div className="flex flex-col gap-1 shrink-0 items-end">
          <button
            type="button"
            onClick={exportCurrentTxt}
            className="px-2 py-1 rounded-lg text-[8px] font-black uppercase border border-white/15 bg-white/5 hover:bg-white/10 text-gray-200 whitespace-nowrap"
          >
            导出本步
          </button>
          {vgp ? (
            <button
              type="button"
              onClick={exportAllTxt}
              className="px-2 py-1 rounded-lg text-[8px] font-black uppercase border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-gray-400 whitespace-nowrap"
            >
              导出全部
            </button>
          ) : null}
        </div>
      </div>

      {!timelineRow ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-2 py-1.5 text-[8px] text-amber-200/90 leading-relaxed">
          当前展示键 <span className="font-mono text-amber-100/95">{selectedResultKey}</span> 不在本资产的步骤时间线中（
          <span className="font-mono">resultOrder</span> 未包含此键，或数据不同步）。下方仍尽量展示可用的元数据与缩略图。
        </div>
      ) : null}

      {executionActive ? (
        <div className="rounded-xl border border-blue-500/35 bg-blue-950/30 p-3 space-y-1.5 ring-1 ring-blue-400/15">
          <div className="text-[8px] font-black uppercase tracking-wide text-blue-300/95">当前执行</div>
          <p className="text-[10px] text-gray-100 leading-snug">
            已运行{' '}
            <span className="font-mono tabular-nums text-blue-200">
              {Math.max(0, Math.floor(displayElapsed ?? 0))}
            </span>{' '}
            秒
          </p>
          {executionStepLabel?.trim() ? (
            <p className="text-[8px] text-gray-400 leading-relaxed">
              <span className="text-gray-500">任务：</span>
              {executionStepLabel.trim()}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2.5">
        <div className="text-[10px] font-semibold text-blue-200/95 leading-snug break-words">
          {timelineRow?.label ?? getStepLabel(selectedResultKey)}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[8px] text-gray-400">
          <dt className="text-gray-500 shrink-0">步骤键</dt>
          <dd className="font-mono text-gray-300 break-all">{selectedResultKey}</dd>
          <dt className="text-gray-500 shrink-0">能力基 id</dt>
          <dd className="font-mono text-gray-300 break-all">{baseActionId}</dd>
          <dt className="text-gray-500 shrink-0">执行时间</dt>
          <dd className="tabular-nums text-gray-300">
            {meta?.executedAt ? formatWorkflowStepExecutedAt(meta.executedAt) : '未记录'}
          </dd>
          <dt className="text-gray-500 shrink-0">时间线标签</dt>
          <dd className="text-gray-300">{timelineRow?.label ?? '—'}</dd>
          <dt className="text-gray-500 shrink-0">产出</dt>
          <dd className="text-gray-300 flex flex-wrap gap-1 items-center">
            {timelineRow?.hasImage ? (
              <span className="rounded border border-white/10 px-1 py-0.5 text-[7px] uppercase text-gray-400">图</span>
            ) : null}
            {timelineRow?.hasText ? (
              <span className="rounded border border-white/10 px-1 py-0.5 text-[7px] uppercase text-gray-400">文</span>
            ) : null}
            {timelineRow?.hasModel3d ? (
              <span className="rounded border border-white/10 px-1 py-0.5 text-[7px] uppercase text-gray-400">3D</span>
            ) : null}
            {timelineRow?.mediaKind && timelineRow.mediaKind !== 'model3d' ? (
              <span className="rounded border border-white/10 px-1 py-0.5 text-[7px] uppercase text-gray-400">
                {timelineRow.mediaKind}
              </span>
            ) : null}
            {!timelineRow?.hasImage && !timelineRow?.hasText && !timelineRow?.hasModel3d && selectedResultKey === 'original' ? (
              <span className="text-gray-500">原图输入</span>
            ) : null}
          </dd>
        </dl>

        {isGenerate3dStep ? (
          <div className="pt-2 border-t border-white/10 space-y-1.5 text-[8px]">
            <div className="font-black text-violet-300/90 uppercase text-[7px]">生成 3D</div>
            {modelPersistLabel ? (
              <p className="text-gray-300 leading-relaxed rounded-lg border border-white/10 bg-black/30 px-2 py-1">
                {modelPersistLabel}
              </p>
            ) : null}
            {meta?.tripoTaskId ? (
              <div className="space-y-1">
                <p className="text-gray-300 break-all leading-relaxed">
                  <span className="text-gray-500">Tripo 任务 id（已写入本步 resultMeta，刷新后仍保留）：</span>
                  <span className="font-mono text-gray-100">{meta.tripoTaskId}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(meta.tripoTaskId || '')}
                    className="px-2 py-1 rounded-lg text-[8px] font-black uppercase border border-white/15 bg-white/5 hover:bg-white/10 text-gray-200"
                  >
                    复制 Tripo 任务 id
                  </button>
                  {onPullTripoModels ? (
                    <button
                      type="button"
                      disabled={pullTripoBusy}
                      onClick={() => void onPullTripoModels()}
                      className="px-2 py-1 rounded-lg text-[8px] font-black uppercase border border-violet-400/30 bg-violet-950/40 hover:bg-violet-900/50 text-violet-200 disabled:opacity-50"
                    >
                      {pullTripoBusy ? '拉取中…' : '从 Tripo 拉取模型'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {meta?.tencentJobId ? (
              <div className="space-y-1">
                <p className="text-gray-300 break-all leading-relaxed">
                  <span className="text-gray-500">混元 JobId（已写入本步 resultMeta，刷新后仍保留）：</span>
                  <span className="font-mono text-gray-100">{meta.tencentJobId}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(meta.tencentJobId || '')}
                    className="px-2 py-1 rounded-lg text-[8px] font-black uppercase border border-white/15 bg-white/5 hover:bg-white/10 text-gray-200"
                  >
                    复制混元 JobId
                  </button>
                  {onPullTencentModels ? (
                    <button
                      type="button"
                      disabled={pullTencentBusy}
                      onClick={() => void onPullTencentModels()}
                      className="px-2 py-1 rounded-lg text-[8px] font-black uppercase border border-violet-400/30 bg-violet-950/40 hover:bg-violet-900/50 text-violet-200 disabled:opacity-50"
                    >
                      {pullTencentBusy ? '拉取中…' : '从混元拉取模型'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {!meta?.tripoTaskId && !meta?.tencentJobId ? (
              <p className="text-amber-200/90 leading-relaxed">
                本步为生成 3D，但尚未落盘任务 id（Tripo taskId 或混元 jobId；可能仍在排队/生成，或历史数据未迁移）。生成开始后或完成后会写入此处。
              </p>
            ) : null}
            {meta?.tripoLastError ? (
              <p className="text-rose-300/90 whitespace-pre-wrap break-words">
                <span className="text-gray-500">Tripo 最近错误：</span>
                {meta.tripoLastError}
              </p>
            ) : null}
            {meta?.tencentLastError ? (
              <p className="text-rose-300/90 whitespace-pre-wrap break-words">
                <span className="text-gray-500">混元最近错误：</span>
                {meta.tencentLastError}
              </p>
            ) : null}
          </div>
        ) : null}

        {selectedResultKey === 'original' ? (
          <p className="text-[8px] text-gray-500 leading-relaxed">
            原图为入队素材，无「执行队列」侧的预设/覆写快照；若从原图继续生成，请在后续步骤查看详情。
          </p>
        ) : (
          <>
            <div className="pt-2 border-t border-white/10 space-y-1.5 text-[8px]">
              <div className="font-black text-gray-500 uppercase text-[7px]">入队时的预设与用户输入</div>
              <p className="text-gray-400">
                <span className="text-gray-500">选用能力/预设：</span>
                <span className="text-gray-200">{presetDisplayName}</span>
                <span className="font-mono text-gray-500"> · {presetMetaId}</span>
              </p>
              {presetInstrRaw ? (
                <div className="text-gray-400">
                  <span className="text-gray-500">预设默认 instruction（入队底稿）：</span>
                  <span className="text-gray-300 whitespace-pre-wrap break-words">
                    {presetInstrExpanded ? presetInstrRaw : truncateText(presetInstrRaw, 360)}
                  </span>
                  {presetInstrRaw.length > 360 ? (
                    <button
                      type="button"
                      onClick={() => setPresetInstrExpanded((x) => !x)}
                      className="ml-1 text-[8px] text-blue-400 hover:underline align-baseline"
                    >
                      {presetInstrExpanded ? '收起' : '展开'}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {meta?.promptOverrideSnapshot ? (
                <div>
                  <div className="text-gray-500 mb-0.5">用户覆写提示词（入队时「微调」框原文）</div>
                  <pre className="max-h-24 overflow-y-auto rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-[8px] text-amber-100/95 whitespace-pre-wrap break-words">
                    {meta.promptOverrideSnapshot}
                  </pre>
                </div>
              ) : artifactHasUserPromptOverrideRule(art) ? (
                <p className="text-gray-500 leading-relaxed">
                  VGP 标记含「用户覆写」，但本步元数据无覆写原文快照（多为升级前数据）；送模文案仍以理解结果或下方 VGP 为准。
                </p>
              ) : (
                <p className="text-gray-600">无用户覆写提示词快照。</p>
              )}
              {meta?.inputTextSnapshot ? (
                <div>
                  <div className="text-gray-500 mb-0.5">文卡 / 附加正文（入队快照）</div>
                  <pre className="max-h-20 overflow-y-auto rounded-lg border border-white/10 bg-black/25 p-2 text-[8px] text-gray-300 whitespace-pre-wrap break-words">
                    {meta.inputTextSnapshot}
                  </pre>
                </div>
              ) : null}
              <p className="text-gray-400 flex flex-wrap gap-x-2 gap-y-0.5">
                <span>
                  <span className="text-gray-500">经过能力「理解」：</span>
                  <span className={usedUnderstand ? 'text-emerald-300/95' : 'text-gray-300'}>
                    {usedUnderstand ? '是（执行返回理解快照）' : '否'}
                  </span>
                </span>
                {meta?.skipUnderstandSnapshot === true ? (
                  <span className="text-amber-200/90">入队时标记「跳过理解」</span>
                ) : null}
              </p>
              {understandPresetIds.length > 0 ? (
                <div className="text-gray-400">
                  <span className="text-gray-500">理解链涉及的预设 id：</span>
                  <ul className="mt-0.5 list-disc pl-4 space-y-0.5">
                    {understandPresetIds.map((pid) => (
                      <li key={pid} className="font-mono text-[8px] text-gray-300 break-all">
                        {pid}
                        {resolvePresetLabel ? (
                          <span className="text-gray-500"> → {resolvePresetLabel(pid)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            {fullPrompt.trim() ? (
              <div className="pt-2 border-t border-white/10 space-y-1.5 text-[8px]">
                <div
                  className={`font-black uppercase text-[7px] ${usedUnderstand ? 'text-emerald-400/90' : 'text-gray-500'}`}
                >
                  {usedUnderstand ? '理解后的提示词（实际送模）' : '送模或记录文案（未走理解或未落盘理解快照）'}
                </div>
                {usedUnderstand ? (
                  <p className="text-gray-500 leading-relaxed">
                    由能力「理解」模型基于预设 instruction 与用户覆写/文卡等生成；与 VGP 中本步{' '}
                    <span className="font-mono">compiled_prompt</span> 一致。
                  </p>
                ) : (
                  <p className="text-gray-500 leading-relaxed">
                    未走理解或执行器未返回理解快照时：为入队侧 instruction、用户覆写或文卡正文的落盘记录（与 VGP 一致）。
                  </p>
                )}
                <pre
                  className={`max-h-48 overflow-y-auto rounded-lg border p-2 text-[8px] whitespace-pre-wrap break-words leading-relaxed ${
                    usedUnderstand
                      ? 'border-emerald-500/25 bg-emerald-950/35 text-gray-100'
                      : 'border-white/12 bg-black/40 text-gray-200'
                  }`}
                >
                  {promptExpanded ? fullPrompt : truncateText(fullPrompt, 480)}
                </pre>
                {fullPrompt.length > 480 ? (
                  <button
                    type="button"
                    onClick={() => setPromptExpanded((e) => !e)}
                    className="text-[8px] text-blue-400 hover:underline"
                  >
                    {promptExpanded ? '收起全文' : '展开全文'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(fullPrompt)}
                  className="mr-2 px-2 py-1 rounded-lg text-[8px] font-black uppercase border border-white/15 bg-white/5 hover:bg-white/10 text-gray-200"
                >
                  复制{usedUnderstand ? '理解后' : '送模'}全文
                </button>
                {showRawUnderstoodDiff ? (
                  <div className="pt-1 space-y-0.5">
                    <div className="text-[7px] font-black text-gray-500 uppercase">raw 理解片段（与合并稿不同）</div>
                    <pre className="max-h-24 overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-2 text-[8px] text-gray-300 whitespace-pre-wrap break-words">
                      {rawUnderstood}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="pt-2 border-t border-white/10 text-[8px] text-gray-500">本步无可展示的送模/理解文案（可能仍在执行或数据未写入）。</p>
            )}
          </>
        )}

        {(meta?.displayStepLabel?.trim() || meta?.tripoTaskId || meta?.tripoLastError || meta?.tencentJobId || meta?.tencentLastError) && (
          <div className="pt-2 border-t border-white/10 space-y-1 text-[8px]">
            <div className="font-black text-gray-500 uppercase text-[7px]">执行记录扩展</div>
            {meta?.displayStepLabel?.trim() ? (
              <p className="text-gray-300">
                <span className="text-gray-500">展示用短标签：</span>
                {meta.displayStepLabel.trim()}
              </p>
            ) : null}
            {meta?.tripoTaskId ? (
              <div className="space-y-1">
                <p className="text-gray-300 break-all">
                  <span className="text-gray-500">Tripo 任务 id（已随本步 resultMeta 持久化，用于恢复查询 / 大图「拉取模型」）：</span>
                  <span className="font-mono text-gray-200">{meta.tripoTaskId}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(meta.tripoTaskId || '')}
                    className="px-2 py-1 rounded-lg text-[8px] font-black uppercase border border-white/15 bg-white/5 hover:bg-white/10 text-gray-200"
                  >
                    复制 Tripo 任务 id
                  </button>
                  {onPullTripoModels ? (
                    <button
                      type="button"
                      disabled={pullTripoBusy}
                      onClick={() => void onPullTripoModels()}
                      className="px-2 py-1 rounded-lg text-[8px] font-black uppercase border border-violet-400/30 bg-violet-950/40 hover:bg-violet-900/50 text-violet-200 disabled:opacity-50"
                    >
                      {pullTripoBusy ? '拉取中…' : '从 Tripo 拉取模型'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {meta?.tencentJobId ? (
              <div className="space-y-1">
                <p className="text-gray-300 break-all">
                  <span className="text-gray-500">混元 JobId（已随本步 resultMeta 持久化）：</span>
                  <span className="font-mono text-gray-200">{meta.tencentJobId}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(meta.tencentJobId || '')}
                    className="px-2 py-1 rounded-lg text-[8px] font-black uppercase border border-white/15 bg-white/5 hover:bg-white/10 text-gray-200"
                  >
                    复制混元 JobId
                  </button>
                  {onPullTencentModels ? (
                    <button
                      type="button"
                      disabled={pullTencentBusy}
                      onClick={() => void onPullTencentModels()}
                      className="px-2 py-1 rounded-lg text-[8px] font-black uppercase border border-violet-400/30 bg-violet-950/40 hover:bg-violet-900/50 text-violet-200 disabled:opacity-50"
                    >
                      {pullTencentBusy ? '拉取中…' : '从混元拉取模型'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {meta?.tripoLastError ? (
              <p className="text-rose-300/90 whitespace-pre-wrap break-words">
                <span className="text-gray-500">Tripo 最近错误：</span>
                {meta.tripoLastError}
              </p>
            ) : null}
            {meta?.tencentLastError ? (
              <p className="text-rose-300/90 whitespace-pre-wrap break-words">
                <span className="text-gray-500">混元最近错误：</span>
                {meta.tencentLastError}
              </p>
            ) : null}
          </div>
        )}

        {(rKey || rCompanion) && (
          <div className="pt-2 border-t border-white/10 text-[8px] text-gray-400 space-y-0.5">
            <div className="font-black text-gray-500 uppercase text-[7px]">持久化 / 云同步</div>
            {rKey ? (
              <p className="break-all">
                <span className="text-gray-500">R2 对象键：</span>
                <span className="font-mono text-gray-300">{rKey}</span>
              </p>
            ) : null}
            {rCompanion ? (
              <p className="break-all">
                <span className="text-gray-500">本地伴侣键：</span>
                <span className="font-mono text-gray-300">{rCompanion}</span>
              </p>
            ) : null}
          </div>
        )}

        {tags.length > 0 ? (
          <div className="pt-2 border-t border-white/10">
            <div className="text-[7px] font-black text-gray-500 uppercase mb-1">本步标签</div>
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="px-1.5 py-0.5 rounded border border-[#314767] bg-[#182235] text-[8px] text-blue-200/90"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {(overlayFlat || overlayPano) && (
          <div className="pt-2 border-t border-white/10 text-[8px] text-gray-400 space-y-1">
            <div className="font-black text-gray-500 uppercase text-[7px]">平面 / 全景标注</div>
            {overlayFlat ? <p>平面模式：{overlayDocSummary(overlayFlat)}</p> : null}
            {overlayPano ? <p>全景模式：{overlayDocSummary(overlayPano)}</p> : null}
          </div>
        )}

        {textBody != null && String(textBody).trim() !== '' ? (
          <div className="pt-2 border-t border-white/10">
            <div className="text-[7px] font-black text-gray-500 uppercase mb-1">文本结果（节选）</div>
            <pre className="max-h-28 overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-2 text-[8px] text-gray-300 whitespace-pre-wrap break-words">
              {String(textBody).length > 1200 ? `${String(textBody).slice(0, 1200)}…` : String(textBody)}
            </pre>
          </div>
        ) : null}

        {vgp && vMatch ? (
          <div className="pt-2 border-t border-white/10 space-y-1.5 text-[8px]">
            <div className="font-black text-gray-500 uppercase text-[7px]">生成记录（VGP 链上本步）</div>
            <p className="text-gray-400">
              链上序号 <span className="font-mono text-gray-300">stepIndex={vMatch.stepIndex}</span>
              {' · '}
              角色 <span className="font-mono text-gray-300">{vMatch.role}</span>
            </p>
            <p className="text-gray-400">
              <span className="text-gray-500">上一步：</span>
              {parentStepLabel(vgp, vMatch.parentVersionId, getStepLabel)}
            </p>
            <p className="text-gray-300">
              <span className="text-gray-500">当时目标：</span>
              {sem?.target?.summary ?? '—'}
            </p>
            {sem?.provenance?.note ? (
              <p className="text-gray-500">
                <span className="text-gray-500">来源备注：</span>
                {sem.provenance.kind} — {sem.provenance.note}
              </p>
            ) : null}
            {vMatch.modelInvocation ? (
              <p className="text-gray-400 break-all">
                <span className="text-gray-500">模型调用快照：</span>
                {JSON.stringify(vMatch.modelInvocation)}
              </p>
            ) : null}
            {fullPrompt.trim() ? (
              <p className="text-gray-500">
                送模/理解正文已在上文「{usedUnderstand ? '理解后的提示词' : '送模或记录文案'}」展示；此处为链上技术镜像（
                <span className="font-mono">compiled_prompt</span>）。
              </p>
            ) : (
              <p className="text-gray-500">链上无 compiled_prompt 文本。</p>
            )}
            {art?.negative_prompt ? (
              <p className="text-gray-500 whitespace-pre-wrap break-words">
                <span className="text-gray-500">负向提示：</span>
                {art.negative_prompt}
              </p>
            ) : null}
            {art?.raw_understood_instruction && !showRawUnderstoodDiff ? (
              <p className="text-gray-500 whitespace-pre-wrap break-words">
                <span className="text-gray-500">理解原文（与上文合并稿一致）：</span>
                {art.raw_understood_instruction}
              </p>
            ) : null}
          </div>
        ) : vgp ? (
          <div className="pt-2 border-t border-white/10 text-[8px] text-gray-500 leading-relaxed">
            未在 VGP 版本链上找到与本展示键完全对应的节点（常见于历史数据或迁移占位）。时间线与结果图仍以{' '}
            <span className="font-mono">resultOrder</span> / <span className="font-mono">results</span> 为准。
          </div>
        ) : (
          <div className="pt-2 border-t border-white/10 text-[8px] text-gray-500 leading-relaxed">
            本资产尚无 VGP 扩展数据；仅展示时间与结果侧字段。
          </div>
        )}

        {imgSrc && (imgSrc.startsWith('data:') || imgSrc.startsWith('blob:') || imgSrc.startsWith('http')) ? (
          <div className="pt-2 border-t border-white/10">
            <div className="text-[7px] font-black text-gray-500 uppercase mb-1">本步缩略</div>
            <img
              src={imgSrc}
              alt=""
              className="max-h-24 max-w-full rounded-lg border border-white/10 object-contain bg-black/40"
            />
          </div>
        ) : timelineRow?.hasImage ? (
          <p className="pt-2 border-t border-white/10 text-[8px] text-gray-500">
            本步标记为有图，但当前内存中无内联预览数据（可能已剥离为云键，等待 hydrate）。
          </p>
        ) : null}
      </div>
    </div>
  );
};
