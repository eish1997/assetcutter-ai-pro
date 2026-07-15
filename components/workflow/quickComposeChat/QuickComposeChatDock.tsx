import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Minimize2, MoreHorizontal, PackagePlus, Trash2, Upload, X } from 'lucide-react';
import { newQuickComposeTextSegment } from '../../../services/quickComposeMention';
import type {
  AgentSuggestedAction,
  QuickComposeChatMessageView,
} from '../../../types/quickComposeThread';
import type {
  ProjectAgentKnowledgeEntry,
  AgentSkill,
} from '../../../types/projectAgent';
import { ExpertStudio } from '../../project-agent/ExpertStudio';
import { projectAgentKnowledgeKindLabel } from '../../../services/projectAgent/knowledgeStore';
import {
  agentSkillPermissionLabel,
  agentSkillSourceLabel,
  summarizeAgentSkillSafety,
} from '../../../services/projectAgent/skillRegistry';
import { WORKFLOW_QUICK_COMPOSE_DOCKED_WIDTH_CLASS } from '../workflowSectionUiConstants';
import {
  CLEAR_CHAT_BUSY_REASON,
  COMPOSER_BUSY_HINT,
  PROJECT_AGENT_EMPTY_HINT,
  PROJECT_AGENT_EMPTY_SUGGESTIONS,
  PROJECT_AGENT_EMPTY_TITLE,
  isRunningAssistantStatus,
} from './chatUiCopy';
import QuickComposeChatComposer, { type QuickComposeChatComposerProps } from './QuickComposeChatComposer';
import QuickComposeChatThread from './QuickComposeChatThread';

export type QuickComposeChatDockExpertStudioKey = {
  userId: string;
  workspaceProjectId: string;
};

export type QuickComposeChatDockPanelKey = 'memory' | 'skills';

export type QuickComposeChatDockProps = {
  /** Header title (default: 快捷生成) */
  title?: string;
  /** Collapse / minimize sidebar */
  onMinimize?: () => void;
  /** P25: clear / start a new chat; parent handles confirmation and archive. */
  onClearChat?: () => void;
  /**
   * Phase 5C: load earlier messages. Parent injects behavior; Dock does not fetch R2 directly.
   * Use `canLoadEarlier=false` to disable when there are no earlier messages.
   */
  onLoadEarlier?: () => void;
  /** Whether earlier messages can be loaded; parent controls disabled state. */
  canLoadEarlier?: boolean;
  /** Phase 5C: export compact JSON; parent injects browser download. */
  onExportChat?: () => void;
  /** Lightweight side-panel entries owned by the parent product surface. */
  onOpenPanel?: (panel: QuickComposeChatDockPanelKey) => void;
  /** Message thread (resolved view models with optional thumbs) */
  messages: QuickComposeChatMessageView[];
  onRetryMessage?: (messageId: string) => void;
  onMessageAction?: (messageId: string, action: AgentSuggestedAction) => void;
  onCancelMessage?: (messageId: string) => void;
  onResultPreview?: (assetId: string, event: React.MouseEvent<HTMLElement>) => void;
  selectionStatusLabel?: string;
  selectionStatusTone?: 'idle' | 'active' | 'preview';
  threadEmptyTitle?: string;
  threadEmptyHint?: string;
  className?: string;
  /** Disable minimize button (e.g. while submitting) */
  minimizeDisabled?: boolean;
  /**
   * Phase 4C: when provided, show ExpertStudio entry in the menu.
   * Omitting this hides the entry and does not affect sending.
   */
  expertStudio?: QuickComposeChatDockExpertStudioKey | null;
  /** ExpertStudio try-run: parent writes generated prompt text into quick compose. */
  onTryRunPrompt?: (text: string) => void;
  onEmptySuggestionClick?: (text: string) => void;
  emptyStateSuggestions?: string[];
  memoryEntries?: ProjectAgentKnowledgeEntry[];
  onToggleMemory?: (memoryId: string, enabled: boolean) => void;
  onDeleteMemory?: (memoryId: string) => void;
  skillEntries?: AgentSkill[];
  onToggleSkill?: (skillId: string, enabled: boolean) => void;
  onDeleteSkill?: (skillId: string) => void;
  onInstallSampleSkill?: () => void;
  onImportSkillPreview?: () => void;
} & QuickComposeChatComposerProps;

const SAMPLE_AGENT_SKILL: AgentSkill = {
  id: 'skill.product-shot-polish',
  name: 'Product Shot Polish',
  description: 'Turn selected product images into a short polish plan with preview-safe actions.',
  triggers: ['make these selected images look premium', 'polish this product shot'],
  toolIds: ['run_plain_i2i', 'run_preset'],
  permissionLevel: 'cost',
  enabled: true,
  source: 'local',
  createdAt: 1,
  safetyWarnings: ['执行前会走统一动作确认，不会绕过扣费或覆盖检查。'],
};

/**
 * Product Agent sidebar: header + selected target + composer controls + newest-first thread.
 */
export default function QuickComposeChatDock({
  title = '快捷生成',
  onMinimize,
  onClearChat,
  onLoadEarlier,
  canLoadEarlier = true,
  onExportChat,
  onOpenPanel,
  messages,
  onRetryMessage,
  onMessageAction,
  onCancelMessage,
  onResultPreview,
  selectionStatusLabel,
  selectionStatusTone = 'idle',
  threadEmptyTitle = PROJECT_AGENT_EMPTY_TITLE,
  threadEmptyHint = PROJECT_AGENT_EMPTY_HINT,
  className = '',
  minimizeDisabled = false,
  expertStudio = null,
  onTryRunPrompt,
  onEmptySuggestionClick,
  emptyStateSuggestions = PROJECT_AGENT_EMPTY_SUGGESTIONS,
  memoryEntries = [],
  onToggleMemory,
  onDeleteMemory,
  skillEntries = [],
  onToggleSkill,
  onDeleteSkill,
  onInstallSampleSkill,
  onImportSkillPreview,
  ...composerProps
}: QuickComposeChatDockProps) {
  const [expertStudioOpen, setExpertStudioOpen] = useState(false);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const [skillPanelOpen, setSkillPanelOpen] = useState(false);
  const [localSkillEntries, setLocalSkillEntries] = useState<AgentSkill[]>([]);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  const threadBusy = useMemo(
    () =>
      messages.some(
        (m) => m.role === 'assistant' && isRunningAssistantStatus(m.status)
      ),
    [messages]
  );
  const { onSegmentsChange } = composerProps;

  const handleDockDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = 'none';
    } catch {
      /* ignore */
    }
  }, []);
  const handleDockDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const canOpenExpertStudio = Boolean(
    expertStudio?.userId && expertStudio?.workspaceProjectId
  );
  const visibleSkillEntries = useMemo(() => {
    const byId = new Map<string, AgentSkill>();
    for (const entry of localSkillEntries) {
      if (entry.deletedAt == null) byId.set(entry.id, entry);
    }
    for (const entry of skillEntries) {
      if (entry.deletedAt == null) byId.set(entry.id, entry);
    }
    return Array.from(byId.values());
  }, [localSkillEntries, skillEntries]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (moreMenuRef.current?.contains(event.target as Node)) return;
      setMoreMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [moreMenuOpen]);

  const handleEmptySuggestionClick = useCallback(
    (text: string) => {
      if (onEmptySuggestionClick) {
        onEmptySuggestionClick(text);
        return;
      }
      onSegmentsChange([newQuickComposeTextSegment(text)]);
    },
    [onEmptySuggestionClick, onSegmentsChange]
  );

  const handleInstallSampleSkill = useCallback(() => {
    onInstallSampleSkill?.();
    if (!onInstallSampleSkill) {
      setLocalSkillEntries((prev) => {
        if (prev.some((entry) => entry.id === SAMPLE_AGENT_SKILL.id && entry.deletedAt == null)) {
          return prev;
        }
        return [{ ...SAMPLE_AGENT_SKILL, createdAt: Date.now(), updatedAt: Date.now() }, ...prev];
      });
    }
  }, [onInstallSampleSkill]);

  const handleImportSkillPreview = useCallback(() => {
    onImportSkillPreview?.();
    if (!onImportSkillPreview) setImportPreviewOpen(true);
  }, [onImportSkillPreview]);

  const handleToggleSkill = useCallback(
    (skillId: string, enabled: boolean) => {
      onToggleSkill?.(skillId, enabled);
      if (!onToggleSkill) {
        setLocalSkillEntries((prev) =>
          prev.map((entry) => (entry.id === skillId ? { ...entry, enabled } : entry))
        );
      }
    },
    [onToggleSkill]
  );

  const handleDeleteSkill = useCallback(
    (skillId: string) => {
      onDeleteSkill?.(skillId);
      if (!onDeleteSkill) {
        setLocalSkillEntries((prev) =>
          prev.map((entry) =>
            entry.id === skillId ? { ...entry, deletedAt: Date.now(), enabled: false } : entry
          )
        );
      }
    },
    [onDeleteSkill]
  );

  const moreActions = useMemo(
    () =>
      [
        {
          key: 'memory',
          label: '记忆管理',
          onClick: () => {
            setMemoryPanelOpen(true);
            onOpenPanel?.('memory');
          },
        },
        {
          key: 'skills',
          label: 'Skill 管理',
          onClick: () => {
            setSkillPanelOpen(true);
            onOpenPanel?.('skills');
          },
        },
        canOpenExpertStudio
          ? {
              key: 'expert',
              label: '专家工作室',
              onClick: () => setExpertStudioOpen(true),
            }
          : null,
        onLoadEarlier
          ? {
              key: 'load-earlier',
              label: canLoadEarlier ? '加载更早' : '没有更早消息',
              disabled: threadBusy || !canLoadEarlier,
              title: !canLoadEarlier
                ? '没有更早的消息'
                : threadBusy
                  ? CLEAR_CHAT_BUSY_REASON
                  : '加载更早',
              onClick: onLoadEarlier,
            }
          : null,
        onExportChat
          ? {
              key: 'export',
              label: '导出对话',
              onClick: onExportChat,
            }
          : null,
        onClearChat
          ? {
              key: 'clear',
              label: '清空对话',
              disabled: threadBusy,
              title: threadBusy ? CLEAR_CHAT_BUSY_REASON : '清空对话',
              onClick: onClearChat,
            }
          : null,
      ].filter(Boolean) as Array<{
        key: string;
        label: string;
        title?: string;
        disabled?: boolean;
        onClick: () => void;
      }>,
    [
      canLoadEarlier,
      canOpenExpertStudio,
      onClearChat,
      onExportChat,
      onOpenPanel,
      onLoadEarlier,
      threadBusy,
    ]
  );

  return (
    <aside
      className={`relative isolate z-[20] flex h-full min-h-0 flex-col self-stretch overflow-hidden border-l border-white/[0.08] bg-[#0f0f12] pointer-events-auto ${WORKFLOW_QUICK_COMPOSE_DOCKED_WIDTH_CLASS} ${className}`}
      data-workflow-quick-compose-chat-dock
      data-ac-block-workflow-marquee
      aria-label={title}
      onDragOver={handleDockDragOver}
      onDrop={handleDockDrop}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] bg-[#0f0f12] px-3 py-2.5">
        <h2 className="min-w-0 truncate text-[11px] font-black tracking-wide text-gray-300">
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-0.5">
          {moreActions.length > 0 ? (
            <div ref={moreMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setMoreMenuOpen((v) => !v)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/50"
                title="更多"
                aria-label="更多"
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
              >
                <MoreHorizontal className="h-4 w-4" strokeWidth={2.2} aria-hidden />
              </button>
              {moreMenuOpen ? (
                <div
                  className="absolute right-0 top-full z-[40] mt-1 w-32 overflow-hidden rounded-lg border border-white/10 bg-[#141417] py-1 shadow-xl shadow-black/30"
                  role="menu"
                >
                  {moreActions.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      role="menuitem"
                      disabled={action.disabled}
                      onClick={() => {
                        if (action.disabled) return;
                        action.onClick();
                        setMoreMenuOpen(false);
                      }}
                      className="flex w-full items-center px-2.5 py-2 text-left text-[11px] font-medium text-gray-300 outline-none transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:text-gray-600 focus-visible:bg-white/[0.08]"
                      title={action.title ?? action.label}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {onMinimize ? (
            <button
              type="button"
              disabled={minimizeDisabled}
              onClick={onMinimize}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/50"
              title="收起侧栏"
              aria-label="收起侧栏"
            >
              <Minimize2 className="h-4 w-4" strokeWidth={2.2} aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      <div
        className={`shrink-0 border-b px-3 py-1.5 text-[10px] font-semibold ${
          selectionStatusTone === 'preview'
            ? 'border-violet-300/10 bg-violet-300/[0.045] text-violet-100/80'
            : selectionStatusTone === 'active'
              ? 'border-cyan-300/10 bg-cyan-300/[0.045] text-cyan-100/80'
              : 'border-white/[0.06] bg-white/[0.025] text-gray-500'
        }`}
        data-agent-selection-status
      >
        <span className="block truncate">{selectionStatusLabel || '当前未选中资产'}</span>
      </div>

      <QuickComposeChatComposer
        {...composerProps}
        threadBusy={threadBusy}
        threadBusyHint={COMPOSER_BUSY_HINT}
      />

      <QuickComposeChatThread
        messages={messages}
        onRetryMessage={onRetryMessage}
        onMessageAction={onMessageAction}
        onCancelMessage={onCancelMessage}
        onResultPreview={onResultPreview}
        emptyStateTitle={threadEmptyTitle}
        emptyStateHint={threadEmptyHint}
        emptyStateSuggestions={emptyStateSuggestions}
        onEmptySuggestionClick={handleEmptySuggestionClick}
      />

      {expertStudioOpen && canOpenExpertStudio && expertStudio ? (
        <div
          className="absolute inset-0 z-[30] flex flex-col bg-[#0f0f12]/90 backdrop-blur-[2px]"
          data-expert-studio-overlay
          role="dialog"
          aria-modal="true"
          aria-label="专家工作室"
        >
          <ExpertStudio
            userId={expertStudio.userId}
            workspaceProjectId={expertStudio.workspaceProjectId}
            onClose={() => setExpertStudioOpen(false)}
            onTryRunPrompt={onTryRunPrompt}
          />
        </div>
      ) : null}

      {memoryPanelOpen ? (
        <div
          className="absolute inset-0 z-[30] flex flex-col bg-[#0f0f12]/95 backdrop-blur-[2px]"
          data-memory-management-overlay
          role="dialog"
          aria-modal="true"
          aria-label="记忆管理"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-cyan-300/15 bg-cyan-300/[0.08] text-cyan-100/90">
                <Brain className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-[11px] font-black text-gray-200">记忆管理</h3>
                <p className="truncate text-[10px] text-gray-500">产品知识、项目知识、用户偏好和资产规则</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMemoryPanelOpen(false)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/50"
              title="关闭"
              aria-label="关闭记忆管理"
            >
              <X className="h-4 w-4" strokeWidth={2.2} aria-hidden />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
            {memoryEntries.length > 0 ? (
              memoryEntries.map((entry) => {
                const enabled = entry.disabledAt == null;
                const kindLabel = projectAgentKnowledgeKindLabel(entry.kind);
                return (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <p className="min-w-0 truncate text-[11px] font-semibold text-gray-200">
                            {entry.label || kindLabel}
                          </p>
                          <span className="shrink-0 rounded-full border border-cyan-300/15 bg-cyan-300/[0.07] px-1.5 py-0.5 text-[9px] font-semibold text-cyan-100/75">
                            {kindLabel}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-3 text-[10px] leading-4 text-gray-500">
                          {entry.text}
                        </p>
                        <p className="mt-1 truncate text-[9px] text-gray-600">
                          {enabled ? '会参与 Agent 上下文' : '已暂停，不会参与上下文'}
                          {entry.sourceTurnId ? ` · 来源 ${entry.sourceTurnId}` : ''}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${
                          enabled
                            ? 'border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100/80'
                            : 'border-white/[0.08] bg-white/[0.04] text-gray-500'
                        }`}
                      >
                        {enabled ? '启用' : '暂停'}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      {onToggleMemory ? (
                        <button
                          type="button"
                          onClick={() => onToggleMemory(entry.id, !enabled)}
                          className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] font-semibold text-gray-300 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/45"
                        >
                          {enabled ? '暂停参与上下文' : '重新启用'}
                        </button>
                      ) : null}
                      {onDeleteMemory ? (
                        <button
                          type="button"
                          onClick={() => onDeleteMemory(entry.id)}
                          className="rounded-md border border-rose-300/15 bg-rose-300/[0.05] px-2 py-1 text-[10px] font-semibold text-rose-100/75 outline-none transition-colors hover:bg-rose-300/[0.1] hover:text-rose-50 focus-visible:ring-2 focus-visible:ring-rose-400/45"
                        >
                          删除
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2.5">
                <p className="text-[11px] font-semibold text-gray-200">还没有保存的项目记忆</p>
                <p className="mt-1 text-[10px] leading-4 text-gray-500">
                  从结果卡确认保存后，产品知识、项目目标、用户偏好和资产规则会出现在这里，并可随时暂停或删除。
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {skillPanelOpen ? (
        <div
          className="absolute inset-0 z-[30] flex flex-col bg-[#0f0f12]/95 backdrop-blur-[2px]"
          data-skill-registry-overlay
          role="dialog"
          aria-modal="true"
          aria-label="Skill 管理"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-violet-300/15 bg-violet-300/[0.08] text-violet-100/90">
                <PackagePlus className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-[11px] font-black text-gray-200">Skill 管理</h3>
                <p className="truncate text-[10px] text-gray-500">可启用、暂停或移除 Project Agent 能力</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSkillPanelOpen(false)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/50"
              title="关闭"
              aria-label="关闭 Skill 管理"
            >
              <X className="h-4 w-4" strokeWidth={2.2} aria-hidden />
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 border-b border-white/[0.06] px-3 py-2">
            <button
              type="button"
              onClick={handleInstallSampleSkill}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 text-[10px] font-semibold text-gray-200 outline-none transition-colors hover:bg-white/[0.09] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/45"
            >
              <PackagePlus className="h-3.5 w-3.5" strokeWidth={2.1} aria-hidden />
              安装示例 Skill
            </button>
            <button
              type="button"
              onClick={handleImportSkillPreview}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[10px] font-semibold text-gray-300 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/45"
            >
              <Upload className="h-3.5 w-3.5" strokeWidth={2.1} aria-hidden />
              导入预览
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
            {importPreviewOpen ? (
              <div className="rounded-lg border border-amber-300/15 bg-amber-300/[0.055] px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-amber-50/90">导入预览已保留</p>
                    <p className="mt-1 line-clamp-3 text-[10px] leading-4 text-amber-100/60">
                      后续服务会在这里展示权限、工具白名单和风险检查；未确认前不会执行。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setImportPreviewOpen(false)}
                    className="shrink-0 rounded-md px-1.5 py-1 text-[10px] font-semibold text-amber-100/70 outline-none hover:bg-amber-100/[0.08] hover:text-amber-50 focus-visible:ring-2 focus-visible:ring-amber-400/45"
                  >
                    收起
                  </button>
                </div>
              </div>
            ) : null}
            {visibleSkillEntries.length > 0 ? (
              visibleSkillEntries.map((skill) => {
                const enabled = skill.enabled !== false;
                const triggers = skill.triggers.slice(0, 3).join(' / ');
                const allowedTools = skill.toolIds.slice(0, 3).join(' / ');
                const safety = summarizeAgentSkillSafety(skill);
                return (
                  <div
                    key={skill.id}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <p className="min-w-0 truncate text-[11px] font-semibold text-gray-200">
                            {skill.name}
                          </p>
                          <span className="shrink-0 rounded-full border border-violet-300/15 bg-violet-300/[0.08] px-1.5 py-0.5 text-[9px] font-semibold text-violet-100/75">
                            {agentSkillSourceLabel(skill.source)}
                          </span>
                          <span
                            className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${
                              skill.permissionLevel === 'destructive'
                                ? 'border-rose-300/20 bg-rose-300/[0.08] text-rose-100/80'
                                : skill.permissionLevel === 'cost'
                                  ? 'border-amber-300/20 bg-amber-300/[0.08] text-amber-100/80'
                                  : 'border-white/[0.08] bg-white/[0.04] text-gray-400'
                            }`}
                          >
                            {agentSkillPermissionLabel(skill.permissionLevel)}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-gray-500">
                          {skill.description}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${
                          enabled
                            ? 'border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100/80'
                            : 'border-white/[0.08] bg-white/[0.04] text-gray-500'
                        }`}
                      >
                        {enabled ? '启用' : '暂停'}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 text-[9px] leading-4 text-gray-500">
                      <div className="truncate">触发词：{triggers || skill.name}</div>
                      <div className="truncate">白名单工具：{allowedTools || '无'}</div>
                      <div className="truncate" title={safety.details.join(' / ')}>
                        安全：{safety.label}
                        {skill.safetyWarnings?.length ? ` · ${skill.safetyWarnings[0]}` : ''}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleSkill(skill.id, !enabled)}
                        className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] font-semibold text-gray-300 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/45"
                      >
                        {enabled ? '禁用' : '启用'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSkill(skill.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-300/15 bg-rose-300/[0.05] px-2 py-1 text-[10px] font-semibold text-rose-100/75 outline-none transition-colors hover:bg-rose-300/[0.1] hover:text-rose-50 focus-visible:ring-2 focus-visible:ring-rose-400/45"
                      >
                        <Trash2 className="h-3 w-3" strokeWidth={2.1} aria-hidden />
                        删除
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2.5">
                <p className="text-[11px] font-semibold text-gray-200">还没有已安装 Skill</p>
                <p className="mt-1 text-[10px] leading-4 text-gray-500">
                  可以先安装示例，或用导入预览检查外部 Skill 的权限和风险。
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export type { QuickComposeChatComposerProps };
