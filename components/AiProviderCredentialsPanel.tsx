import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ModelWiringPanel from './ModelWiringPanel';
import {
  CHANNEL_CATALOG,
  type ChannelCatalogRow,
} from '../services/modelRegistry/channelCatalog';
import {
  AI_CONNECTION_CATALOG,
  connectionEnabledChannels,
  connectionStatus,
  type AiConnectionCatalogRow,
  type AiConnectionStatus,
} from '../services/modelRegistry/connectionCatalog';
import type { ChannelId } from '../services/modelRegistry/types';
import {
  aiConnectionStatusLabel,
  getAiConnectionSummary,
  getEnabledChannels,
  getOpenaiApiKey,
  getOpenaiBaseUrl,
  getToapisApiKey,
  getToapisBaseUrl,
  getUserApiKey,
  getVectorengineApiKey,
  getVectorengineBaseUrl,
  isChannelReady,
  isVertexSiteProxyConfigured,
  setChannelEnabled,
  setToapisGatewayEnabled,
  setOpenaiApiKey,
  setOpenaiBaseUrl,
  setToapisApiKey,
  setToapisBaseUrl,
  setUserApiKey,
  setVectorengineApiKey,
  setVectorengineBaseUrl,
  subscribeAiSettingsCrossTab,
} from '../services/settingsStore';

const INPUT_CLS =
  'w-full min-w-0 px-3 py-2 rounded-lg bg-[#16161a] border border-[#2e2e32] text-[11px] text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none';

type ChannelDraft = { apiKey: string; baseUrl: string };

function channelRow(channel: ChannelId): ChannelCatalogRow | undefined {
  return CHANNEL_CATALOG.find((r) => r.channel === channel);
}

function readToapisDraft(): ChannelDraft {
  return { apiKey: getToapisApiKey() ?? '', baseUrl: getToapisBaseUrl() };
}

function readChannelDraft(channel: ChannelId): ChannelDraft {
  switch (channel) {
    case 'gemini-aistudio':
      return { apiKey: getUserApiKey() ?? '', baseUrl: '' };
    case 'toapis-gemini':
    case 'toapis-openai':
      return readToapisDraft();
    case 'openai-official':
      return { apiKey: getOpenaiApiKey() ?? '', baseUrl: getOpenaiBaseUrl() };
    case 'vectorengine':
      return { apiKey: getVectorengineApiKey() ?? '', baseUrl: getVectorengineBaseUrl() };
    default:
      return { apiKey: '', baseUrl: '' };
  }
}

function saveChannelDraft(channel: ChannelId, draft: ChannelDraft): void {
  switch (channel) {
    case 'gemini-aistudio':
      setUserApiKey(draft.apiKey.trim() || null);
      break;
    case 'toapis-gemini':
    case 'toapis-openai':
      setToapisApiKey(draft.apiKey.trim() || null);
      setToapisBaseUrl(draft.baseUrl.trim() || null);
      break;
    case 'openai-official':
      setOpenaiApiKey(draft.apiKey.trim() || null);
      setOpenaiBaseUrl(draft.baseUrl.trim() || null);
      break;
    case 'vectorengine':
      setVectorengineApiKey(draft.apiKey.trim() || null);
      setVectorengineBaseUrl(draft.baseUrl.trim() || null);
      break;
    default:
      break;
  }
}

function maskKey(value: string): string {
  const t = value.trim();
  if (!t) return '';
  if (t.length <= 8) return '••••••••';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

function connectionHasCredentials(connection: AiConnectionCatalogRow): boolean {
  return connection.credentialKind !== 'site' && connection.credentialKind !== 'multi-path'
    ? connection.channels.some((ch) => {
        const row = channelRow(ch);
        return row?.needsApiKey || row?.needsBaseUrl;
      })
    : connection.credentialKind === 'multi-path';
}

function OverviewBar({ compact }: { compact: boolean }) {
  const summary = getAiConnectionSummary();
  const dotCls = summary.anyReady
    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.45)]'
    : summary.enabled > 0
      ? 'bg-amber-400'
      : 'bg-gray-500';

  return (
    <div
      className={`rounded-xl border border-[#2a2a30] bg-gradient-to-br from-[#18181c] to-[#121214] ${
        compact ? 'p-2.5' : 'p-3.5'
      }`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dotCls}`} aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-semibold text-gray-100">
            {summary.anyReady
              ? `${summary.ready}/${summary.total} 个输出口已就绪`
              : summary.enabled > 0
                ? '已启用输出口，尚待补全凭证'
                : '尚未启用供应商输出口'}
          </p>
          <p className="text-[9px] text-gray-500 leading-relaxed max-w-md">
            <strong className="font-semibold text-gray-400">输入口</strong>：工作流里选具体模型型号（registryId）。{' '}
            <strong className="font-semibold text-gray-400">输出口</strong>：下方启用供应商线路并填凭证。{' '}
            <strong className="font-semibold text-gray-400">接线</strong>：各型号走哪条输出口由平台 binding 表决定（见下方预览）；启用多条时按优先级自动切换。文本与生图可接不同输出口。
          </p>
        </div>
      </div>
    </div>
  );
}

function CredentialFields({
  channel,
  draft,
  disabled,
  onDraftChange,
  onSave,
}: {
  channel: ChannelId;
  draft: ChannelDraft;
  disabled: boolean;
  onDraftChange: (patch: Partial<ChannelDraft>) => void;
  onSave: () => void;
}) {
  const row = channelRow(channel);
  if (!row) return null;
  return (
    <div className={`space-y-2 ${disabled ? 'opacity-45 pointer-events-none' : ''}`}>
      {row.needsBaseUrl ? (
        <input
          type="url"
          value={draft.baseUrl}
          onChange={(e) => onDraftChange({ baseUrl: e.target.value })}
          onBlur={onSave}
          placeholder={row.baseUrlPlaceholder}
          autoComplete="off"
          className={INPUT_CLS}
        />
      ) : null}
      {row.needsApiKey ? (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            value={draft.apiKey}
            onChange={(e) => onDraftChange({ apiKey: e.target.value })}
            onBlur={onSave}
            placeholder={row.keyPlaceholder}
            autoComplete="off"
            className={`${INPUT_CLS} flex-1`}
          />
          <button
            type="button"
            onClick={onSave}
            className="shrink-0 px-3 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-[10px] font-bold text-gray-200 ring-1 ring-white/[0.08] transition-colors"
          >
            保存
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ConnectionCard({
  connection,
  enabledChannels,
  drafts,
  toapisDraft,
  compact,
  expanded,
  onToggleExpand,
  onToggleChannel,
  onSetToapisGateway,
  onUpdateDraft,
  onSaveChannel,
  onSaveToapis,
  onToapisDraftChange,
}: {
  connection: AiConnectionCatalogRow;
  enabledChannels: ChannelId[];
  drafts: Record<ChannelId, ChannelDraft>;
  toapisDraft: ChannelDraft;
  compact: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleChannel: (channel: ChannelId, next: boolean) => void;
  onSetToapisGateway?: (next: boolean) => void;
  onUpdateDraft: (channel: ChannelId, patch: Partial<ChannelDraft>) => void;
  onSaveChannel: (channel: ChannelId) => void;
  onSaveToapis: () => void;
  onToapisDraftChange: (patch: Partial<ChannelDraft>) => void;
}) {
  const status: AiConnectionStatus = connectionStatus(
    connection,
    enabledChannels,
    isChannelReady,
    isVertexSiteProxyConfigured
  );
  const badge = aiConnectionStatusLabel(status);
  const active = connectionEnabledChannels(connection, enabledChannels);
  const anyActive = active.length > 0;
  const primaryChannel = connection.channels[0]!;
  const showCredentials = connectionHasCredentials(connection);

  const setConnectionEnabled = (next: boolean) => {
    if (connection.credentialKind === 'multi-path') {
      onSetToapisGateway?.(next);
      return;
    }
    for (const ch of connection.channels) onToggleChannel(ch, next);
  };

  const summaryLine = useMemo(() => {
    if (connection.credentialKind === 'site') {
      return status === 'site-unavailable'
        ? '站点未配置 Vertex 代理环境，请联系管理员'
        : '使用站点额度，无需填写 Key';
    }
    if (connection.credentialKind === 'multi-path') {
      const key = toapisDraft.apiKey.trim();
      return key ? `密钥 ${maskKey(key)}` : '填写一套密钥并启用网关';
    }
    const ch = primaryChannel;
    const d = drafts[ch] ?? readChannelDraft(ch);
    const key = d.apiKey.trim();
    return key ? `密钥 ${maskKey(key)}` : '需自备 API Key';
  }, [connection.credentialKind, drafts, enabledChannels, primaryChannel, status, toapisDraft.apiKey]);

  return (
    <div className={`rounded-xl border border-[#2a2a30] bg-[#16161a] ${compact ? 'p-2.5' : 'p-3'}`}>
      <div className="flex flex-wrap items-start gap-2">
        <label className="inline-flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
          <input
            type="checkbox"
            checked={anyActive}
            onChange={(e) => setConnectionEnabled(e.target.checked)}
            className="h-3.5 w-3.5 shrink-0 rounded border-[#3a3a40] bg-[#121214] text-blue-500 focus:ring-blue-500/40"
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold text-gray-100">{connection.title}</span>
            </span>
            <span className="block text-[9px] text-gray-500 mt-0.5 leading-relaxed">{connection.subtitle}</span>
          </span>
        </label>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[9px] font-bold ring-1 ${badge.cls}`}>{badge.text}</span>
      </div>

      <p className="text-[9px] text-gray-500 leading-relaxed mt-2 pl-5">{connection.outletHint}</p>
      <p className="text-[9px] text-gray-400 mt-1 pl-5">{summaryLine}</p>

      {showCredentials ? (
        <div className="mt-2 pl-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onToggleExpand}
            className="text-[9px] font-bold text-blue-400/90 hover:text-blue-300"
          >
            {expanded ? '收起凭证' : anyActive ? '编辑凭证' : '配置凭证'}
          </button>
        </div>
      ) : null}

      {expanded && showCredentials ? (
        <div className="mt-3 pl-5 space-y-3 border-t border-white/[0.06] pt-3">
          {connection.credentialKind === 'multi-path' ? (
            <CredentialFields
              channel="toapis-gemini"
              draft={toapisDraft}
              disabled={!anyActive}
              onDraftChange={onToapisDraftChange}
              onSave={onSaveToapis}
            />
          ) : (
            connection.channels.map((ch) => (
              <div key={ch}>
                <CredentialFields
                  channel={ch}
                  draft={drafts[ch] ?? readChannelDraft(ch)}
                  disabled={!enabledChannels.includes(ch)}
                  onDraftChange={(patch) => onUpdateDraft(ch, patch)}
                  onSave={() => onSaveChannel(ch)}
                />
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export type AiProviderCredentialsPanelProps = {
  onChanged?: () => void;
  compact?: boolean;
};

export default function AiProviderCredentialsPanel({ onChanged, compact = false }: AiProviderCredentialsPanelProps) {
  const [enabledChannels, setEnabledChannelsState] = useState<ChannelId[]>(() => getEnabledChannels());
  const [drafts, setDrafts] = useState<Record<ChannelId, ChannelDraft>>(() => {
    const init = {} as Record<ChannelId, ChannelDraft>;
    for (const row of CHANNEL_CATALOG) init[row.channel] = readChannelDraft(row.channel);
    return init;
  });
  const [toapisDraft, setToapisDraft] = useState<ChannelDraft>(() => readToapisDraft());
  const [savedFlash, setSavedFlash] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const reloadFromStore = useCallback(() => {
    setEnabledChannelsState(getEnabledChannels());
    const next = {} as Record<ChannelId, ChannelDraft>;
    for (const row of CHANNEL_CATALOG) next[row.channel] = readChannelDraft(row.channel);
    setDrafts(next);
    setToapisDraft(readToapisDraft());
  }, []);

  useEffect(() => {
    return subscribeAiSettingsCrossTab(reloadFromStore);
  }, [reloadFromStore]);

  const flashSaved = () => {
    setSavedFlash(true);
    onChanged?.();
    window.setTimeout(() => setSavedFlash(false), 1800);
  };

  const handleToggle = (channel: ChannelId, nextEnabled: boolean) => {
    setChannelEnabled(channel, nextEnabled);
    setEnabledChannelsState(getEnabledChannels());
    onChanged?.();
  };

  const handleToapisGateway = (nextEnabled: boolean) => {
    setToapisGatewayEnabled(nextEnabled);
    setEnabledChannelsState(getEnabledChannels());
    onChanged?.();
  };

  const updateDraft = (channel: ChannelId, patch: Partial<ChannelDraft>) => {
    setDrafts((prev) => ({ ...prev, [channel]: { ...prev[channel], ...patch } }));
    if (channel === 'toapis-gemini' || channel === 'toapis-openai') {
      setToapisDraft((prev) => ({ ...prev, ...patch }));
    }
  };

  const handleSaveRow = (channel: ChannelId) => {
    saveChannelDraft(channel, drafts[channel] ?? readChannelDraft(channel));
    flashSaved();
  };

  const handleSaveToapis = () => {
    saveChannelDraft('toapis-gemini', toapisDraft);
    setToapisDraft(readToapisDraft());
    flashSaved();
  };

  const handleSaveAll = () => {
    for (const row of CHANNEL_CATALOG) {
      const meta = AI_CONNECTION_CATALOG.find((c) => (c.channels as readonly string[]).includes(row.channel));
      if (meta?.credentialKind === 'multi-path' && row.channel !== 'toapis-gemini') continue;
      if (row.needsApiKey || row.needsBaseUrl) {
        saveChannelDraft(row.channel, drafts[row.channel] ?? readChannelDraft(row.channel));
      }
    }
    handleSaveToapis();
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const isExpanded = (connection: AiConnectionCatalogRow) => {
    if (expandedIds[connection.id] === true) return true;
    if (expandedIds[connection.id] === false) return false;
    const st = connectionStatus(connection, enabledChannels, isChannelReady, isVertexSiteProxyConfigured);
    return st === 'pending' || st === 'site-unavailable';
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <OverviewBar compact={compact} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleSaveAll}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold uppercase tracking-wider transition-colors"
        >
          保存全部凭证
        </button>
      </div>

      <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500">供应商输出口</p>

      <div className="space-y-2">
        {AI_CONNECTION_CATALOG.map((connection) => (
          <div key={connection.id}>
            <ConnectionCard
              connection={connection}
              enabledChannels={enabledChannels}
              drafts={drafts}
              toapisDraft={toapisDraft}
              compact={compact}
              expanded={isExpanded(connection)}
              onToggleExpand={() => toggleExpanded(connection.id)}
              onToggleChannel={handleToggle}
              onSetToapisGateway={handleToapisGateway}
              onUpdateDraft={updateDraft}
              onSaveChannel={handleSaveRow}
              onSaveToapis={handleSaveToapis}
              onToapisDraftChange={(patch) => setToapisDraft((prev) => ({ ...prev, ...patch }))}
            />
          </div>
        ))}
      </div>

      {!compact ? (
        <div className="rounded-xl border border-[#252528] bg-[#101012]/80 p-3">
          <ModelWiringPanel enabledChannels={enabledChannels} />
        </div>
      ) : null}

      {savedFlash ? <p className="text-[10px] text-green-400/90">已保存到本机</p> : null}
    </div>
  );
}
