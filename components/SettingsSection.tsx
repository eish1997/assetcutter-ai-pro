import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SidebarAccountAvatar } from './SidebarAccountAvatar';
import { useUserUiPrefs } from '../hooks/useUserUiPrefs';
import {
  setUserUiPrefs,
  sanitizeAvatarUrl,
  MAX_AVATAR_DATA_URL_CHARS,
} from '../services/userUiPrefs';
import {
  getUserApiKey,
  setUserApiKey,
  DEFAULT_AI_PROVIDER,
  getAiProvider,
  setAiProvider,
  getToapisApiKey,
  setToapisApiKey,
  getToapisBaseUrl,
  setToapisBaseUrl,
  getAntigravityApiKey,
  setAntigravityApiKey,
  getAntigravityBaseUrl,
  setAntigravityBaseUrl,
  getVectorengineApiKey,
  setVectorengineApiKey,
  getVectorengineBaseUrl,
  setVectorengineBaseUrl,
  type AiProvider,
  getTencentSecretId,
  setTencentSecretId as saveTencentSecretId,
  getTencentSecretKey,
  setTencentSecretKey as saveTencentSecretKey,
  subscribeAiSettingsCrossTab,
} from '../services/settingsStore';
import { isWorkspaceCloudEnabled } from '../services/workspaceCloudSync';
import {
  getCompanionLocalBaseUrl,
  getCompanionLocalToken,
  setCompanionLocalBaseUrl,
  setCompanionLocalToken,
  normalizeCompanionBaseUrl,
} from '../services/companionLocalPrefs';
import {
  createCompanionJobEventStream,
  listCompanionProjects,
  listCompanionJobEvents,
  type CompanionJobEventV1,
  probeCompanionCapabilities,
  probeCompanionHealth,
} from '../services/companionClient';
import {
  clearCompanionJobCursor,
  getCompanionJobCursor,
  setCompanionJobCursor,
} from '../services/companionJobCursorStore';
import {
  clearCompanionJobTerminalEvent,
  getCompanionJobTerminalEvent,
  saveCompanionJobTerminalEvent,
} from '../services/companionJobTerminalStore';
import { companionJobStatusHuman } from '../services/companionJobStatusHuman';
import { CustomDropdown, DROPDOWN_TRIGGER_COMPACT } from './ui/CustomDropdown';
import type { AuthUser } from '../services/authClient';

const SETTINGS_NAV: { id: string; label: string }[] = [
  { id: 'settings-user', label: '用户' },
  { id: 'settings-storage', label: '数据与存储' },
  { id: 'settings-companion', label: '本地伴侣' },
  { id: 'settings-api', label: 'API' },
];

const AI_PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
  { value: 'trial', label: '试用（代理通道，无需本地 Key）' },
  { value: 'gemini', label: 'Google Gemini（官方 API）' },
  { value: 'vertex', label: 'Vertex AI（GCP · 经本站 gemini-proxy）' },
  { value: 'toapis', label: 'ToAPIs 网关（OpenAI 兼容 + 异步生图）' },
  { value: 'antigravity', label: 'Antigravity Tools（本机 OpenAI 兼容反代）' },
  { value: 'vectorengine', label: '向量引擎 VectorEngine（Gemini 原生 REST）' },
];

const COMPANION_SETTINGS_STREAM_STATE_KEY = 'ac_companion_settings_stream_state_v2';

const TERMINAL_JOB_EVENT_TYPES = new Set<CompanionJobEventV1['type']>([
  'reply.completed',
  'task.failed',
  'task.cancelled',
]);

const SettingsSection: React.FC<{
  currentUser?: AuthUser | null;
  authLoading?: boolean;
  onRefreshUser?: () => Promise<void>;
  onLogout?: () => Promise<void>;
  /** 切换 AI 供应商后通知父级刷新顶栏等平台文案 */
  onAiInvocationSurfaceChange?: () => void;
  /**
   * 与 App 内 `aiInvocationStatusRev` 同步：云端拉取 user-config、工作流密钥弹窗保存等会递增，
   * 避免设置页仍显示旧的供应商/Key（与 `getAiProvider()` 真相源不一致）。
   */
  aiSettingsSyncRev?: number;
}> = ({ currentUser = null, authLoading = false, onRefreshUser, onLogout, onAiInvocationSurfaceChange, aiSettingsSyncRev = 0 }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [aiProvider, setAiProviderState] = useState<AiProvider>(DEFAULT_AI_PROVIDER);
  const [apiKey, setApiKey] = useState('');
  const [toapisApiKey, setToapisApiKeyState] = useState('');
  const [toapisBaseUrl, setToapisBaseUrlState] = useState('');
  const [antigravityApiKey, setAntigravityApiKeyState] = useState('');
  const [antigravityBaseUrl, setAntigravityBaseUrlState] = useState('');
  const [vectorengineApiKey, setVectorengineApiKeyState] = useState('');
  const [vectorengineBaseUrl, setVectorengineBaseUrlState] = useState('');
  const [tencentSecretId, setTencentSecretId] = useState('');
  const [tencentSecretKey, setTencentSecretKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [tencentSaved, setTencentSaved] = useState(false);
  const [userActionBusy, setUserActionBusy] = useState<'refresh' | 'logout' | null>(null);
  const [userActionMsg, setUserActionMsg] = useState<string>('');
  const userUiPrefs = useUserUiPrefs();
  const [avatarLinkDraft, setAvatarLinkDraft] = useState('');
  const [prefsUiHint, setPrefsUiHint] = useState('');
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const [companionBaseDraft, setCompanionBaseDraft] = useState('');
  const [companionTokenDraft, setCompanionTokenDraft] = useState('');
  const [companionProbeBusy, setCompanionProbeBusy] = useState(false);
  const [companionProbeHint, setCompanionProbeHint] = useState('');
  const [companionHealthSnippet, setCompanionHealthSnippet] = useState('');
  const [companionCapSnippet, setCompanionCapSnippet] = useState('');
  const [companionRelaySnippet, setCompanionRelaySnippet] = useState('');
  const [companionSeamSnippet, setCompanionSeamSnippet] = useState('');
  const [companionProjectsBusy, setCompanionProjectsBusy] = useState(false);
  const [companionProjectsSnippet, setCompanionProjectsSnippet] = useState('');
  const [companionJobIdDraft, setCompanionJobIdDraft] = useState('');
  const [companionJobEventsBusy, setCompanionJobEventsBusy] = useState(false);
  const [companionJobEvents, setCompanionJobEvents] = useState<CompanionJobEventV1[]>([]);
  const [companionJobAfterSeq, setCompanionJobAfterSeq] = useState(0);
  const [companionJobEventsHint, setCompanionJobEventsHint] = useState('');
  const [companionJobEventsAuto, setCompanionJobEventsAuto] = useState(false);
  const [companionStreamMode, setCompanionStreamMode] = useState<'idle' | 'sse' | 'poll'>('idle');

  useEffect(() => {
    const u = userUiPrefs.avatarUrl.trim();
    setAvatarLinkDraft(/^https?:\/\//i.test(u) ? u : '');
  }, [userUiPrefs.avatarUrl]);

  useEffect(() => {
    setCompanionBaseDraft(getCompanionLocalBaseUrl());
    setCompanionTokenDraft(getCompanionLocalToken());
  }, []);

  useEffect(() => {
    try {
      const raw = globalThis.localStorage?.getItem(COMPANION_SETTINGS_STREAM_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        jobId?: string;
        afterSeq?: number;
        auto?: boolean;
      };
      if (parsed.jobId) setCompanionJobIdDraft(parsed.jobId);
      if (Number.isFinite(parsed.afterSeq)) setCompanionJobAfterSeq(Math.max(0, Math.floor(parsed.afterSeq ?? 0)));
      if (typeof parsed.auto === 'boolean') setCompanionJobEventsAuto(parsed.auto);
      if (parsed.jobId) {
        const sharedCursor = getCompanionJobCursor(parsed.jobId);
        if (sharedCursor > 0) {
          setCompanionJobAfterSeq((prev) => Math.max(prev, sharedCursor));
        }
        const snap = getCompanionJobTerminalEvent(parsed.jobId);
        if (snap && TERMINAL_JOB_EVENT_TYPES.has(snap.type)) {
          setCompanionJobEvents([snap]);
          setCompanionJobAfterSeq((prev) => Math.max(prev, snap.seq));
        }
      }
    } catch {
      /* ignore malformed session state */
    }
  }, []);

  useEffect(() => {
    try {
      const payload = JSON.stringify({
        jobId: companionJobIdDraft.trim(),
        afterSeq: companionJobAfterSeq,
        auto: companionJobEventsAuto,
      });
      globalThis.localStorage?.setItem(COMPANION_SETTINGS_STREAM_STATE_KEY, payload);
      const jid = companionJobIdDraft.trim();
      if (jid) setCompanionJobCursor(jid, companionJobAfterSeq);
    } catch {
      /* ignore */
    }
  }, [companionJobAfterSeq, companionJobEventsAuto, companionJobIdDraft]);

  const reloadApiSettingsFromStore = useCallback(() => {
    setAiProviderState(getAiProvider());
    setApiKey(getUserApiKey() ?? '');
    setToapisApiKeyState(getToapisApiKey() ?? '');
    setToapisBaseUrlState(getToapisBaseUrl());
    setAntigravityApiKeyState(getAntigravityApiKey() ?? '');
    setAntigravityBaseUrlState(getAntigravityBaseUrl());
    setVectorengineApiKeyState(getVectorengineApiKey() ?? '');
    setVectorengineBaseUrlState(getVectorengineBaseUrl());
    setTencentSecretId(getTencentSecretId() ?? '');
    setTencentSecretKey(getTencentSecretKey() ?? '');
  }, []);

  useEffect(() => {
    reloadApiSettingsFromStore();
  }, [aiSettingsSyncRev, reloadApiSettingsFromStore]);

  useEffect(() => {
    return subscribeAiSettingsCrossTab(reloadApiSettingsFromStore);
  }, [reloadApiSettingsFromStore]);

  const handleSaveApiKey = () => {
    setUserApiKey(apiKey.trim() || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveToapis = () => {
    setToapisApiKey(toapisApiKey.trim() || null);
    setToapisBaseUrl(toapisBaseUrl.trim() || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveAntigravity = () => {
    setAntigravityApiKey(antigravityApiKey.trim() || null);
    setAntigravityBaseUrl(antigravityBaseUrl.trim() || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveVectorengine = () => {
    setVectorengineApiKey(vectorengineApiKey.trim() || null);
    setVectorengineBaseUrl(vectorengineBaseUrl.trim() || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAiProviderChange = (value: string) => {
    const v: AiProvider =
      value === 'trial'
        ? 'trial'
        : value === 'vertex'
        ? 'vertex'
        : value === 'toapis'
          ? 'toapis'
          : value === 'antigravity'
            ? 'antigravity'
            : value === 'vectorengine'
              ? 'vectorengine'
              : 'gemini';
    setAiProviderState(v);
    setAiProvider(v);
    onAiInvocationSurfaceChange?.();
  };

  const handleSaveTencent = () => {
    saveTencentSecretId(tencentSecretId.trim() || null);
    saveTencentSecretKey(tencentSecretKey.trim() || null);
    setTencentSaved(true);
    setTimeout(() => setTencentSaved(false), 2000);
  };

  const scrollToSection = (id: string) => {
    const el = contentRef.current?.querySelector(`#${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleRefreshUser = async () => {
    if (!onRefreshUser || userActionBusy) return;
    setUserActionBusy('refresh');
    setUserActionMsg('');
    try {
      await onRefreshUser();
      setUserActionMsg('用户信息已刷新');
    } catch (e) {
      setUserActionMsg(`刷新失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUserActionBusy(null);
    }
  };

  const handleLogout = async () => {
    if (!onLogout || userActionBusy) return;
    setUserActionBusy('logout');
    setUserActionMsg('');
    try {
      await onLogout();
      setUserActionMsg('已退出登录');
    } catch (e) {
      setUserActionMsg(`退出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUserActionBusy(null);
    }
  };

  const handleSaveCompanionBase = () => {
    setCompanionLocalBaseUrl(companionBaseDraft);
    setCompanionBaseDraft(getCompanionLocalBaseUrl());
    setCompanionProbeHint('已保存本机探测地址');
    setTimeout(() => setCompanionProbeHint(''), 2500);
  };

  const handleSaveCompanionToken = () => {
    setCompanionLocalToken(companionTokenDraft);
    setCompanionTokenDraft(getCompanionLocalToken());
    setCompanionProbeHint('已保存。请与本机伴侣里填写的本机通信密码一致，网站才能正常调用本机。');
    setTimeout(() => setCompanionProbeHint(''), 2500);
  };

  const handleProbeCompanion = async () => {
    const base = normalizeCompanionBaseUrl(companionBaseDraft);
    setCompanionProbeBusy(true);
    setCompanionProbeHint('');
    setCompanionHealthSnippet('');
    setCompanionCapSnippet('');
    setCompanionRelaySnippet('');
    setCompanionSeamSnippet('');
    try {
      const [h, c] = await Promise.all([probeCompanionHealth(base), probeCompanionCapabilities(base)]);
      const parts: string[] = [];
      if (h.ok) {
        parts.push(`健康检查：成功${h.latencyMs != null ? `（${h.latencyMs}ms）` : ''}`);
        setCompanionHealthSnippet(
          typeof h.body === 'string' ? h.body.slice(0, 800) : JSON.stringify(h.body, null, 2).slice(0, 1200),
        );
      } else {
        parts.push(`健康检查：失败 — ${h.error ?? '未知错误'}`);
      }
      if (c.ok) {
        parts.push(`能力清单：成功${c.latencyMs != null ? `（${c.latencyMs}ms）` : ''}`);
        setCompanionCapSnippet(
          typeof c.body === 'string' ? c.body.slice(0, 800) : JSON.stringify(c.body, null, 2).slice(0, 1200),
        );
        if (c.body && typeof c.body === 'object' && !Array.isArray(c.body)) {
          const cap = c.body as Record<string, unknown>;
          const relay = cap.relay;
          const compute = cap.compute as Record<string, unknown> | undefined;
          const seamRepair = compute?.seamRepair;
          setCompanionRelaySnippet(relay != null ? JSON.stringify(relay, null, 2) : '（capabilities 无 relay）');
          setCompanionSeamSnippet(
            seamRepair != null ? JSON.stringify(seamRepair, null, 2) : '（capabilities.compute 无 seamRepair）',
          );
        }
      } else {
        parts.push(`能力清单：失败 — ${c.error ?? '未知错误'}`);
      }
      setCompanionProbeHint(parts.join('；'));
    } finally {
      setCompanionProbeBusy(false);
    }
  };

  const companionConsoleHref = `${normalizeCompanionBaseUrl(companionBaseDraft)}/`;

  const handleListCompanionProjects = async () => {
    const base = normalizeCompanionBaseUrl(companionBaseDraft);
    setCompanionProjectsBusy(true);
    setCompanionProjectsSnippet('');
    try {
      const r = await listCompanionProjects(base);
      if (r.ok === false) {
        setCompanionProjectsSnippet(`失败：${r.error}${r.status != null ? `（HTTP ${r.status}）` : ''}`);
        return;
      }
      setCompanionProjectsSnippet(JSON.stringify(r.data, null, 2));
    } catch (e) {
      setCompanionProjectsSnippet(String(e));
    } finally {
      setCompanionProjectsBusy(false);
    }
  };

  const pullCompanionJobEvents = useCallback(
    async (resetCursor = false) => {
      const jobId = companionJobIdDraft.trim();
      if (!jobId) {
        setCompanionJobEventsHint('请先填写任务编号');
        return;
      }
      const base = normalizeCompanionBaseUrl(companionBaseDraft);
      setCompanionJobEventsBusy(true);
      setCompanionJobEventsHint('');
      const sharedCursor = getCompanionJobCursor(jobId);
      const afterSeq = resetCursor ? 0 : Math.max(companionJobAfterSeq, sharedCursor);
      if (resetCursor) {
        setCompanionJobEvents([]);
        setCompanionJobAfterSeq(0);
        clearCompanionJobCursor(jobId);
        clearCompanionJobTerminalEvent(jobId);
      }
      try {
        const r = await listCompanionJobEvents(base, jobId, afterSeq, 80);
        if (r.ok === false) {
          setCompanionJobEventsHint(`拉取失败：${r.error}${r.status != null ? `（HTTP ${r.status}）` : ''}`);
          return;
        }
        const incoming = Array.isArray(r.data.events) ? r.data.events : [];
        if (incoming.length) {
          setCompanionJobEvents((prev) => {
            const seen = new Set(prev.map((e) => e.seq));
            const merged = [...prev, ...incoming.filter((e) => !seen.has(e.seq))];
            return merged.sort((a, b) => a.seq - b.seq).slice(-300);
          });
        }
        const next = r.data.nextAfterSeq ?? afterSeq;
        setCompanionJobAfterSeq(next);
        setCompanionJobCursor(jobId, next);
        setCompanionJobEventsHint(
          incoming.length
            ? `已同步 ${incoming.length} 条进度${r.latencyMs != null ? `（${r.latencyMs}ms）` : ''}`
            : `进度已是最新${r.latencyMs != null ? `（${r.latencyMs}ms）` : ''}`,
        );
      } catch (e) {
        setCompanionJobEventsHint(`拉取异常：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setCompanionJobEventsBusy(false);
      }
    },
    [companionBaseDraft, companionJobAfterSeq, companionJobIdDraft],
  );

  useEffect(() => {
    if (!companionJobEventsAuto) {
      setCompanionStreamMode('idle');
      return;
    }
    const jobId = companionJobIdDraft.trim();
    if (!jobId) return;
    const base = normalizeCompanionBaseUrl(companionBaseDraft);
    const afterSeq = Math.max(companionJobAfterSeq, getCompanionJobCursor(jobId));
    const stream = createCompanionJobEventStream(base, jobId, afterSeq);
    let closed = false;
    setCompanionStreamMode('sse');
    setCompanionJobEventsHint((prev) => prev || '已连接实时进度');

    const onJobEvent = (ev: MessageEvent) => {
      let parsed: CompanionJobEventV1 | null = null;
      try {
        parsed = JSON.parse(ev.data) as CompanionJobEventV1;
      } catch {
        return;
      }
      if (!parsed || typeof parsed.seq !== 'number') return;
      setCompanionJobEvents((prev) => {
        const seen = new Set(prev.map((e) => e.seq));
        const merged = seen.has(parsed.seq) ? prev : [...prev, parsed];
        return merged.sort((a, b) => a.seq - b.seq).slice(-300);
      });
      const seq = parsed.seq;
      setCompanionJobAfterSeq((prev) => {
        const next = Math.max(prev, seq);
        setCompanionJobCursor(jobId, next);
        return next;
      });
    };
    const onJobEnd = () => {
      setCompanionJobEventsHint('任务已结束');
      setCompanionStreamMode('idle');
      stream.close();
    };
    const onError = () => {
      if (closed) return;
      setCompanionStreamMode('poll');
      setCompanionJobEventsHint('实时连接不可用，已改为定时刷新');
      stream.close();
    };
    stream.addEventListener('job.event', onJobEvent as EventListener);
    stream.addEventListener('job.end', onJobEnd as EventListener);
    stream.onerror = onError;
    return () => {
      closed = true;
      stream.removeEventListener('job.event', onJobEvent as EventListener);
      stream.removeEventListener('job.end', onJobEnd as EventListener);
      stream.close();
    };
  }, [companionBaseDraft, companionJobAfterSeq, companionJobEventsAuto, companionJobIdDraft]);

  useEffect(() => {
    if (!companionJobEventsAuto) return;
    if (companionStreamMode === 'sse') return;
    if (!companionJobIdDraft.trim()) return;
    setCompanionStreamMode('poll');
    const t = window.setInterval(() => {
      void pullCompanionJobEvents(false);
    }, 2500);
    return () => window.clearInterval(t);
  }, [companionJobEventsAuto, companionJobIdDraft, companionStreamMode, pullCompanionJobEvents]);

  useEffect(() => {
    const latest = companionJobEvents.length ? companionJobEvents[companionJobEvents.length - 1] : null;
    if (!latest || !TERMINAL_JOB_EVENT_TYPES.has(latest.type)) return;
    if (!companionJobEventsAuto) return;
    setCompanionJobEventsAuto(false);
    setCompanionStreamMode('idle');
    setCompanionJobEventsHint('任务已结束，已停止自动跟随');
  }, [companionJobEvents, companionJobEventsAuto]);

  useEffect(() => {
    const latest = companionJobEvents.length ? companionJobEvents[companionJobEvents.length - 1] : null;
    if (!latest || !TERMINAL_JOB_EVENT_TYPES.has(latest.type)) return;
    saveCompanionJobTerminalEvent(latest);
  }, [companionJobEvents]);

  useEffect(() => {
    if (!companionJobIdDraft.trim()) return;
    if (companionJobEvents.length > 0) return;
    void pullCompanionJobEvents(false);
  }, [companionJobEvents.length, companionJobIdDraft, pullCompanionJobEvents]);

  const openCompanionConsole = useCallback(() => {
    const base = normalizeCompanionBaseUrl(companionBaseDraft);
    window.open(`${base}/`, '_blank', 'noopener,noreferrer');
  }, [companionBaseDraft]);

  const copyCompanionJobDiagnostics = useCallback(async () => {
    const latest = companionJobEvents.length ? companionJobEvents[companionJobEvents.length - 1] : null;
    const content = JSON.stringify(
      {
        jobId: companionJobIdDraft.trim(),
        cursor: companionJobAfterSeq,
        hint: companionJobEventsHint,
        latestEvent: latest,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(content);
      setCompanionJobEventsHint('已复制诊断信息');
    } catch {
      setCompanionJobEventsHint('复制失败：浏览器未授予剪贴板权限');
    }
  }, [companionJobAfterSeq, companionJobEvents, companionJobEventsHint, companionJobIdDraft]);

  const latestCompanionJobEvent = companionJobEvents.length
    ? companionJobEvents[companionJobEvents.length - 1]
    : null;
  const companionJobFailed = latestCompanionJobEvent?.type === 'task.failed';
  const companionJobCompleted = latestCompanionJobEvent?.type === 'reply.completed';

  return (
    <div className="flex flex-col h-full min-h-[60vh]">
      {/* 标题栏 */}
      <header className="shrink-0 h-14 flex items-center px-4 lg:px-6 border-b border-[#2e2e32] bg-[#121214]">
        <h1 className="text-sm font-black uppercase tracking-widest text-white/90">设置</h1>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* 侧边导航：仅做锚点跳转，内容全部展示 */}
        <nav className="shrink-0 w-48 lg:w-56 border-r border-[#2e2e32] py-4 px-2">
          <ul className="space-y-0.5">
            {SETTINGS_NAV.map(({ id, label }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => scrollToSection(id)}
                  className="w-full text-left py-2.5 px-3 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-colors text-gray-400 hover:bg-[#222228] hover:text-gray-300 border border-transparent"
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* 内容区：所有区块同时展示，导航仅滚动到对应标题 */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-6 lg:p-10">
          <div className="max-w-2xl space-y-8">
            <section id="settings-user" className="scroll-mt-4 rounded-2xl border border-[#2e2e32] bg-[#121214] p-6">
              <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90 mb-4">用户</h2>
              <div className="rounded-xl border border-[#252528] p-4 space-y-4">
                {authLoading ? (
                  <p className="text-[10px] text-gray-500">正在加载用户信息…</p>
                ) : currentUser ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[10px]">
                      <div className="rounded-lg border border-[#2e2e32] bg-[#16161a] px-3 py-2">
                        <p className="text-gray-500">用户名</p>
                        <p className="text-white mt-1 break-all">{currentUser.username}</p>
                      </div>
                      <div className="rounded-lg border border-[#2e2e32] bg-[#16161a] px-3 py-2">
                        <p className="text-gray-500">邮箱</p>
                        <p className="text-white mt-1 break-all">{currentUser.email}</p>
                      </div>
                      <div className="rounded-lg border border-[#2e2e32] bg-[#16161a] px-3 py-2">
                        <p className="text-gray-500">用户 ID</p>
                        <p className="text-white mt-1 break-all">{currentUser.id}</p>
                      </div>
                      <div className="rounded-lg border border-[#2e2e32] bg-[#16161a] px-3 py-2">
                        <p className="text-gray-500">角色 / 状态</p>
                        <p className="text-white mt-1 break-all">
                          {currentUser.role} / {currentUser.status}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#2e2e32] bg-[#16161a] p-4 space-y-4">
                      <div>
                        <h3 className="text-[10px] font-black uppercase tracking-wider text-blue-400/80">侧栏展示</h3>
                        <p className="text-[9px] text-gray-600 mt-1 leading-relaxed">
                          自定义左侧边栏账户入口的头像与展示名（圆角矩形，与全站按钮风格一致）。修改后会写入本机并随「用户云配置」自动同步到云端（与能力预设等同一份
                          user-config.json）；不会修改服务器上的登录名与密码。
                          {isWorkspaceCloudEnabled()
                            ? ' 本地上传的 data 头像体积较大，不会上传云端；换设备请使用「图片链接」或仅用展示名。'
                            : ' 当前未开启工作区云同步时，侧栏偏好仅保存在本机。'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-4">
                        <SidebarAccountAvatar user={currentUser} prefs={userUiPrefs} />
                        <div className="flex-1 min-w-[12rem] space-y-2">
                          <label className="block text-[9px] text-gray-500 uppercase tracking-wide">展示名（可选）</label>
                          <input
                            type="text"
                            value={userUiPrefs.displayName}
                            onChange={(e) => setUserUiPrefs({ displayName: e.target.value })}
                            placeholder={currentUser.username || '与登录名相同可留空'}
                            maxLength={24}
                            className="w-full px-3 py-2 rounded-xl bg-[#121214] border border-[#2e2e32] text-[11px] text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                          />
                          <p className="text-[9px] text-gray-600">留空时侧栏缩写取自用户名或邮箱。</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <span className="text-[9px] text-gray-500 uppercase tracking-wide">头像图片</span>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            ref={avatarFileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = '';
                              if (!f || !f.type.startsWith('image/')) return;
                              if (f.size > 2 * 1024 * 1024) {
                                setPrefsUiHint('请选择小于 2MB 的图片');
                                return;
                              }
                              const reader = new FileReader();
                              reader.onload = () => {
                                const data = String(reader.result || '');
                                if (data.length > MAX_AVATAR_DATA_URL_CHARS) {
                                  setPrefsUiHint('图片过大，请压缩或换一张');
                                  return;
                                }
                                setUserUiPrefs({ avatarUrl: data });
                                setPrefsUiHint('已更新本地上传头像');
                              };
                              reader.readAsDataURL(f);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => avatarFileInputRef.current?.click()}
                            className="px-4 py-2 rounded-xl bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-[10px] font-bold text-gray-200 transition-colors"
                          >
                            上传图片
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setUserUiPrefs({ avatarUrl: '' });
                              setAvatarLinkDraft('');
                              setPrefsUiHint('已恢复默认缩写头像');
                            }}
                            className="px-4 py-2 rounded-xl border border-[#3f3f46] text-[10px] font-bold text-gray-400 hover:bg-[#222228] transition-colors"
                          >
                            清除自定义头像
                          </button>
                        </div>
                        {userUiPrefs.avatarUrl.startsWith('data:') ? (
                          <p className="text-[9px] text-gray-500">当前使用本地上传的图片。</p>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        <label className="block text-[9px] text-gray-500 uppercase tracking-wide">或图片链接（https 直链）</label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="url"
                            value={avatarLinkDraft}
                            onChange={(e) => setAvatarLinkDraft(e.target.value)}
                            placeholder="https://example.com/avatar.png"
                            className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-[#121214] border border-[#2e2e32] text-[11px] text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const s = sanitizeAvatarUrl(avatarLinkDraft);
                              if (!avatarLinkDraft.trim()) {
                                setPrefsUiHint('请先填写图片 URL');
                                return;
                              }
                              if (!s) {
                                setPrefsUiHint('无效链接（需 http(s) 图片地址，勿填 localhost）');
                                return;
                              }
                              setUserUiPrefs({ avatarUrl: s });
                              setPrefsUiHint('已应用链接头像');
                            }}
                            className="shrink-0 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-[10px] font-black uppercase text-white transition-colors"
                          >
                            应用链接
                          </button>
                        </div>
                      </div>
                      {prefsUiHint ? <p className="text-[9px] text-gray-500">{prefsUiHint}</p> : null}
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => void handleRefreshUser()}
                        disabled={userActionBusy !== null}
                        className="px-5 py-3 rounded-xl bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-white text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-60"
                      >
                        {userActionBusy === 'refresh' ? '刷新中…' : '刷新信息'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleLogout()}
                        disabled={userActionBusy !== null}
                        className="px-5 py-3 rounded-xl bg-red-600/80 hover:bg-red-500 text-white text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-60"
                      >
                        {userActionBusy === 'logout' ? '退出中…' : '退出登录'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-[10px] text-gray-500">当前未登录。</p>
                )}
                {userActionMsg ? (
                  <p className="text-[10px] text-gray-400">{userActionMsg}</p>
                ) : null}
              </div>
            </section>

            <section id="settings-storage" className="scroll-mt-4 rounded-2xl border border-[#2e2e32] bg-[#121214] p-6">
              <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90 mb-4">数据与存储</h2>
              <div className="rounded-xl border border-[#252528] p-4 space-y-3 text-[10px] text-gray-400 leading-relaxed">
                <p className="text-gray-300 font-semibold">本机浏览器（localStorage）</p>
                <ul className="list-disc list-inside space-y-1.5 text-gray-500">
                  <li>工作区项目画布、对话会话与临时库、仓库条目、能力预设等会占用<strong className="text-gray-400">当前站点在本机的存储配额</strong>（各浏览器通常共约数 MB～十余 MB，与设备有关）。</li>
                  <li>配额不足时可能无法保存；可清理本站数据、减少大图与项目数量，或登录后使用云端工作区同步。</li>
                </ul>
                <p className="text-gray-300 font-semibold pt-2">云端（登录且开启工作区云同步）</p>
                <ul className="list-disc list-inside space-y-1.5 text-gray-500">
                  <li>流程图片等可走对象存储，<strong className="text-gray-400">工作区云空间</strong>有 per-user 配额（默认约 200MB，管理员可调）；与工作流 JSON 的本地缓存是两套概念。</li>
                  <li>大图以独立对象上传，不在单次 JSON 请求里塞满 base64，便于跨设备与省本地配额。</li>
                </ul>
              </div>
            </section>

            <section id="settings-companion" className="scroll-mt-4 rounded-2xl border border-[#2e2e32] bg-[#121214] p-6">
              <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90 mb-4">本地伴侣</h2>
              <div className="rounded-xl border border-[#252528] p-4 space-y-4 text-[10px] text-gray-400 leading-relaxed">
                <p className="text-[11px] text-gray-300 leading-relaxed">
                  在本机安装并运行「本地伴侣」后，部分处理可在本机完成，通常更快、素材也可留在本机。请先保存连接信息并点击「检测连接」。
                </p>
                <div className="space-y-2">
                  <label className="block text-[10px] text-gray-400">本机地址</label>
                  <input
                    type="url"
                    value={companionBaseDraft}
                    onChange={(e) => setCompanionBaseDraft(e.target.value)}
                    placeholder="默认本机端口即可"
                    className="w-full px-3 py-2 rounded-xl bg-[#16161a] border border-[#2e2e32] text-[11px] text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] text-gray-400">配对密码（可选）</label>
                  <input
                    type="password"
                    value={companionTokenDraft}
                    onChange={(e) => setCompanionTokenDraft(e.target.value)}
                    placeholder="与桌面向导或本机配置一致时填写"
                    className="w-full px-3 py-2 rounded-xl bg-[#16161a] border border-[#2e2e32] text-[11px] text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                    autoComplete="off"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleSaveCompanionBase}
                    className="px-4 py-2 rounded-xl bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-[10px] font-bold text-gray-200 transition-colors"
                  >
                    保存地址
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveCompanionToken}
                    className="px-4 py-2 rounded-xl bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-[10px] font-bold text-gray-200 transition-colors"
                  >
                    保存配对密码
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleProbeCompanion()}
                    disabled={companionProbeBusy}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-[10px] font-black uppercase text-white transition-colors disabled:opacity-60"
                  >
                    {companionProbeBusy ? '检测中…' : '检测连接'}
                  </button>
                  <a
                    href={companionConsoleHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 rounded-xl border border-[#3f3f46] text-[10px] font-bold text-gray-300 hover:bg-[#222228] transition-colors"
                  >
                    打开本机管理页
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleListCompanionProjects()}
                    disabled={companionProjectsBusy}
                    className="px-4 py-2 rounded-xl bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-[10px] font-bold text-gray-200 transition-colors disabled:opacity-60"
                  >
                    {companionProjectsBusy ? '刷新中…' : '刷新本机项目列表'}
                  </button>
                </div>
                {companionProbeHint ? <p className="text-[10px] text-gray-300">{companionProbeHint}</p> : null}
                <details className="rounded-lg border border-[#2e2e32] bg-[#16161a] group">
                  <summary className="cursor-pointer list-none px-3 py-2.5 text-[10px] font-bold text-gray-400 marker:content-none [&::-webkit-details-marker]:hidden">
                    连接与能力详情（可选，供排障）
                  </summary>
                  <div className="px-3 pb-3 space-y-2 border-t border-[#2e2e32] pt-2">
                    {companionHealthSnippet ? (
                      <details className="rounded-lg border border-[#2e2e32] bg-[#101014] p-2">
                        <summary className="cursor-pointer text-[9px] font-bold text-gray-500">健康检查</summary>
                        <pre className="mt-2 text-[9px] text-gray-500 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                          {companionHealthSnippet}
                        </pre>
                      </details>
                    ) : null}
                    {companionCapSnippet ? (
                      <details className="rounded-lg border border-[#2e2e32] bg-[#101014] p-2">
                        <summary className="cursor-pointer text-[9px] font-bold text-gray-500">能力清单</summary>
                        <pre className="mt-2 text-[9px] text-gray-500 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                          {companionCapSnippet}
                        </pre>
                      </details>
                    ) : null}
                    {companionRelaySnippet ? (
                      <details className="rounded-lg border border-[#2e2e32] bg-[#101014] p-2">
                        <summary className="cursor-pointer text-[9px] font-bold text-gray-500">站点中转（Relay）</summary>
                        <pre className="mt-2 text-[9px] text-gray-500 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                          {companionRelaySnippet}
                        </pre>
                      </details>
                    ) : null}
                    {companionSeamSnippet ? (
                      <details className="rounded-lg border border-[#2e2e32] bg-[#101014] p-2">
                        <summary className="cursor-pointer text-[9px] font-bold text-gray-500">本机修缝能力</summary>
                        <pre className="mt-2 text-[9px] text-gray-500 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                          {companionSeamSnippet}
                        </pre>
                      </details>
                    ) : null}
                    {companionProjectsSnippet ? (
                      <details className="rounded-lg border border-[#2e2e32] bg-[#101014] p-2">
                        <summary className="cursor-pointer text-[9px] font-bold text-gray-500">项目列表（原始）</summary>
                        <pre className="mt-2 text-[9px] text-gray-500 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                          {companionProjectsSnippet}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                </details>
                <details className="rounded-lg border border-[#2e2e32] bg-[#16161a]">
                  <summary className="cursor-pointer list-none px-3 py-2.5 text-[10px] font-bold text-gray-400 marker:content-none [&::-webkit-details-marker]:hidden">
                    高级：任务进度与日志（一般无需展开）
                  </summary>
                  <div className="px-3 pb-3 space-y-3 border-t border-[#2e2e32] pt-2">
                    <input
                      type="text"
                      value={companionJobIdDraft}
                      onChange={(e) => setCompanionJobIdDraft(e.target.value)}
                      placeholder="任务编号（向支持人员索取时可填）"
                      className="w-full px-3 py-2 rounded-xl bg-[#101014] border border-[#2e2e32] text-[11px] text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                      autoComplete="off"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void pullCompanionJobEvents(true)}
                        disabled={companionJobEventsBusy}
                        className="px-3 py-1.5 rounded-lg bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-[10px] font-bold text-gray-200 transition-colors disabled:opacity-60"
                      >
                        {companionJobEventsBusy ? '刷新中…' : '从头刷新'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void pullCompanionJobEvents(false)}
                        disabled={companionJobEventsBusy}
                        className="px-3 py-1.5 rounded-lg bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-[10px] font-bold text-gray-200 transition-colors disabled:opacity-60"
                      >
                        仅看新进度
                      </button>
                      <button
                        type="button"
                        onClick={() => setCompanionJobEventsAuto((v) => !v)}
                        className="px-3 py-1.5 rounded-lg border border-[#2e2e32] text-[10px] font-bold text-gray-200 hover:bg-[#222228] transition-colors"
                      >
                        {companionJobEventsAuto ? '停止自动跟随' : '自动跟随进度'}
                      </button>
                    </div>
                    {latestCompanionJobEvent ? (
                      <p className="text-[11px] text-gray-300">
                        状态：<span className="text-white">{companionJobStatusHuman(latestCompanionJobEvent)}</span>
                      </p>
                    ) : null}
                    {companionJobEventsHint ? <p className="text-[10px] text-gray-300">{companionJobEventsHint}</p> : null}
                    {(companionJobFailed || companionJobCompleted) ? (
                      <div className="flex flex-wrap gap-2">
                        {companionJobFailed ? (
                          <button
                            type="button"
                            onClick={() => void pullCompanionJobEvents(true)}
                            disabled={companionJobEventsBusy}
                            className="px-3 py-1.5 rounded-lg border border-[#b45309] text-[10px] font-bold text-amber-300 hover:bg-[#3a2a12] transition-colors disabled:opacity-60"
                          >
                            重试同步
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={openCompanionConsole}
                          className="px-3 py-1.5 rounded-lg border border-[#2e2e32] text-[10px] font-bold text-gray-200 hover:bg-[#222228] transition-colors"
                        >
                          打开本机管理页
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyCompanionJobDiagnostics()}
                          className="px-3 py-1.5 rounded-lg border border-[#2e2e32] text-[10px] font-bold text-gray-200 hover:bg-[#222228] transition-colors"
                        >
                          复制诊断信息
                        </button>
                      </div>
                    ) : null}
                    <details className="rounded-lg border border-[#2e2e32] bg-[#101014] p-2">
                      <summary className="cursor-pointer text-[9px] font-bold text-gray-500">原始事件数据</summary>
                      <pre className="mt-2 text-[9px] text-gray-500 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                        {companionJobEvents.length
                          ? JSON.stringify(companionJobEvents.slice(-80), null, 2)
                          : '（暂无）'}
                      </pre>
                    </details>
                  </div>
                </details>
              </div>
            </section>

            <section id="settings-api" className="scroll-mt-4 rounded-2xl border border-[#2e2e32] bg-[#121214] p-6">
              <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90 mb-4">API</h2>
              <div className="space-y-8">
                {/* AI 调用源 */}
                <div className="rounded-xl border border-[#252528] p-4 space-y-4">
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-blue-400/90 mb-1">AI 调用源</h3>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <span className="text-[10px] text-gray-500 shrink-0">供应商</span>
                    <CustomDropdown
                      options={AI_PROVIDER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                      value={aiProvider}
                      onChange={handleAiProviderChange}
                      triggerClassName={`${DROPDOWN_TRIGGER_COMPACT} flex-1 min-w-[12rem]`}
                    />
                  </div>

                  {aiProvider === 'trial' ? (
                    <>
                      <h4 className="text-[10px] font-bold text-white/80 uppercase tracking-wider">试用通道（代理）</h4>
                      <p className="text-[9px] text-gray-500 leading-relaxed">
                        试用模式固定走站点配置的 <code className="text-gray-400">VITE_BULK_IMAGE_API</code> 代理，无需在本机填写 API Key。
                        若代理拥堵/限流，建议切换到其它供应商并填写对应前端 Key 直连。
                      </p>
                    </>
                  ) : aiProvider === 'gemini' ? (
                    <>
                      <h4 className="text-[10px] font-bold text-white/80 uppercase tracking-wider">Gemini API Key</h4>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          onBlur={handleSaveApiKey}
                          placeholder="Google AI Studio / Gemini API Key"
                          className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={handleSaveApiKey}
                          className="shrink-0 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider transition-colors"
                        >
                          {saved ? '已保存' : '保存'}
                        </button>
                      </div>
                    </>
                  ) : aiProvider === 'vertex' ? (
                    <>
                      <h4 className="text-[10px] font-bold text-white/80 uppercase tracking-wider">Vertex AI</h4>
                      <p className="text-[9px] text-gray-500 leading-relaxed">
                        不在浏览器保存 GCP 密钥。请由部署方在 <strong className="text-gray-400">gemini-proxy</strong> 配置{' '}
                        <code className="text-gray-400">VERTEX_PROJECT_ID</code> 或{' '}
                        <code className="text-gray-400">GOOGLE_CLOUD_PROJECT</code>、可选{' '}
                        <code className="text-gray-400">VERTEX_LOCATION</code>（默认 global）及服务账号 / ADC；前端构建需设置{' '}
                        <code className="text-gray-400">VITE_BULK_IMAGE_API</code> 指向该代理。详见{' '}
                        <code className="text-gray-400">docs/VERTEX_AI_INTEGRATION.md</code>。
                      </p>
                    </>
                  ) : aiProvider === 'toapis' ? (
                    <>
                      <h4 className="text-[10px] font-bold text-white/80 uppercase tracking-wider">ToAPIs</h4>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <input
                          type="password"
                          value={toapisApiKey}
                          onChange={(e) => setToapisApiKeyState(e.target.value)}
                          onBlur={handleSaveToapis}
                          placeholder="ToAPIs API Key"
                          className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={handleSaveToapis}
                          className="shrink-0 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider transition-colors"
                        >
                          {saved ? '已保存' : '保存'}
                        </button>
                      </div>
                    </>
                  ) : aiProvider === 'antigravity' ? (
                    <>
                      <h4 className="text-[10px] font-bold text-white/80 uppercase tracking-wider">Antigravity Tools</h4>
                      <p className="text-[9px] text-gray-500 leading-relaxed">
                        在本机启动 Antigravity 的「API 反代」后填写；Base URL 须指向 OpenAI 兼容前缀（含 /v1），默认本机 8045 端口。若浏览器跨域失败，可在 vite 配置同源代理后再填代理路径。
                      </p>
                      <div className="space-y-3">
                        <input
                          type="url"
                          value={antigravityBaseUrl}
                          onChange={(e) => setAntigravityBaseUrlState(e.target.value)}
                          onBlur={handleSaveAntigravity}
                          placeholder="http://127.0.0.1:8045/v1"
                          className="w-full min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
                          autoComplete="off"
                        />
                        <div className="flex flex-col sm:flex-row gap-3">
                          <input
                            type="password"
                            value={antigravityApiKey}
                            onChange={(e) => setAntigravityApiKeyState(e.target.value)}
                            onBlur={handleSaveAntigravity}
                            placeholder="Antigravity 反代 API Key"
                            className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={handleSaveAntigravity}
                            className="shrink-0 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider transition-colors"
                          >
                            {saved ? '已保存' : '保存'}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <h4 className="text-[10px] font-bold text-white/80 uppercase tracking-wider">VectorEngine</h4>
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row gap-3">
                          <input
                            type="password"
                            value={vectorengineApiKey}
                            onChange={(e) => setVectorengineApiKeyState(e.target.value)}
                            onBlur={handleSaveVectorengine}
                            placeholder="VectorEngine API Key"
                            className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={handleSaveVectorengine}
                            className="shrink-0 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider transition-colors"
                          >
                            {saved ? '已保存' : '保存'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                  {saved && <p className="mt-2 text-[10px] text-green-400/90">已保存到本机</p>}
                </div>

                {/* 混元（腾讯云） */}
                <div className="rounded-xl border border-[#252528] p-4">
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-blue-400/90 mb-1">混元（腾讯云）</h3>
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="password"
                        value={tencentSecretId}
                        onChange={(e) => setTencentSecretId(e.target.value)}
                        onBlur={handleSaveTencent}
                        placeholder="SecretId"
                        className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
                        autoComplete="off"
                      />
                      <input
                        type="password"
                        value={tencentSecretKey}
                        onChange={(e) => setTencentSecretKey(e.target.value)}
                        onBlur={handleSaveTencent}
                        placeholder="SecretKey"
                        className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
                        autoComplete="off"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveTencent}
                      className="px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider transition-colors"
                    >
                      {tencentSaved ? '已临时保存' : '临时保存'}
                    </button>
                  </div>
                  {tencentSaved && <p className="mt-2 text-[10px] text-green-400/90">已保存到当前标签页会话</p>}
                </div>
              </div>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsSection;
