/**
 * Expert Studio — Phase 4C (§17.10 / P21).
 * Mount from project Agent dock menu / project settings — NOT a separate admin site.
 * Contract: implement UI against frozen experts/* + artifacts APIs only.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyExpertProfilePatch,
  clearExpertMemories,
  deleteExpertMemory,
  listExpertMemories,
  listExpertProfiles,
  listProjectAgentArtifacts,
  promoteProjectAgentArtifact,
  tryRunArtifactAsPrompt,
} from '../../services/projectAgent';
import type {
  ExpertId,
  ExpertMemoryEntry,
  ExpertProfile,
  ProjectAgentArtifact,
} from '../../types/projectAgent';

export type ExpertStudioPendingPatch = Partial<ExpertProfile> & { baseVersion: number };

export type ExpertStudioProps = {
  userId: string;
  workspaceProjectId: string;
  onClose?: () => void;
  /**
   * Optional pending profile patches (from chat confirm cards / invoke).
   * Studio can confirm via `applyExpertProfilePatch`.
   */
  pendingProfilePatches?: Record<string, ExpertStudioPendingPatch>;
  onPendingProfilePatchCleared?: (expertId: ExpertId) => void;
  /**
   * Try-run: parent can inject artifact text into quick compose.
   * If omitted, Studio copies to clipboard and shows a tip.
   */
  onTryRunPrompt?: (text: string) => void;
};

type StudioTab = 'persona' | 'memory' | 'artifacts';

type LoadState<T> = {
  data: T;
  error: string | null;
  loading: boolean;
};

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function summarizeToolIds(toolIds: string[] | undefined, max = 3): string {
  const ids = Array.isArray(toolIds) ? toolIds.filter(Boolean) : [];
  if (ids.length === 0) return '无工具白名单';
  if (ids.length <= max) return ids.join(', ');
  return `${ids.slice(0, max).join(', ')} +${ids.length - max}`;
}

function formatTs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

/**
 * Expert Studio body — list / persona / memory / artifacts.
 * Keep export name stable for dock mount.
 */
export function ExpertStudio(props: ExpertStudioProps): React.ReactElement {
  const {
    userId,
    workspaceProjectId,
    onClose,
    pendingProfilePatches,
    onPendingProfilePatchCleared,
    onTryRunPrompt,
  } = props;

  const [experts, setExperts] = useState<LoadState<ExpertProfile[]>>({
    data: [],
    error: null,
    loading: true,
  });
  const [selectedExpertId, setSelectedExpertId] = useState<ExpertId | null>(null);
  const [tab, setTab] = useState<StudioTab>('persona');
  const [memories, setMemories] = useState<LoadState<ExpertMemoryEntry[]>>({
    data: [],
    error: null,
    loading: false,
  });
  const [artifacts, setArtifacts] = useState<LoadState<ProjectAgentArtifact[]>>({
    data: [],
    error: null,
    loading: false,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const refreshExperts = useCallback(() => {
    setExperts((prev) => ({ ...prev, loading: true }));
    try {
      const list = listExpertProfiles();
      setExperts({ data: Array.isArray(list) ? list : [], error: null, loading: false });
    } catch (e) {
      setExperts({ data: [], error: errMessage(e), loading: false });
    }
  }, []);

  useEffect(() => {
    refreshExperts();
  }, [refreshExperts]);

  useEffect(() => {
    if (!selectedExpertId && experts.data.length > 0) {
      setSelectedExpertId(experts.data[0]!.expertId);
    }
  }, [experts.data, selectedExpertId]);

  const selectedExpert = useMemo(
    () => experts.data.find((e) => e.expertId === selectedExpertId) ?? null,
    [experts.data, selectedExpertId]
  );

  const pendingPatch = selectedExpertId
    ? pendingProfilePatches?.[selectedExpertId] ?? null
    : null;

  const refreshMemories = useCallback(() => {
    if (!selectedExpertId || !userId) {
      setMemories({ data: [], error: null, loading: false });
      return;
    }
    setMemories((prev) => ({ ...prev, loading: true }));
    try {
      const list = listExpertMemories({
        userId,
        expertId: selectedExpertId,
        workspaceProjectId: workspaceProjectId || undefined,
      });
      const active = (Array.isArray(list) ? list : []).filter((m) => !m.deletedAt);
      setMemories({ data: active, error: null, loading: false });
    } catch (e) {
      setMemories({ data: [], error: errMessage(e), loading: false });
    }
  }, [selectedExpertId, userId, workspaceProjectId]);

  const refreshArtifacts = useCallback(() => {
    if (!userId || !workspaceProjectId) {
      setArtifacts({ data: [], error: null, loading: false });
      return;
    }
    setArtifacts((prev) => ({ ...prev, loading: true }));
    try {
      const list = listProjectAgentArtifacts({ userId, workspaceProjectId });
      const rows = Array.isArray(list) ? list : [];
      const filtered = selectedExpertId
        ? rows.filter((a) => !a.expertId || a.expertId === selectedExpertId)
        : rows;
      filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setArtifacts({ data: filtered.slice(0, 40), error: null, loading: false });
    } catch (e) {
      setArtifacts({ data: [], error: errMessage(e), loading: false });
    }
  }, [userId, workspaceProjectId, selectedExpertId]);

  useEffect(() => {
    if (tab === 'memory') refreshMemories();
  }, [tab, refreshMemories]);

  useEffect(() => {
    if (tab === 'artifacts') refreshArtifacts();
  }, [tab, refreshArtifacts]);

  const handleApplyPatch = useCallback(() => {
    if (!selectedExpertId || !pendingPatch) return;
    setActionBusy(true);
    setActionError(null);
    setActionInfo(null);
    try {
      const next = applyExpertProfilePatch(selectedExpertId, pendingPatch);
      if (!next) {
        setActionError('确认失败：版本不匹配或专家不存在');
      } else {
        onPendingProfilePatchCleared?.(selectedExpertId);
        refreshExperts();
      }
    } catch (e) {
      setActionError(errMessage(e));
    } finally {
      setActionBusy(false);
    }
  }, [selectedExpertId, pendingPatch, onPendingProfilePatchCleared, refreshExperts]);

  const handleDeleteMemory = useCallback(
    (memoryId: string) => {
      if (!selectedExpertId || !userId) return;
      if (!window.confirm('删除这条记忆？')) return;
      setActionBusy(true);
      setActionError(null);
      setActionInfo(null);
      try {
        deleteExpertMemory(
          {
            userId,
            expertId: selectedExpertId,
            workspaceProjectId: workspaceProjectId || undefined,
          },
          memoryId
        );
        refreshMemories();
      } catch (e) {
        setActionError(errMessage(e));
      } finally {
        setActionBusy(false);
      }
    },
    [selectedExpertId, userId, workspaceProjectId, refreshMemories]
  );

  const handleClearMemories = useCallback(() => {
    if (!selectedExpertId || !userId) return;
    if (!window.confirm('清空该专家在本项目下的全部记忆？')) return;
    setActionBusy(true);
    setActionError(null);
    setActionInfo(null);
    try {
      clearExpertMemories({
        userId,
        expertId: selectedExpertId,
        workspaceProjectId: workspaceProjectId || undefined,
      });
      refreshMemories();
    } catch (e) {
      setActionError(errMessage(e));
    } finally {
      setActionBusy(false);
    }
  }, [selectedExpertId, userId, workspaceProjectId, refreshMemories]);

  const handleTryRun = useCallback(
    async (artifactId: string) => {
      if (!userId || !workspaceProjectId) return;
      setActionBusy(true);
      setActionError(null);
      setActionInfo(null);
      try {
        const result = tryRunArtifactAsPrompt({ userId, workspaceProjectId }, artifactId);
        if (!result.ok) {
          setActionError(result.errorMessage || '试跑失败');
          return;
        }
        if (onTryRunPrompt) {
          onTryRunPrompt(result.text);
          setActionInfo('已填入快捷输入框');
        } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(result.text);
            setActionInfo('已复制，可粘贴到输入框');
          } catch {
            setActionError('复制失败，请手动复制产物文本');
          }
        } else {
          setActionError('无法复制到剪贴板');
        }
      } catch (e) {
        setActionError(errMessage(e));
      } finally {
        setActionBusy(false);
      }
    },
    [userId, workspaceProjectId, onTryRunPrompt]
  );

  const handlePromote = useCallback(
    async (artifact: ProjectAgentArtifact) => {
      if (!userId || !workspaceProjectId) return;
      if (!window.confirm('将此产物存为能力预设？')) return;
      setActionBusy(true);
      setActionError(null);
      setActionInfo(null);
      try {
        const result = await promoteProjectAgentArtifact(
          { userId, workspaceProjectId },
          artifact.id,
          { targetKind: 'capability_preset' },
          { confirmed: true }
        );
        if (!result.ok) {
          setActionError(result.errorMessage || '晋升失败');
          return;
        }
        setActionInfo(`已存为能力预设：${result.presetId || '—'}`);
      } catch (e) {
        setActionError(errMessage(e));
      } finally {
        setActionBusy(false);
      }
    },
    [userId, workspaceProjectId]
  );

  const tabs: { id: StudioTab; label: string }[] = [
    { id: 'persona', label: '人设' },
    { id: 'memory', label: '记忆' },
    { id: 'artifacts', label: '产物' },
  ];

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2 bg-[#0f0f12] p-3 text-[11px] text-white/80"
      data-expert-studio
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-[12px] font-black tracking-wide text-gray-200">
          专家工作室
        </h2>
        {onClose ? (
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[10px] text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/50"
            onClick={onClose}
          >
            关闭
          </button>
        ) : null}
      </div>

      {actionError ? (
        <p className="shrink-0 rounded-md bg-red-500/10 px-2 py-1.5 text-[10px] text-red-300 ring-1 ring-red-500/20">
          {actionError}
        </p>
      ) : null}
      {actionInfo ? (
        <p className="shrink-0 rounded-md bg-emerald-500/10 px-2 py-1.5 text-[10px] text-emerald-200/90 ring-1 ring-emerald-500/20">
          {actionInfo}
        </p>
      ) : null}

      <section className="shrink-0 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            专家列表
          </span>
          <button
            type="button"
            onClick={refreshExperts}
            className="rounded px-1.5 py-0.5 text-[9px] text-gray-500 hover:bg-white/[0.06] hover:text-gray-300"
          >
            刷新
          </button>
        </div>
        {experts.loading ? (
          <p className="text-[10px] text-gray-500">加载中…</p>
        ) : experts.error ? (
          <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-200/90 ring-1 ring-amber-500/20">
            暂无法加载专家：{experts.error}
          </p>
        ) : experts.data.length === 0 ? (
          <p className="rounded-md border border-dashed border-white/[0.08] px-2 py-2 text-center text-[10px] text-gray-500">
            暂无专家档案
          </p>
        ) : (
          <ul className="max-h-28 space-y-1 overflow-y-auto pr-0.5">
            {experts.data.map((ex) => {
              const active = ex.expertId === selectedExpertId;
              return (
                <li key={ex.expertId}>
                  <button
                    type="button"
                    onClick={() => setSelectedExpertId(ex.expertId)}
                    className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ring-1 ${
                      active
                        ? 'bg-white/[0.12] text-white ring-white/[0.18]'
                        : 'bg-white/[0.03] text-gray-300 ring-white/[0.06] hover:bg-white/[0.07]'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[11px] font-semibold">
                        {ex.displayName || ex.expertId}
                      </span>
                      <span className="shrink-0 tabular-nums text-[9px] text-gray-500">
                        v{ex.version}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[9px] text-gray-500">
                      {summarizeToolIds(ex.toolIds)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="flex shrink-0 gap-0.5 border-b border-white/[0.06] pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
              tab === t.id
                ? 'bg-white/[0.12] text-white'
                : 'text-gray-500 hover:bg-white/[0.06] hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {!selectedExpert && !experts.loading ? (
          <p className="py-4 text-center text-[10px] text-gray-500">选择一位专家以查看详情</p>
        ) : null}

        {tab === 'persona' && selectedExpert ? (
          <div className="space-y-2.5">
            <FieldBlock label="使命" body={selectedExpert.mission || '—'} />
            <FieldBlock
              label="风格规则"
              body={
                selectedExpert.styleRules?.length
                  ? selectedExpert.styleRules.map((r, i) => (
                      <li key={i} className="list-disc">
                        {r}
                      </li>
                    ))
                  : '—'
              }
              list
            />
            <FieldBlock
              label="禁忌"
              body={
                selectedExpert.taboos?.length
                  ? selectedExpert.taboos.map((r, i) => (
                      <li key={i} className="list-disc">
                        {r}
                      </li>
                    ))
                  : '—'
              }
              list
            />
            {pendingPatch ? (
              <div className="space-y-1.5 rounded-md bg-blue-500/10 p-2 ring-1 ring-blue-500/25">
                <p className="text-[10px] font-semibold text-blue-200">待确认人设改稿</p>
                <p className="text-[9px] text-blue-200/70">
                  baseVersion={pendingPatch.baseVersion}
                  {pendingPatch.mission != null ? ` · mission 将更新` : ''}
                  {pendingPatch.styleRules != null ? ` · styleRules 将更新` : ''}
                  {pendingPatch.taboos != null ? ` · taboos 将更新` : ''}
                  {pendingPatch.toolIds != null ? ` · toolIds 将更新` : ''}
                </p>
                {pendingPatch.mission != null ? (
                  <FieldBlock label="新使命" body={String(pendingPatch.mission)} />
                ) : null}
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={handleApplyPatch}
                  className="w-full rounded-md bg-blue-500/25 px-2 py-1.5 text-[10px] font-semibold text-blue-100 ring-1 ring-blue-400/30 transition-colors hover:bg-blue-500/35 disabled:opacity-40"
                >
                  确认应用改稿
                </button>
              </div>
            ) : (
              <p className="text-[9px] text-gray-600">无待确认改稿</p>
            )}
          </div>
        ) : null}

        {tab === 'memory' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-gray-500">
                {memories.loading ? '加载中…' : `${memories.data.length} 条`}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={refreshMemories}
                  className="rounded px-1.5 py-0.5 text-[9px] text-gray-500 hover:bg-white/[0.06] hover:text-gray-300"
                >
                  刷新
                </button>
                <button
                  type="button"
                  disabled={actionBusy || memories.data.length === 0}
                  onClick={handleClearMemories}
                  className="rounded px-1.5 py-0.5 text-[9px] text-red-300/80 hover:bg-red-500/15 disabled:opacity-35"
                >
                  清空
                </button>
              </div>
            </div>
            {memories.error ? (
              <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-200/90 ring-1 ring-amber-500/20">
                {memories.error}
              </p>
            ) : memories.data.length === 0 && !memories.loading ? (
              <p className="rounded-md border border-dashed border-white/[0.08] px-2 py-3 text-center text-[10px] text-gray-500">
                暂无记忆
              </p>
            ) : (
              <ul className="space-y-1.5">
                {memories.data.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-md bg-white/[0.03] px-2 py-1.5 ring-1 ring-white/[0.06]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="rounded bg-white/[0.06] px-1 py-px text-[8px] font-semibold uppercase text-gray-400">
                          {m.kind}
                        </span>
                        <p className="mt-1 whitespace-pre-wrap break-words text-[10px] text-gray-200">
                          {m.text || '—'}
                        </p>
                        <p className="mt-0.5 text-[8px] text-gray-600">{formatTs(m.createdAt)}</p>
                      </div>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => handleDeleteMemory(m.id)}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[9px] text-gray-500 hover:bg-white/[0.08] hover:text-red-300 disabled:opacity-35"
                      >
                        删除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {tab === 'artifacts' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500">
                {artifacts.loading ? '加载中…' : `最近 ${artifacts.data.length} 条`}
              </span>
              <button
                type="button"
                onClick={refreshArtifacts}
                className="rounded px-1.5 py-0.5 text-[9px] text-gray-500 hover:bg-white/[0.06] hover:text-gray-300"
              >
                刷新
              </button>
            </div>
            {artifacts.error ? (
              <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-200/90 ring-1 ring-amber-500/20">
                {artifacts.error}
              </p>
            ) : artifacts.data.length === 0 && !artifacts.loading ? (
              <p className="rounded-md border border-dashed border-white/[0.08] px-2 py-3 text-center text-[10px] text-gray-500">
                暂无产物
              </p>
            ) : (
              <ul className="space-y-1.5">
                {artifacts.data.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-md bg-white/[0.03] px-2 py-1.5 ring-1 ring-white/[0.06]"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[10px] font-semibold text-gray-200">
                        {a.kind || 'artifact'}
                      </span>
                      <span className="shrink-0 text-[8px] text-gray-600">
                        {formatTs(a.createdAt)}
                      </span>
                    </div>
                    {a.text ? (
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[9px] text-gray-400">
                        {a.text}
                      </p>
                    ) : null}
                    <p className="mt-0.5 truncate text-[8px] text-gray-600">{a.id}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void handleTryRun(a.id)}
                        className="rounded px-1.5 py-0.5 text-[9px] font-medium text-gray-300 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-35"
                      >
                        试跑
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void handlePromote(a)}
                        className="rounded px-1.5 py-0.5 text-[9px] font-medium text-blue-200/90 ring-1 ring-blue-400/25 transition-colors hover:bg-blue-500/20 disabled:opacity-35"
                      >
                        存为能力预设
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FieldBlock({
  label,
  body,
  list,
}: {
  label: string;
  body: React.ReactNode;
  list?: boolean;
}): React.ReactElement {
  return (
    <div>
      <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      {list && typeof body !== 'string' ? (
        <ul className="space-y-0.5 pl-3.5 text-[10px] text-gray-300">{body}</ul>
      ) : (
        <p className="whitespace-pre-wrap break-words text-[10px] text-gray-300">{body}</p>
      )}
    </div>
  );
}
