import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { SidebarAccountAvatar } from './SidebarAccountAvatar';
import { useUserUiPrefs } from '../hooks/useUserUiPrefs';
import {
  setUserUiPrefs,
  sanitizeAvatarUrl,
  MAX_AVATAR_DATA_URL_CHARS,
} from '../services/userUiPrefs';
import {
  getTencentSecretId,
  setTencentSecretId as saveTencentSecretId,
  getTencentSecretKey,
  setTencentSecretKey as saveTencentSecretKey,
  subscribeAiSettingsCrossTab,
  getDebugClientLogPersistEnabled,
  setDebugClientLogPersistEnabled,
} from '../services/settingsStore';
import AiProviderCredentialsPanel from './AiProviderCredentialsPanel';
import { isWorkspaceCloudEnabled } from '../services/workspaceCloudSync';
import {
  getCompanionLocalBaseUrl,
  getCompanionLocalToken,
  setCompanionLocalBaseUrl,
  setCompanionLocalToken,
  normalizeCompanionBaseUrl,
} from '../services/companionLocalPrefs';
import { installLatestHostPluginBundleToCompanion } from '../services/hostPluginBundleClient';
import {
  createCompanionJobEventStream,
  listCompanionProjects,
  listCompanionJobEvents,
  listCompanionHostPluginBundles,
  submitCompanionHostBundleProbeJob,
  submitCompanionHostBundleExecJob,
  type CompanionJobEventV1,
  type CompanionInstalledHostBundleV1,
  probeCompanionCapabilities,
  probeCompanionHealth,
  fetchCompanionRuntimeStatus,
  probeCompanionSamSegmentHealth,
  probeCompanionRembgHealth,
  probeCompanionPaddleOcrHealth,
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
import { useEffectiveTextModelRows } from '../hooks/useEffectiveTextModelRows';
import { coerceTextModelRegistryId, labelForTextModelRegistryId } from '../services/modelRegistry/textModels';
import type { AuthUser } from '../services/authClient';
import { refreshModelOpsConfig } from '../services/modelRegistry/opsConfig';
import {
  readPanoLocalInpaintShrinkToBase,
  writePanoLocalInpaintShrinkToBase,
} from '../services/lightboxPanoLocalInpaintPrefs';
import {
  FLAT_LOCAL_INPAINT_COMPOSITE_LABELS,
  readFlatLocalInpaintCompositeStrategy,
  writeFlatLocalInpaintCompositeStrategy,
  type FlatLocalInpaintCompositeStrategy,
} from '../services/lightboxFlatLocalInpaintPrefs';

const SETTINGS_NAV: { id: string; label: string }[] = [
  { id: 'settings-user', label: '用户' },
  { id: 'settings-storage', label: '数据与存储' },
  { id: 'settings-companion', label: '本地伴侣' },
  { id: 'settings-api', label: 'API' },
];

function parseLocalCapabilityUiSnippet(json: string): { headline: string; subline: string; tone: string } {
  try {
    const j = JSON.parse(json) as { headline?: string; subline?: string; tone?: string };
    return {
      headline: typeof j.headline === 'string' ? j.headline : '',
      subline: typeof j.subline === 'string' ? j.subline : '',
      tone: typeof j.tone === 'string' ? j.tone : '',
    };
  } catch {
    return { headline: '', subline: '', tone: '' };
  }
}

const COMPANION_SETTINGS_STREAM_STATE_KEY = 'ac_companion_settings_stream_state_v2';

/** 供用户贴到「运行本机伴侣」的终端 / 系统环境变量（非浏览器 localStorage） */
const SAM_LOCAL_ENV_SNIPPET = `# 本机分割：运行 local-companion 或桌面壳的进程环境中设置（默认 predict URL 与伴侣内置一致时可省略第一行）

COMPANION_SAM_SEGMENT_URL=http://127.0.0.1:18081/v1/segment/predict

# 可选：伴侣启动时随启 SamLocal（开发机）— 将下一行 REPO_ROOT 换成你的仓库根目录绝对路径
COMPANION_SPAWN_SAM_LOCAL_CMD=npm run dev:sam-local
COMPANION_SPAWN_SAM_LOCAL_CWD=REPO_ROOT

# 一键栈等价：仓库根执行 npm run dev:companion-sam-stack（勿与上两行重复配置）
# 首次真实分割环境：仓库根 npm run setup:sam-local（pip + 下载 ViT-B），见 docs/本机分割一键安装指南.md
# SamLocal 真实分割：设置 SAM_MODE=sam，见 docs/本机分割故障排除.md
`;

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
   * 避免设置页仍显示旧的 channel/Key（与 `getEnabledChannels()` 真相源不一致）。
   */
  aiSettingsSyncRev?: number;
  /** 当前打开的工作区项目 id；写入宿主包计算任务元数据便于排查（伴侣侧可不消费） */
  activeWorkspaceProjectId?: string | null;
  /** 从侧栏跳转时滚动到对应区块 */
  scrollToSectionId?: string | null;
  onScrollToSectionDone?: () => void;
  /** 与 `WorkflowSection` 一致，用于全景贴回偏好键隔离 */
  preferenceScope?: string | null;
  /** 全站默认文字模型 registryId（`ac_config.modelText`） */
  modelText?: string;
  onModelTextChange?: (registryId: string) => void;
}> = ({
  currentUser = null,
  authLoading = false,
  onRefreshUser,
  onLogout,
  onAiInvocationSurfaceChange,
  aiSettingsSyncRev = 0,
  activeWorkspaceProjectId = null,
  scrollToSectionId = null,
  onScrollToSectionDone,
  preferenceScope = null,
  modelText = '',
  onModelTextChange,
}) => {
  const { rows: effectiveTextModelRows, coerceModelId: coerceTextModelId } = useEffectiveTextModelRows();
  const resolvedModelText = coerceTextModelRegistryId(modelText);

  useLayoutEffect(() => {
    if (!onModelTextChange || !modelText) return;
    const row = effectiveTextModelRows.find((r) => r.registryId === resolvedModelText);
    if (row && !row.disabled) return;
    const firstReady = effectiveTextModelRows.find((r) => !r.disabled);
    if (firstReady && firstReady.registryId !== resolvedModelText) {
      onModelTextChange(firstReady.registryId);
    }
  }, [effectiveTextModelRows, resolvedModelText, onModelTextChange, modelText, aiSettingsSyncRev]);
  const contentRef = useRef<HTMLDivElement>(null);
  const [tencentSecretId, setTencentSecretId] = useState('');
  const [tencentSecretKey, setTencentSecretKey] = useState('');
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
  const [companionSamSnippet, setCompanionSamSnippet] = useState('');
  const [companionSamHealthBusy, setCompanionSamHealthBusy] = useState(false);
  const [companionSamHealthSnippet, setCompanionSamHealthSnippet] = useState('');
  const [companionRembgDebugBusy, setCompanionRembgDebugBusy] = useState(false);
  const [companionRembgDebugSnippet, setCompanionRembgDebugSnippet] = useState('');
  const [companionPaddleOcrDebugBusy, setCompanionPaddleOcrDebugBusy] = useState(false);
  const [companionPaddleOcrDebugSnippet, setCompanionPaddleOcrDebugSnippet] = useState('');
  /** `/v1/runtime-status` 中的 `localCapabilityUi` JSON（检测成功后刷新） */
  const [companionRuntimeUiJson, setCompanionRuntimeUiJson] = useState('');
  /** `/v1/runtime-status` 中的 `samSegmentHttpProbe` JSON（与伴侣内 HTTP 健康检查一致） */
  const [companionSamProbeSnippet, setCompanionSamProbeSnippet] = useState('');
  /** `/v1/runtime-status` 中的 `rembgPythonProbe`（伴侣内 `import rembg` 子进程探测） */
  const [companionRembgProbeSnippet, setCompanionRembgProbeSnippet] = useState('');
  /** `/v1/runtime-status` 中的 `paddleOcrHttpProbe` */
  const [companionPaddleOcrProbeSnippet, setCompanionPaddleOcrProbeSnippet] = useState('');
  /** `/v1/runtime-status` 中的 `localEnginesStatus`（注册表 + 已接线探测） */
  const [companionLocalEnginesStatusJson, setCompanionLocalEnginesStatusJson] = useState('');
  const [companionDiagCopyHint, setCompanionDiagCopyHint] = useState('');
  const [companionProjectsBusy, setCompanionProjectsBusy] = useState(false);
  const [companionProjectsSnippet, setCompanionProjectsSnippet] = useState('');
  const [companionJobIdDraft, setCompanionJobIdDraft] = useState('');
  const [companionJobEventsBusy, setCompanionJobEventsBusy] = useState(false);
  const [companionJobEvents, setCompanionJobEvents] = useState<CompanionJobEventV1[]>([]);
  const [companionJobAfterSeq, setCompanionJobAfterSeq] = useState(0);
  const [companionJobEventsHint, setCompanionJobEventsHint] = useState('');
  const [companionJobEventsAuto, setCompanionJobEventsAuto] = useState(false);
  const [companionStreamMode, setCompanionStreamMode] = useState<'idle' | 'sse' | 'poll'>('idle');
  const [hostBundleBusy, setHostBundleBusy] = useState(false);
  const [hostBundleHint, setHostBundleHint] = useState('');
  const [hostBundleListBusy, setHostBundleListBusy] = useState(false);
  const [hostBundleRows, setHostBundleRows] = useState<CompanionInstalledHostBundleV1[]>([]);
  const [hostBundleSelectedDir, setHostBundleSelectedDir] = useState('');
  const [hostBundleExecBusy, setHostBundleExecBusy] = useState(false);
  const [hostBundleExecHint, setHostBundleExecHint] = useState('');
  const [debugLogPersistEnabled, setDebugLogPersistEnabledState] = useState(false);
  const [panoInpaintShrinkToBase, setPanoInpaintShrinkToBase] = useState(false);
  const [flatInpaintComposite, setFlatInpaintComposite] = useState<FlatLocalInpaintCompositeStrategy>('fit_dest');

  useEffect(() => {
    setPanoInpaintShrinkToBase(readPanoLocalInpaintShrinkToBase(preferenceScope));
    setFlatInpaintComposite(readFlatLocalInpaintCompositeStrategy(preferenceScope));
  }, [preferenceScope]);

  useEffect(() => {
    const u = userUiPrefs.avatarUrl.trim();
    setAvatarLinkDraft(/^https?:\/\//i.test(u) ? u : '');
  }, [userUiPrefs.avatarUrl]);

  useEffect(() => {
    setCompanionBaseDraft(getCompanionLocalBaseUrl());
    setCompanionTokenDraft(getCompanionLocalToken());
  }, []);

  const suggestedSiteOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  const handleSaveCompanionPairing = () => {
    setCompanionLocalToken(companionTokenDraft);
    setCompanionTokenDraft(getCompanionLocalToken());
    setCompanionProbeHint('已保存。桌面伴侣里填同一密码即可。');
    setTimeout(() => setCompanionProbeHint(''), 3200);
  };

  const handleCopySuggestedOrigin = async () => {
    const t = suggestedSiteOrigin.trim();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      setCompanionProbeHint('已复制站点地址，可粘贴到桌面伴侣「允许的网站」');
      setTimeout(() => setCompanionProbeHint(''), 3200);
    } catch {
      setCompanionProbeHint('复制失败：请手动复制浏览器地址栏中的站点根地址');
      setTimeout(() => setCompanionProbeHint(''), 3200);
    }
  };

  const handleCopySamLocalEnvSnippet = async () => {
    try {
      await navigator.clipboard.writeText(SAM_LOCAL_ENV_SNIPPET);
      setCompanionProbeHint('已复制环境变量示例；把 REPO_ROOT 换成你的仓库根目录后写入伴侣环境');
      setTimeout(() => setCompanionProbeHint(''), 4200);
    } catch {
      setCompanionProbeHint('复制失败：请手动从 docs/本机分割故障排除.md 对照填写');
      setTimeout(() => setCompanionProbeHint(''), 4200);
    }
  };

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
    setTencentSecretId(getTencentSecretId() ?? '');
    setTencentSecretKey(getTencentSecretKey() ?? '');
    setDebugLogPersistEnabledState(getDebugClientLogPersistEnabled());
  }, []);

  useEffect(() => {
    reloadApiSettingsFromStore();
  }, [aiSettingsSyncRev, reloadApiSettingsFromStore]);

  useEffect(() => {
    return subscribeAiSettingsCrossTab(reloadApiSettingsFromStore);
  }, [reloadApiSettingsFromStore]);

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

  useEffect(() => {
    if (!scrollToSectionId) return;
    const t = window.setTimeout(() => {
      scrollToSection(scrollToSectionId);
      onScrollToSectionDone?.();
    }, 80);
    return () => window.clearTimeout(t);
  }, [scrollToSectionId, onScrollToSectionDone]);

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


  const handleProbeCompanion = async () => {
    const base = normalizeCompanionBaseUrl(companionBaseDraft);
    setCompanionProbeBusy(true);
    setCompanionProbeHint('');
    setCompanionHealthSnippet('');
    setCompanionCapSnippet('');
    setCompanionRelaySnippet('');
    setCompanionSeamSnippet('');
    setCompanionSamSnippet('');
    setCompanionSamHealthSnippet('');
    setCompanionRembgDebugSnippet('');
    setCompanionRuntimeUiJson('');
    setCompanionSamProbeSnippet('');
    setCompanionRembgProbeSnippet('');
    setCompanionLocalEnginesStatusJson('');
    try {
      const [h, c, rt] = await Promise.all([
        probeCompanionHealth(base),
        probeCompanionCapabilities(base),
        fetchCompanionRuntimeStatus(base),
      ]);
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
          const samSegment = compute?.samSegment;
          setCompanionRelaySnippet(relay != null ? JSON.stringify(relay, null, 2) : '（capabilities 无 relay）');
          setCompanionSeamSnippet(
            seamRepair != null ? JSON.stringify(seamRepair, null, 2) : '（capabilities.compute 无 seamRepair）',
          );
          setCompanionSamSnippet(
            samSegment != null ? JSON.stringify(samSegment, null, 2) : '（capabilities.compute 无 samSegment）',
          );
        }
      } else {
        parts.push(`能力清单：失败 — ${c.error ?? '未知错误'}`);
      }
      if (rt.ok && rt.body && typeof rt.body === 'object' && rt.body !== null) {
        const cap = rt.body as Record<string, unknown>;
        const ui = cap.localCapabilityUi;
        setCompanionRuntimeUiJson(JSON.stringify(ui ?? null, null, 2));
        const sp = cap.samSegmentHttpProbe;
        setCompanionSamProbeSnippet(
          sp != null && typeof sp === 'object' ? JSON.stringify(sp, null, 2) : '',
        );
        const rp = cap.rembgPythonProbe;
        setCompanionRembgProbeSnippet(
          rp != null && typeof rp === 'object' ? JSON.stringify(rp, null, 2) : '',
        );
        const po = cap.paddleOcrHttpProbe;
        setCompanionPaddleOcrProbeSnippet(
          po != null && typeof po === 'object' ? JSON.stringify(po, null, 2) : '',
        );
        const le = cap.localEnginesStatus;
        setCompanionLocalEnginesStatusJson(
          Array.isArray(le) && le.length > 0 ? JSON.stringify(le, null, 2) : '',
        );
      } else {
        setCompanionRuntimeUiJson('');
        setCompanionSamProbeSnippet('');
        setCompanionRembgProbeSnippet('');
        setCompanionPaddleOcrProbeSnippet('');
        setCompanionLocalEnginesStatusJson('');
        if (!rt.ok) {
          parts.push(`运行状态：失败 — ${rt.error ?? '未知错误'}`);
        }
      }
      setCompanionProbeHint(parts.join('；'));
    } finally {
      setCompanionProbeBusy(false);
    }
  };

  const handleProbeRembgHealth = async () => {
    const base = normalizeCompanionBaseUrl(companionBaseDraft);
    setCompanionRembgDebugBusy(true);
    setCompanionRembgDebugSnippet('');
    try {
      const r = await probeCompanionRembgHealth(base);
      if (r.ok === false) {
        setCompanionRembgDebugSnippet(`请求失败：${r.error ?? '未知错误'}`);
        return;
      }
      setCompanionRembgDebugSnippet(JSON.stringify(r.body, null, 2));
    } catch (e) {
      setCompanionRembgDebugSnippet(String(e));
    } finally {
      setCompanionRembgDebugBusy(false);
    }
  };

  const handleProbePaddleOcrHealth = async () => {
    const base = normalizeCompanionBaseUrl(companionBaseDraft);
    setCompanionPaddleOcrDebugBusy(true);
    setCompanionPaddleOcrDebugSnippet('');
    try {
      const r = await probeCompanionPaddleOcrHealth(base);
      if (r.ok === false) {
        setCompanionPaddleOcrDebugSnippet(`请求失败：${r.error ?? '未知错误'}`);
        return;
      }
      setCompanionPaddleOcrDebugSnippet(JSON.stringify(r.body, null, 2));
    } catch (e) {
      setCompanionPaddleOcrDebugSnippet(String(e));
    } finally {
      setCompanionPaddleOcrDebugBusy(false);
    }
  };

  const handleProbeSamSegmentHealth = async () => {
    const base = normalizeCompanionBaseUrl(companionBaseDraft);
    setCompanionSamHealthBusy(true);
    setCompanionSamHealthSnippet('');
    try {
      const r = await probeCompanionSamSegmentHealth(base);
      if (r.ok === false) {
        setCompanionSamHealthSnippet(`请求失败：${r.error ?? '未知错误'}`);
        return;
      }
      setCompanionSamHealthSnippet(JSON.stringify(r.body, null, 2));
    } catch (e) {
      setCompanionSamHealthSnippet(String(e));
    } finally {
      setCompanionSamHealthBusy(false);
    }
  };

  const handleCopyCompanionDiagnostic = async () => {
    const base = normalizeCompanionBaseUrl(companionBaseDraft);
    setCompanionDiagCopyHint('');
    try {
      const [h, c, rt] = await Promise.all([
        probeCompanionHealth(base),
        probeCompanionCapabilities(base),
        fetchCompanionRuntimeStatus(base),
      ]);
      const ui =
        rt.ok && rt.body && typeof rt.body === 'object' && rt.body !== null
          ? (rt.body as Record<string, unknown>).localCapabilityUi
          : null;
      const samProbe =
        rt.ok && rt.body && typeof rt.body === 'object' && rt.body !== null
          ? (rt.body as Record<string, unknown>).samSegmentHttpProbe
          : null;
      const rembgProbe =
        rt.ok && rt.body && typeof rt.body === 'object' && rt.body !== null
          ? (rt.body as Record<string, unknown>).rembgPythonProbe
          : null;
      const paddleOcrProbe =
        rt.ok && rt.body && typeof rt.body === 'object' && rt.body !== null
          ? (rt.body as Record<string, unknown>).paddleOcrHttpProbe
          : null;
      const localEngines =
        rt.ok && rt.body && typeof rt.body === 'object' && rt.body !== null
          ? (rt.body as Record<string, unknown>).localEnginesStatus
          : null;
      const payload = {
        generatedAt: new Date().toISOString(),
        companionBase: base,
        localCapabilityUi: ui ?? null,
        samSegmentHttpProbe: samProbe ?? null,
        rembgPythonProbe: rembgProbe ?? null,
        paddleOcrHttpProbe: paddleOcrProbe ?? null,
        localEnginesStatus: localEngines ?? null,
        health: h.ok ? { ok: true as const, latencyMs: h.latencyMs } : { ok: false as const, error: h.error },
        capabilities: c.ok ? { ok: true as const, latencyMs: c.latencyMs } : { ok: false as const, error: c.error },
        runtimeStatus: rt.ok ? { ok: true as const, latencyMs: rt.latencyMs } : { ok: false as const, error: rt.error },
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCompanionDiagCopyHint('已复制诊断摘要到剪贴板（不含通信密码）');
      setTimeout(() => setCompanionDiagCopyHint(''), 3200);
    } catch (e) {
      setCompanionDiagCopyHint(`复制失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleQuickConnectCompanion = async () => {
    const base = normalizeCompanionBaseUrl(companionBaseDraft);
    setCompanionLocalBaseUrl(base);
    setCompanionBaseDraft(base);
    if (companionTokenDraft.trim()) {
      setCompanionLocalToken(companionTokenDraft);
      setCompanionTokenDraft(getCompanionLocalToken());
    }
    setCompanionProbeHint('正在连接…');
    await handleProbeCompanion();
  };

  const handleCompanionOneClickOff = () => {
    setCompanionLocalToken('');
    setCompanionTokenDraft('');
    setCompanionProbeHint('已关闭配对密码。你仍可随时一键连接重新启用。');
    setTimeout(() => setCompanionProbeHint(''), 2500);
  };

  const handleSaveCompanionAdvanced = () => {
    setCompanionLocalBaseUrl(companionBaseDraft);
    setCompanionBaseDraft(getCompanionLocalBaseUrl());
    setCompanionProbeHint('本机地址已保存');
    setTimeout(() => setCompanionProbeHint(''), 2500);
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

  const handleRefreshHostBundles = async () => {
    const base = normalizeCompanionBaseUrl(companionBaseDraft);
    setHostBundleListBusy(true);
    setHostBundleExecHint('');
    try {
      const r = await listCompanionHostPluginBundles(base);
      if (r.ok === false) {
        setHostBundleExecHint(`拉取已安装包失败：${r.error}${r.status != null ? `（HTTP ${r.status}）` : ''}`);
        setHostBundleRows([]);
        return;
      }
      const rows = Array.isArray(r.data.bundles) ? r.data.bundles : [];
      setHostBundleRows(rows);
      if (rows.length === 1 && rows[0]?.dirName) {
        setHostBundleSelectedDir(rows[0].dirName);
      }
      setHostBundleExecHint(rows.length ? `已刷新：${rows.length} 个包` : '暂无已安装包（可先安装最新包）');
    } catch (e) {
      setHostBundleRows([]);
      setHostBundleExecHint(e instanceof Error ? e.message : String(e));
    } finally {
      setHostBundleListBusy(false);
    }
  };

  const handleInstallHostBundle = async () => {
    setHostBundleBusy(true);
    setHostBundleHint('');
    try {
      const { semver, installUrlSource } = await installLatestHostPluginBundleToCompanion();
      const via =
        installUrlSource === 'public' ? '（经公网直链，未走预签名下载）' : '（经登录预签名下载）';
      setHostBundleHint(
        `已写入本机卷 host-bundles/，版本 ${semver}。${via} 运行时状态见 /v1/runtime-status 中 hostPluginBundles。`,
      );
      void handleRefreshHostBundles();
    } catch (e) {
      setHostBundleHint(e instanceof Error ? e.message : String(e));
    } finally {
      setHostBundleBusy(false);
    }
  };

  const handleHostBundleProbe = async () => {
    const dir = hostBundleSelectedDir.trim();
    if (!dir) {
      setHostBundleExecHint('请先选择已安装包（或点「刷新已安装包列表」）');
      return;
    }
    const base = normalizeCompanionBaseUrl(companionBaseDraft);
    setHostBundleExecBusy(true);
    setHostBundleExecHint('正在提交 host_bundle.probe…');
    try {
      const pid = activeWorkspaceProjectId?.trim() || undefined;
      const r = await submitCompanionHostBundleProbeJob(base, dir, { projectId: pid });
      if (r.ok === false) {
        setHostBundleExecHint(`提交失败：${r.error}${r.status != null ? `（HTTP ${r.status}）` : ''}`);
        return;
      }
      const jobId = r.data.jobId;
      setCompanionJobIdDraft(jobId);
      setHostBundleExecHint(`probe 已提交。任务 ${jobId} 已填入下方「任务编号」，可从头刷新或开启自动跟随。`);
      void pullCompanionJobEvents(true, jobId);
    } catch (e) {
      setHostBundleExecHint(e instanceof Error ? e.message : String(e));
    } finally {
      setHostBundleExecBusy(false);
    }
  };

  const handleHostBundleExec = async () => {
    const dir = hostBundleSelectedDir.trim();
    if (!dir) {
      setHostBundleExecHint('请先选择已安装包（或点「刷新已安装包列表」）');
      return;
    }
    const base = normalizeCompanionBaseUrl(companionBaseDraft);
    setHostBundleExecBusy(true);
    setHostBundleExecHint('正在提交 host_bundle.exec…');
    try {
      const pid = activeWorkspaceProjectId?.trim() || undefined;
      const r = await submitCompanionHostBundleExecJob(base, dir, { projectId: pid });
      if (r.ok === false) {
        setHostBundleExecHint(`提交失败：${r.error}${r.status != null ? `（HTTP ${r.status}）` : ''}`);
        return;
      }
      const jobId = r.data.jobId;
      setCompanionJobIdDraft(jobId);
      setHostBundleExecHint(`exec 已提交。任务 ${jobId} 已填入下方「任务编号」；exec 可能较久，建议开启自动跟随。`);
      void pullCompanionJobEvents(true, jobId);
    } catch (e) {
      setHostBundleExecHint(e instanceof Error ? e.message : String(e));
    } finally {
      setHostBundleExecBusy(false);
    }
  };

  const pullCompanionJobEvents = useCallback(
    async (resetCursor = false, jobIdOverride?: string) => {
      const jobId = (jobIdOverride ?? companionJobIdDraft).trim();
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
              <div className="rounded-xl border border-[#252528] p-4 space-y-4 text-[10px] text-gray-400 leading-relaxed">
                <p className="text-gray-300 font-semibold">本机浏览器（localStorage）</p>
                <ul className="list-disc list-inside space-y-1.5 text-gray-500">
                  <li>工作区项目画布、对话会话与临时库、仓库条目、能力预设等会占用<strong className="text-gray-400">当前站点在本机的存储配额</strong>（各浏览器通常共约数 MB～十余 MB，与设备有关）。</li>
                  <li>配额不足时可能无法保存；可清理本站数据、减少大图与项目数量。</li>
                </ul>
                <div className="rounded-lg border border-[#2e2e32] bg-[#16161a] p-3 space-y-2">
                  <p className="text-gray-300 font-semibold">调试模式：运行日志落盘（默认关闭）</p>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={debugLogPersistEnabled}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setDebugLogPersistEnabledState(next);
                        setDebugClientLogPersistEnabled(next);
                      }}
                    />
                    <span className="text-[10px] text-gray-300">开启后，脱敏运行日志会写入本地文件（7 天自动清理）</span>
                  </label>
                  <p className="text-[9px] text-gray-500">
                    仅用于排障：不记录 API Key、不记录完整图片 base64。关闭后立即停止写入。
                  </p>
                </div>
                <div className="rounded-lg border border-[#2e2e32] bg-[#16161a] p-3 space-y-2">
                  <p className="text-gray-300 font-semibold">平面局部重绘贴回</p>
                  <CustomDropdown
                    value={flatInpaintComposite}
                    options={(
                      ['fit_dest', 'upscale_canvas', 'detail_enhance'] as FlatLocalInpaintCompositeStrategy[]
                    ).map((id) => ({
                      value: id,
                      label: FLAT_LOCAL_INPAINT_COMPOSITE_LABELS[id].title,
                    }))}
                    onChange={(v) => {
                      const next = v as FlatLocalInpaintCompositeStrategy;
                      setFlatInpaintComposite(next);
                      writeFlatLocalInpaintCompositeStrategy(preferenceScope, next);
                    }}
                    triggerClassName={`${DROPDOWN_TRIGGER_COMPACT} w-full max-w-md`}
                  />
                  <p className="text-[9px] text-gray-500 leading-relaxed">
                    {FLAT_LOCAL_INPAINT_COMPOSITE_LABELS[flatInpaintComposite].hint}
                  </p>
                  <p className="text-[9px] text-gray-500 leading-relaxed">
                    快捷栏「输出尺寸」仅作用于裁切后送模型的局部图，不会把整张底图缩到 2K/4K。
                  </p>
                </div>
                <div className="rounded-lg border border-[#2e2e32] bg-[#16161a] p-3 space-y-2">
                  <p className="text-gray-300 font-semibold">全景局部重绘贴回</p>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={panoInpaintShrinkToBase}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setPanoInpaintShrinkToBase(next);
                        writePanoLocalInpaintShrinkToBase(preferenceScope, next);
                      }}
                    />
                    <span className="text-[10px] text-gray-300">
                      固定为原图尺寸（先高分辨率贴回，再缩小到底图宽高）
                    </span>
                  </label>
                  <p className="text-[9px] text-gray-500 leading-relaxed">
                    关闭时贴回结果可与原全景分辨率不同（通常更大），局部更细。开启后输出与当前底图同宽高，仍比「始终用 1k
                    栅格贴回」更清晰。
                  </p>
                </div>
              </div>
            </section>

            <section id="settings-companion" className="scroll-mt-4 rounded-2xl border border-[#2e2e32] bg-[#121214] p-6">
              <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90 mb-2">本地伴侣</h2>
              <p className="text-[10px] text-gray-500 leading-relaxed mb-4">
                「本机分割」「去背景」「OCR / 文档解析」在<strong className="text-gray-300">本机</strong>运行，需<strong className="text-gray-300">桌面伴侣</strong>并在其中打开本机引擎。文末「扩展包」为可选，日常可忽略。
              </p>
              <div className="rounded-xl border border-[#252528] p-4 space-y-4 text-[10px] text-gray-400 leading-relaxed">
                <div className="rounded-xl border border-blue-500/30 bg-[#0c1524]/90 p-4 space-y-3">
                  <h3 className="text-[11px] font-bold text-blue-300/95">① 与网站配对</h3>
                  <p className="text-[10px] text-gray-500">
                    密码只保存在本浏览器。桌面伴侣里填<strong className="text-gray-300">同一密码</strong>，并把允许的网站设为下方地址。
                  </p>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] text-gray-400">通信密码</label>
                    <input
                      type="password"
                      value={companionTokenDraft}
                      onChange={(e) => setCompanionTokenDraft(e.target.value)}
                      placeholder="与桌面伴侣里一致"
                      className="w-full px-3 py-2 rounded-xl bg-[#101014] border border-[#2e2e32] text-[11px] text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] text-gray-400">当前站点（粘贴到桌面伴侣）</label>
                    <div className="flex flex-wrap items-stretch gap-2">
                      <code className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[#101014] border border-[#2e2e32] text-[10px] text-gray-300 break-all">
                        {suggestedSiteOrigin || '—'}
                      </code>
                      <button
                        type="button"
                        onClick={() => void handleCopySuggestedOrigin()}
                        disabled={!suggestedSiteOrigin}
                        className="shrink-0 px-3 py-2 rounded-xl border border-[#3f3f46] text-[10px] font-bold text-gray-200 hover:bg-[#222228] transition-colors disabled:opacity-40"
                      >
                        复制
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveCompanionPairing}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-[10px] font-black uppercase text-white transition-colors"
                  >
                    保存配对密码
                  </button>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 mb-2">② 连接本机</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleQuickConnectCompanion()}
                      disabled={companionProbeBusy}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-[10px] font-black uppercase text-white transition-colors disabled:opacity-60"
                    >
                      {companionProbeBusy ? '连接中…' : '一键连接'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleProbeCompanion()}
                      disabled={companionProbeBusy}
                      className="px-4 py-2 rounded-xl border border-[#3f3f46] text-[10px] font-bold text-gray-300 hover:bg-[#222228] transition-colors disabled:opacity-60"
                    >
                      {companionProbeBusy ? '检测中…' : '重新检测'}
                    </button>
                    <button
                      type="button"
                      onClick={handleCompanionOneClickOff}
                      className="px-4 py-2 rounded-xl bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-[10px] font-bold text-gray-200 transition-colors"
                    >
                      关闭配对
                    </button>
                    <a
                      href="assetcutter-companion://open"
                      className="inline-flex items-center px-4 py-2 rounded-xl border border-[#3f3f46] text-[10px] font-bold text-gray-300 hover:bg-[#222228] transition-colors"
                      title="需已安装桌面伴侣；首次可能需在系统中确认协议"
                    >
                      打开桌面伴侣
                    </a>
                    <a
                      href={companionConsoleHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center px-4 py-2 rounded-xl border border-[#3f3f46] text-[10px] font-bold text-gray-300 hover:bg-[#222228] transition-colors"
                    >
                      本机管理页
                    </a>
                    <button
                      type="button"
                      onClick={() => void handleListCompanionProjects()}
                      disabled={companionProjectsBusy}
                      className="px-4 py-2 rounded-xl bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-[10px] font-bold text-gray-200 transition-colors disabled:opacity-60"
                    >
                      {companionProjectsBusy ? '刷新中…' : '刷新项目列表'}
                    </button>
                  </div>
                </div>
                {companionProbeHint ? <p className="text-[10px] text-gray-300">{companionProbeHint}</p> : null}
                <div className="rounded-lg border border-amber-500/25 bg-[#1c1408]/90 p-3 space-y-2">
                  <p className="text-[11px] text-amber-100/95 font-semibold">③ 本机状态</p>
                  {companionRuntimeUiJson.trim() ? (
                    (() => {
                      const lc = parseLocalCapabilityUiSnippet(companionRuntimeUiJson);
                      const warn = lc.tone === 'warn';
                      return (
                        <div className="space-y-1.5">
                          <p
                            className={`text-[11px] font-bold leading-snug ${
                              warn ? 'text-amber-200' : 'text-emerald-200/95'
                            }`}
                          >
                            {lc.headline || '（无标题）'}
                          </p>
                          {lc.subline ? (
                            <p className="text-[10px] text-gray-400 leading-relaxed">{lc.subline}</p>
                          ) : null}
                          <details className="text-[9px] text-gray-500">
                            <summary className="cursor-pointer text-gray-400 font-semibold">原始 JSON</summary>
                            <pre className="mt-1 whitespace-pre-wrap break-all max-h-28 overflow-y-auto rounded border border-[#2e2e32] bg-[#101014] p-2">
                              {companionRuntimeUiJson}
                            </pre>
                          </details>
                          {companionSamProbeSnippet.trim() ? (
                            <details className="text-[9px] text-gray-500">
                              <summary className="cursor-pointer text-gray-400 font-semibold">分割服务</summary>
                              <pre className="mt-1 whitespace-pre-wrap break-all max-h-24 overflow-y-auto rounded border border-[#2e2e32] bg-[#101014] p-2">
                                {companionSamProbeSnippet}
                              </pre>
                            </details>
                          ) : null}
                          {companionRembgProbeSnippet.trim() ? (
                            <details className="text-[9px] text-gray-500">
                              <summary className="cursor-pointer text-gray-400 font-semibold">去背景</summary>
                              <pre className="mt-1 whitespace-pre-wrap break-all max-h-24 overflow-y-auto rounded border border-[#2e2e32] bg-[#101014] p-2">
                                {companionRembgProbeSnippet}
                              </pre>
                            </details>
                          ) : null}
                          {companionPaddleOcrProbeSnippet.trim() ? (
                            <details className="text-[9px] text-gray-500">
                              <summary className="cursor-pointer text-gray-400 font-semibold">OCR / 文档解析</summary>
                              <pre className="mt-1 whitespace-pre-wrap break-all max-h-24 overflow-y-auto rounded border border-[#2e2e32] bg-[#101014] p-2">
                                {companionPaddleOcrProbeSnippet}
                              </pre>
                            </details>
                          ) : null}
                          {companionLocalEnginesStatusJson.trim() ? (
                            <details className="text-[9px] text-gray-500">
                              <summary className="cursor-pointer text-gray-400 font-semibold">各引擎一览</summary>
                              <pre className="mt-1 whitespace-pre-wrap break-all max-h-32 overflow-y-auto rounded border border-[#2e2e32] bg-[#101014] p-2">
                                {companionLocalEnginesStatusJson}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      );
                    })()
                  ) : (
                    <p className="text-[10px] text-gray-500 leading-relaxed">连接或「重新检测」后将显示摘要。</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyCompanionDiagnostic()}
                      className="px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-950/35 text-[10px] font-bold text-amber-100 hover:bg-amber-900/40 transition-colors"
                    >
                      复制诊断（发给支持）
                    </button>
                    {companionDiagCopyHint ? (
                      <span className="text-[9px] text-gray-400">{companionDiagCopyHint}</span>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-lg border border-sky-500/20 bg-[#0c1418]/90 p-3 space-y-1">
                  <p className="text-[11px] text-sky-200/95 font-semibold">仍异常？</p>
                  <p className="text-[10px] text-gray-500 leading-relaxed">
                    网站不能替您重启本机进程。请打开<strong className="text-gray-400"> 桌面伴侣</strong>，在首页用「打开本机引擎」或「重启本地伴侣」（与托盘菜单一致）。
                  </p>
                </div>
                <div className="rounded-lg border border-violet-500/25 bg-[#14101c]/90 p-3 space-y-2">
                  <p className="text-[11px] text-gray-200 font-semibold">④ 分割 / 去背景 / OCR 自检</p>
                  <p className="text-[10px] text-gray-500 leading-relaxed">
                    环境在<strong className="text-gray-400">桌面伴侣</strong>里配置。下面由本机伴侣代为检查（结果可能被短缓存，排障时可设伴侣环境变量 <code className="text-violet-200/90">COMPANION_RUNTIME_PROBE_CACHE_MS=0</code> 后重启伴侣）。
                  </p>
                  <details className="rounded border border-[#2e2e32] bg-[#101014]/60 p-2 text-[9px] text-gray-500">
                    <summary className="cursor-pointer font-semibold text-gray-400">开发者参考</summary>
                    <div className="mt-2 space-y-1.5 leading-relaxed">
                      <p>
                        分割默认连本机 <code className="text-violet-200/85">127.0.0.1:18081</code>；伴侣进程需{' '}
                        <code className="text-violet-200/85">COMPANION_SAM_SEGMENT_URL</code>。仓库根可运行{' '}
                        <code className="text-violet-200/85">npm run dev:sam-local</code>、首次环境{' '}
                        <code className="text-violet-200/85">npm run setup:sam-local</code>。
                      </p>
                      <p>详细说明见仓库文档《本机分割故障排除》《本机分割一键安装指南》。</p>
                    </div>
                  </details>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleProbeSamSegmentHealth()}
                      disabled={companionSamHealthBusy || companionProbeBusy}
                      className="px-3 py-1.5 rounded-lg border border-violet-500/35 bg-violet-950/40 text-[10px] font-bold text-violet-100 hover:bg-violet-900/45 transition-colors disabled:opacity-50"
                    >
                      {companionSamHealthBusy ? '检查中…' : '检查本机分割'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleProbeRembgHealth()}
                      disabled={companionRembgDebugBusy || companionProbeBusy}
                      className="px-3 py-1.5 rounded-lg border border-violet-500/35 bg-violet-950/40 text-[10px] font-bold text-violet-100 hover:bg-violet-900/45 transition-colors disabled:opacity-50"
                    >
                      {companionRembgDebugBusy ? '检查中…' : '检查去背景'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleProbePaddleOcrHealth()}
                      disabled={companionPaddleOcrDebugBusy || companionProbeBusy}
                      className="px-3 py-1.5 rounded-lg border border-violet-500/35 bg-violet-950/40 text-[10px] font-bold text-violet-100 hover:bg-violet-900/45 transition-colors disabled:opacity-50"
                    >
                      {companionPaddleOcrDebugBusy ? '检查中…' : '检查 OCR'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopySamLocalEnvSnippet()}
                      className="px-3 py-1.5 rounded-lg border border-[#3f3f46] bg-[#1a1625] text-[10px] font-bold text-violet-200/90 hover:bg-[#252030] transition-colors"
                    >
                      复制环境变量
                    </button>
                  </div>
                  {(companionSamHealthSnippet || companionRembgDebugSnippet || companionPaddleOcrDebugSnippet) ? (
                    <details className="rounded border border-[#2e2e32] bg-[#101014] p-2">
                      <summary className="cursor-pointer text-[9px] font-semibold text-gray-500">上次自检原始输出</summary>
                      <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                        {companionSamHealthSnippet ? (
                          <pre className="text-[9px] text-gray-500 whitespace-pre-wrap break-all">{companionSamHealthSnippet}</pre>
                        ) : null}
                        {companionRembgDebugSnippet ? (
                          <pre className="text-[9px] text-gray-500 whitespace-pre-wrap break-all">{companionRembgDebugSnippet}</pre>
                        ) : null}
                        {companionPaddleOcrDebugSnippet ? (
                          <pre className="text-[9px] text-gray-500 whitespace-pre-wrap break-all">{companionPaddleOcrDebugSnippet}</pre>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </div>
                <details className="rounded-lg border border-dashed border-[#3f3f46] bg-[#16161a]/80 p-3 space-y-2">
                  <summary className="cursor-pointer text-[10px] font-bold text-gray-300">扩展包（管理员/可选）</summary>
                  <div className="mt-3 space-y-2">
                    <p className="text-[10px] text-gray-500 leading-relaxed">
                      与「本机引擎一键安装」<strong className="text-gray-400">不同路</strong>：用于后台下发的可选 ZIP。安装需已登录；直链/域名策略由部署方配置。
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleInstallHostBundle()}
                      disabled={hostBundleBusy}
                      className="px-4 py-2 rounded-xl bg-[#1e3a5f] hover:bg-[#264f7a] border border-[#3b82f6]/40 text-[10px] font-bold text-blue-100 transition-colors disabled:opacity-60"
                    >
                      {hostBundleBusy ? '安装中…' : '安装扩展包'}
                    </button>
                    {hostBundleHint ? (
                      <p className="text-[10px] text-gray-400 whitespace-pre-wrap break-words">{hostBundleHint}</p>
                    ) : null}
                    <div className="mt-3 pt-3 border-t border-[#2e2e32]/80 space-y-2">
                      <p className="text-[10px] text-gray-500 leading-relaxed">
                        <span className="text-gray-400 font-bold">包内计算</span>：probe / exec，与下方「任务进度」共用。
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleRefreshHostBundles()}
                          disabled={hostBundleListBusy || hostBundleBusy}
                          className="px-3 py-1.5 rounded-lg bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-[10px] font-bold text-gray-200 transition-colors disabled:opacity-60"
                        >
                          {hostBundleListBusy ? '刷新中…' : '刷新已安装包列表'}
                        </button>
                      </div>
                      <CustomDropdown
                        value={hostBundleSelectedDir}
                        onChange={setHostBundleSelectedDir}
                        disabled={hostBundleRows.length === 0}
                        options={[
                          { value: '', label: '请选择已安装包…' },
                          ...hostBundleRows.map((b) => ({
                            value: b.dirName,
                            label: `${b.semver} · ${b.dirName}${b.runSpec ? ' · run.json' : ''}`,
                          })),
                        ]}
                        placeholder="请选择…"
                        triggerClassName="w-full max-w-lg bg-[#101014] border border-[#2e2e32] rounded-lg px-3 py-2 text-[11px] text-left text-gray-200 flex items-center justify-between outline-none focus:border-blue-500 hover:bg-[#16161a] transition-colors disabled:opacity-50"
                      />
                      <p className="text-[9px] text-gray-600">
                        {activeWorkspaceProjectId?.trim()
                          ? `当前工作区 projectId 将写入任务元数据：${activeWorkspaceProjectId.trim()}`
                          : '未打开工作区项目时不附带 projectId（不影响执行）。'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleHostBundleProbe()}
                          disabled={hostBundleExecBusy || hostBundleListBusy || hostBundleRows.length === 0}
                          className="px-3 py-1.5 rounded-lg border border-[#15803d] bg-[#14532d]/80 text-[10px] font-bold text-green-100 hover:bg-[#166534]/90 transition-colors disabled:opacity-60"
                        >
                          {hostBundleExecBusy ? '提交中…' : '运行 probe'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleHostBundleExec()}
                          disabled={hostBundleExecBusy || hostBundleListBusy || hostBundleRows.length === 0}
                          className="px-3 py-1.5 rounded-lg border border-[#7c3aed] bg-[#3b0764]/80 text-[10px] font-bold text-violet-100 hover:bg-[#4c1d95]/90 transition-colors disabled:opacity-60"
                        >
                          {hostBundleExecBusy ? '提交中…' : '运行 exec'}
                        </button>
                      </div>
                      {hostBundleExecHint ? (
                        <p className="text-[10px] text-gray-400 whitespace-pre-wrap break-words">{hostBundleExecHint}</p>
                      ) : null}
                    </div>
                  </div>
                </details>
                <details className="rounded-lg border border-[#2e2e32] bg-[#16161a] group">
                  <summary className="cursor-pointer list-none px-3 py-2.5 text-[10px] font-bold text-gray-400 marker:content-none [&::-webkit-details-marker]:hidden">
                    本机地址（一般不用改）
                  </summary>
                  <div className="px-3 pb-3 space-y-3 border-t border-[#2e2e32] pt-2">
                    <div className="space-y-2">
                      <label className="block text-[10px] text-gray-400">本机地址</label>
                      <input
                        type="url"
                        value={companionBaseDraft}
                        onChange={(e) => setCompanionBaseDraft(e.target.value)}
                        placeholder="默认本机端口即可"
                        className="w-full px-3 py-2 rounded-xl bg-[#101014] border border-[#2e2e32] text-[11px] text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                        autoComplete="off"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveCompanionAdvanced}
                      className="px-4 py-2 rounded-xl bg-[#26262c] hover:bg-[#383842] border border-[#2e2e32] text-[10px] font-bold text-gray-200 transition-colors"
                    >
                      保存本机地址
                    </button>
                  </div>
                </details>
                <details className="rounded-lg border border-[#2e2e32] bg-[#16161a] group">
                  <summary className="cursor-pointer list-none px-3 py-2.5 text-[10px] font-bold text-gray-400 marker:content-none [&::-webkit-details-marker]:hidden">
                    原始接口数据
                  </summary>
                  <div className="px-3 pb-3 space-y-2 border-t border-[#2e2e32] pt-2">
                    {companionHealthSnippet ? (
                      <details className="rounded-lg border border-[#2e2e32] bg-[#101014] p-2">
                        <summary className="cursor-pointer text-[9px] font-bold text-gray-500">健康</summary>
                        <pre className="mt-2 text-[9px] text-gray-500 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                          {companionHealthSnippet}
                        </pre>
                      </details>
                    ) : null}
                    {companionCapSnippet ? (
                      <details className="rounded-lg border border-[#2e2e32] bg-[#101014] p-2">
                        <summary className="cursor-pointer text-[9px] font-bold text-gray-500">能力</summary>
                        <pre className="mt-2 text-[9px] text-gray-500 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                          {companionCapSnippet}
                        </pre>
                      </details>
                    ) : null}
                    {companionRelaySnippet ? (
                      <details className="rounded-lg border border-[#2e2e32] bg-[#101014] p-2">
                        <summary className="cursor-pointer text-[9px] font-bold text-gray-500">Relay</summary>
                        <pre className="mt-2 text-[9px] text-gray-500 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                          {companionRelaySnippet}
                        </pre>
                      </details>
                    ) : null}
                    {companionSeamSnippet ? (
                      <details className="rounded-lg border border-[#2e2e32] bg-[#101014] p-2">
                        <summary className="cursor-pointer text-[9px] font-bold text-gray-500">修缝</summary>
                        <pre className="mt-2 text-[9px] text-gray-500 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                          {companionSeamSnippet}
                        </pre>
                      </details>
                    ) : null}
                    {companionSamSnippet ? (
                      <details className="rounded-lg border border-[#2e2e32] bg-[#101014] p-2">
                        <summary className="cursor-pointer text-[9px] font-bold text-gray-500">分割配置</summary>
                        <pre className="mt-2 text-[9px] text-gray-500 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                          {companionSamSnippet}
                        </pre>
                      </details>
                    ) : null}
                    {companionProjectsSnippet ? (
                      <details className="rounded-lg border border-[#2e2e32] bg-[#101014] p-2">
                        <summary className="cursor-pointer text-[9px] font-bold text-gray-500">项目列表</summary>
                        <pre className="mt-2 text-[9px] text-gray-500 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                          {companionProjectsSnippet}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                </details>
                <details className="rounded-lg border border-[#2e2e32] bg-[#16161a]">
                  <summary className="cursor-pointer list-none px-3 py-2.5 text-[10px] font-bold text-gray-400 marker:content-none [&::-webkit-details-marker]:hidden">
                    任务进度（支持人员用）
                  </summary>
                  <div className="px-3 pb-3 space-y-3 border-t border-[#2e2e32] pt-2">
                    <input
                      type="text"
                      value={companionJobIdDraft}
                      onChange={(e) => setCompanionJobIdDraft(e.target.value)}
                      placeholder="任务编号（选填）"
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
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-blue-400/90 mb-1">AI 接入 · 输出口与接线</h3>
                  <p className="text-[9px] text-gray-500 leading-relaxed mb-3">
                    工作流选具体模型型号；此处配置供应商输出口与凭证。型号级接线见面板内预览，运营可通过 model-ops 调整单条 binding。
                  </p>
                  {onModelTextChange ? (
                    <label className="flex flex-col gap-2 rounded-lg border border-[#2a2a32] bg-[#101014] px-3 py-2.5">
                      <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">
                        默认文字模型
                      </span>
                      <CustomDropdown
                        options={effectiveTextModelRows.map((g) => ({
                          value: g.registryId,
                          label: g.label,
                          disabled: g.disabled,
                          title: g.disabledReason,
                        }))}
                        value={resolvedModelText}
                        onChange={(v) => {
                          const row = effectiveTextModelRows.find((g) => g.registryId === v);
                          if (row?.disabled) return;
                          onModelTextChange(coerceTextModelId(v));
                        }}
                        triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                      />
                      <p className="text-[8px] text-gray-600 leading-relaxed">
                        工作流文生文/图生文、对话、擂台等未单独指定模型时使用（当前：
                        {labelForTextModelRegistryId(resolvedModelText)}）。
                      </p>
                    </label>
                  ) : null}
                  <AiProviderCredentialsPanel onChanged={onAiInvocationSurfaceChange} />
                  <p className="text-[9px] text-gray-500 leading-relaxed">
                    生图模型运营策略：可配置{' '}
                    <code className="text-gray-400">VITE_MODEL_OPS_CONFIG_URL</code> 指向 JSON，工作区/擂台等会随策略禁用部分档位。{' '}
                    <button
                      type="button"
                      className="text-blue-400 hover:text-blue-300 underline"
                      onClick={() => {
                        void refreshModelOpsConfig();
                      }}
                    >
                      重新拉取
                    </button>
                  </p>
                </div>

                {/* 混元（腾讯云） */}
                <details className="rounded-xl border border-[#252528] p-4">
                  <summary className="cursor-pointer text-[11px] font-black uppercase tracking-wider text-blue-400/90 mb-1">
                    高级：混元（腾讯云）
                  </summary>
                  <div className="space-y-3 mt-3">
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
                </details>
              </div>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsSection;
