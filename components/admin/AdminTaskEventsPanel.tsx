import React from 'react';
import { fetchTaskExecutionEvents, type TaskExecutionEvent } from '../../services/adminClient';
import { AUDITOR_ROLE_SLUG } from '../../services/adminPermissions';
import { useAdminStaff } from './AdminStaffContext';
import {
  TASK_EVENT_LEVEL_OPTIONS,
  taskEventCodeLabel,
  taskEventLevelDot,
  taskEventSummary,
} from '../../services/taskEventSummary';
import {
  AUDIT_TIME_PRESETS,
  isoToDatetimeLocal,
  resolveAuditTimeRange,
  type AuditTimePreset,
} from '../../services/auditLogTimeRange';
import { CustomDropdown } from '../ui/CustomDropdown';
import ObservabilityTraceDrawer from './ObservabilityTraceDrawer';

const PAGE_SIZE = 50;

type TaskFilters = {
  timePreset: AuditTimePreset;
  customFrom: string;
  customTo: string;
  userId: string;
  level: '' | 'info' | 'warn' | 'error';
  code: string;
  taskId: string;
};

function defaultFilters(): TaskFilters {
  const range = resolveAuditTimeRange('7d', '', '');
  return {
    timePreset: '7d',
    customFrom: isoToDatetimeLocal(range.from),
    customTo: isoToDatetimeLocal(range.to),
    userId: '',
    level: '',
    code: '',
    taskId: '',
  };
}

function readUserIdFromUrl(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return params.get('userId')?.trim() || params.get('targetUserId')?.trim() || '';
}

function readTaskIdFromUrl(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return params.get('taskId')?.trim() || params.get('correlationId')?.trim() || '';
}

function filtersToQuery(filters: TaskFilters, cursor?: string) {
  const { from, to } = resolveAuditTimeRange(filters.timePreset, filters.customFrom, filters.customTo);
  return {
    limit: PAGE_SIZE,
    userId: filters.userId.trim() || undefined,
    from: from || undefined,
    to: to || undefined,
    level: filters.level || undefined,
    code: filters.code.trim() || undefined,
    taskId: filters.taskId.trim() || undefined,
    cursor,
  };
}

const TaskEventDetailDrawer: React.FC<{
  event: TaskExecutionEvent | null;
  redacted?: boolean;
  onClose: () => void;
  onOpenTrace?: (taskId: string) => void;
}> = ({ event, redacted, onClose, onOpenTrace }) => {
  if (!event) return null;
  return (
    <div className="fixed inset-0 z-[120] flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="关闭" />
      <aside className="relative w-full max-w-md h-full bg-[#121214] border-l border-[#2e2e32] overflow-y-auto p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500">任务执行详情</p>
            <p className="mt-1 text-[12px] text-white font-medium">{taskEventCodeLabel(event.code)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 rounded border border-[#2e2e32] text-[10px] text-gray-400"
          >
            关闭
          </button>
        </div>
        <dl className="space-y-2 text-[11px]">
          <div>
            <dt className="text-gray-500">时间</dt>
            <dd className="text-gray-200">{new Date(event.ts).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-gray-500">用户</dt>
            <dd className="text-gray-200">{event.username || event.userId || '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">级别</dt>
            <dd className="text-gray-200">{event.level}</dd>
          </div>
          <div>
            <dt className="text-gray-500">消息</dt>
            <dd className="text-gray-200 whitespace-pre-wrap break-words">{event.message}</dd>
          </div>
          {!redacted && event.taskId ? (
            <div>
              <dt className="text-gray-500">任务 ID</dt>
              <dd className="text-gray-400 font-mono text-[10px] break-all">{event.taskId}</dd>
              {onOpenTrace ? (
                <button
                  type="button"
                  onClick={() => onOpenTrace(event.taskId!)}
                  className="mt-1 text-[9px] text-blue-400/90 hover:text-blue-300"
                >
                  查看 Trace
                </button>
              ) : null}
            </div>
          ) : null}
          {!redacted && event.assetId ? (
            <div>
              <dt className="text-gray-500">资产 ID</dt>
              <dd className="text-gray-400 font-mono text-[10px] break-all">{event.assetId}</dd>
            </div>
          ) : null}
        </dl>
        {!redacted && event.detail ? (
          <pre className="rounded-xl border border-[#2e2e32] bg-[#0f0f0f] p-3 text-[10px] text-gray-300 overflow-x-auto">
            {JSON.stringify(event.detail, null, 2)}
          </pre>
        ) : null}
      </aside>
    </div>
  );
};

const AdminTaskEventsPanel: React.FC = () => {
  const { staffRole } = useAdminStaff();
  const isAuditor = staffRole?.slug === AUDITOR_ROLE_SLUG;
  const [draft, setDraft] = React.useState<TaskFilters>(() => {
    const base = defaultFilters();
    const userId = readUserIdFromUrl();
    const taskId = readTaskIdFromUrl();
    return { ...base, ...(userId ? { userId } : {}), ...(taskId ? { taskId } : {}) };
  });
  const [applied, setApplied] = React.useState(draft);
  const [events, setEvents] = React.useState<TaskExecutionEvent[]>([]);
  const [total, setTotal] = React.useState(0);
  const [cursor, setCursor] = React.useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = React.useState<string[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [redactedView, setRedactedView] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [selected, setSelected] = React.useState<TaskExecutionEvent | null>(null);
  const [traceTaskId, setTraceTaskId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchTaskExecutionEvents(filtersToQuery(applied, cursor));
      setEvents(res.events);
      setTotal(res.total ?? res.events.length);
      setNextCursor(res.nextCursor ?? null);
      setRedactedView(Boolean(res.redacted));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [applied, cursor]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const resetPagination = () => {
    setCursor(undefined);
    setCursorStack([]);
    setNextCursor(null);
  };

  const applyFilters = (next: TaskFilters) => {
    setApplied(next);
    resetPagination();
  };

  const page = cursorStack.length + 1;
  const canPrev = cursorStack.length > 0;
  const canNext = Boolean(nextCursor);

  const renderRow = (item: TaskExecutionEvent) => {
    const summary = taskEventSummary(item);
    return (
      <tr
        key={`${item.source}:${item.id}`}
        className="border-t border-[#252528] hover:bg-[#151518]/60 cursor-pointer"
        onClick={() => setSelected(item)}
      >
        <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{new Date(item.ts).toLocaleString()}</td>
        <td className="px-3 py-2 text-gray-200 leading-relaxed">{summary}</td>
        <td className="px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-gray-400">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${taskEventLevelDot(item.level)}`} />
            {taskEventCodeLabel(item.code)}
          </span>
        </td>
        <td className="px-3 py-2 text-gray-300">{item.username || '—'}</td>
      </tr>
    );
  };

  const renderCard = (item: TaskExecutionEvent) => (
    <button
      key={`${item.source}:${item.id}`}
      type="button"
      onClick={() => setSelected(item)}
      className="w-full text-left px-3 py-3 border-t border-[#252528] hover:bg-[#151518]/60 space-y-1"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] text-gray-400">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${taskEventLevelDot(item.level)}`} />
          {taskEventCodeLabel(item.code)}
        </span>
        <span className="text-[10px] text-gray-500">{new Date(item.ts).toLocaleString()}</span>
      </div>
      <p className="text-[11px] text-gray-200">{taskEventSummary(item)}</p>
      <p className="text-[10px] text-gray-500">{item.username || '—'}</p>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">任务执行记录</h2>
            <p className="mt-1 text-[10px] text-gray-600">
              工作流队列 RUN_TASK 与分镜表 STORYBOARD 大模型/生图任务（须用户已登录执行）
            </p>
            {redactedView ? (
              <p className="mt-1 text-[10px] text-amber-500/90">当前为审计员脱敏视图</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] hover:bg-[#2e2e36]"
          >
            刷新
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {AUDIT_TIME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                const range = resolveAuditTimeRange(preset.id, draft.customFrom, draft.customTo);
                setDraft((p) => ({
                  ...p,
                  timePreset: preset.id,
                  customFrom: preset.id === 'custom' ? p.customFrom : isoToDatetimeLocal(range.from),
                  customTo: preset.id === 'custom' ? p.customTo : isoToDatetimeLocal(range.to),
                }));
              }}
              className={`px-3 py-1.5 rounded-lg text-[10px] border ${
                draft.timePreset === preset.id
                  ? 'border-[#4b5563] bg-[#2e2e36] text-gray-200'
                  : 'border-[#2e2e32] bg-[#1c1c22] text-gray-500 hover:bg-[#252528]'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {draft.timePreset === 'custom' ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[10px] text-gray-500">
              起始
              <input
                type="datetime-local"
                value={draft.customFrom}
                onChange={(e) => setDraft((p) => ({ ...p, customFrom: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-[#343438] bg-[#1c1c22] px-3 py-2 text-[11px] text-white outline-none focus:border-[#3b82f6]"
              />
            </label>
            <label className="text-[10px] text-gray-500">
              结束
              <input
                type="datetime-local"
                value={draft.customTo}
                onChange={(e) => setDraft((p) => ({ ...p, customTo: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-[#343438] bg-[#1c1c22] px-3 py-2 text-[11px] text-white outline-none focus:border-[#3b82f6]"
              />
            </label>
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <CustomDropdown
            value={draft.level}
            options={TASK_EVENT_LEVEL_OPTIONS}
            onChange={(v) => setDraft((p) => ({ ...p, level: v as TaskFilters['level'] }))}
            triggerAriaLabel="级别"
          />
          <input
            type="text"
            placeholder="用户 ID 或用户名"
            value={draft.userId}
            onChange={(e) => setDraft((p) => ({ ...p, userId: e.target.value }))}
            className="rounded-xl border border-[#343438] bg-[#1c1c22] px-3 py-2 text-[11px] text-white outline-none focus:border-[#3b82f6]"
          />
          <input
            type="text"
            placeholder="代码关键词"
            value={draft.code}
            onChange={(e) => setDraft((p) => ({ ...p, code: e.target.value }))}
            className="rounded-xl border border-[#343438] bg-[#1c1c22] px-3 py-2 text-[11px] text-white outline-none focus:border-[#3b82f6]"
          />
          <input
            type="text"
            placeholder="任务 ID（correlationId）"
            value={draft.taskId}
            onChange={(e) => setDraft((p) => ({ ...p, taskId: e.target.value }))}
            className="rounded-xl border border-[#343438] bg-[#1c1c22] px-3 py-2 text-[11px] text-white outline-none focus:border-[#3b82f6] font-mono"
          />
        </div>

        <button
          type="button"
          onClick={() => applyFilters(draft)}
          className="px-4 py-2 rounded-xl bg-[#3b82f6] text-[11px] font-medium text-white hover:bg-[#2563eb]"
        >
          查询
        </button>
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      {loading ? (
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-6 text-[11px] text-gray-400">加载中…</div>
      ) : (
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-[#151518] text-gray-400">
                <tr>
                  <th className="text-left px-3 py-2 w-[140px]">时间</th>
                  <th className="text-left px-3 py-2">摘要</th>
                  <th className="text-left px-3 py-2 w-[140px]">代码</th>
                  <th className="text-left px-3 py-2 w-[100px]">用户</th>
                </tr>
              </thead>
              <tbody>{events.map(renderRow)}</tbody>
            </table>
          </div>
          <div className="md:hidden">{events.map(renderCard)}</div>
          {!events.length ? (
            <p className="px-3 py-4 text-[11px] text-gray-500 leading-relaxed">
              暂无记录{isAuditor ? '' : '。请确认：① 用户已登录 ② 通过工作区队列执行任务 ③ 时间范围覆盖执行日；可尝试「近 30 天」并清空用户筛选后点查询'}
            </p>
          ) : null}
          <div className="flex items-center justify-between px-3 py-3 border-t border-[#252528] text-[10px] text-gray-500">
            <span>共 {total} 条 · 第 {page} 页</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!canPrev}
                onClick={() => {
                  if (!cursorStack.length) return;
                  const prev = cursorStack[cursorStack.length - 1];
                  setCursorStack((stack) => stack.slice(0, -1));
                  setCursor(prev || undefined);
                }}
                className="px-2 py-1 rounded border border-[#2e2e32] disabled:opacity-40"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={!canNext}
                onClick={() => {
                  if (!nextCursor) return;
                  setCursorStack((stack) => [...stack, cursor ?? '']);
                  setCursor(nextCursor);
                }}
                className="px-2 py-1 rounded border border-[#2e2e32] disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      )}

      <TaskEventDetailDrawer
        event={selected}
        redacted={redactedView}
        onClose={() => setSelected(null)}
        onOpenTrace={(taskId) => {
          setSelected(null);
          setTraceTaskId(taskId);
        }}
      />
      <ObservabilityTraceDrawer correlationId={traceTaskId} onClose={() => setTraceTaskId(null)} />
    </div>
  );
};

export default AdminTaskEventsPanel;
