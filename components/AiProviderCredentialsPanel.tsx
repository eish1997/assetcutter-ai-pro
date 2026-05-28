import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CHANNEL_CATALOG,
  channelsForFamilyPanel,
  isToapisPathChannel,
  TOAPIS_PATH_CHANNELS,
  type ChannelCatalogRow,
} from '../services/modelRegistry/channelCatalog';
import type { ChannelId, ModelFamily } from '../services/modelRegistry/types';
import {
  getEnabledChannels,
  getOpenaiApiKey,
  getOpenaiBaseUrl,
  getToapisApiKey,
  getToapisBaseUrl,
  getUserApiKey,
  getVectorengineApiKey,
  getVectorengineBaseUrl,
  isChannelReady,
  setChannelEnabled,
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

type ChannelDraft = {
  apiKey: string;
  baseUrl: string;
};

const FAMILY_LABELS: Record<ModelFamily, string> = {
  gemini: 'Gemini 系通道',
  openai: 'OpenAI 系通道',
};

const TOAPIS_PATH_LABELS = {
  'toapis-gemini': 'Gemini 路径',
  'toapis-openai': 'OpenAI 路径',
} as const satisfies Record<(typeof TOAPIS_PATH_CHANNELS)[number], string>;

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

function channelStatusLabel(channel: ChannelId, enabled: boolean): { text: string; cls: string } {
  if (!enabled) return { text: '未启用', cls: 'text-gray-500 ring-white/[0.08] bg-white/[0.03]' };
  if (isChannelReady(channel)) return { text: '可用', cls: 'text-emerald-300 ring-emerald-500/30 bg-emerald-950/30' };
  return { text: '待配置', cls: 'text-amber-300 ring-amber-500/30 bg-amber-950/25' };
}

type ChannelRowProps = {
  row: ChannelCatalogRow;
  enabled: boolean;
  draft: ChannelDraft;
  compact: boolean;
  onToggle: (next: boolean) => void;
  onDraftChange: (patch: Partial<ChannelDraft>) => void;
  onSave: () => void;
};

function ChannelRow({
  row,
  enabled,
  draft,
  compact,
  onToggle,
  onDraftChange,
  onSave,
}: ChannelRowProps) {
  const status = channelStatusLabel(row.channel, enabled);
  return (
    <div
      className={`rounded-xl border border-[#2a2a30] bg-[#16161a] ${compact ? 'p-2.5' : 'p-3'} space-y-2 ${
        row.deprecated ? 'opacity-60' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-3.5 w-3.5 shrink-0 rounded border-[#3a3a40] bg-[#121214] text-blue-500 focus:ring-blue-500/40"
          />
          <span className="text-[10px] font-semibold text-gray-100 leading-snug">{row.label}</span>
        </label>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[9px] font-bold ring-1 ${status.cls}`}>
          {status.text}
        </span>
      </div>

      {row.hint ? <p className="text-[9px] text-gray-500 leading-relaxed pl-5">{row.hint}</p> : null}

      {row.needsBaseUrl ? (
        <input
          type="url"
          value={draft.baseUrl}
          onChange={(e) => onDraftChange({ baseUrl: e.target.value })}
          onBlur={onSave}
          placeholder={row.baseUrlPlaceholder}
          autoComplete="off"
          disabled={!enabled}
          className={`${INPUT_CLS} ${!enabled ? 'opacity-45' : ''}`}
        />
      ) : null}

      {row.needsApiKey ? (
        <div className="flex flex-col sm:flex-row gap-2 pl-0 sm:pl-5">
          <input
            type="password"
            value={draft.apiKey}
            onChange={(e) => onDraftChange({ apiKey: e.target.value })}
            onBlur={onSave}
            placeholder={row.keyPlaceholder}
            autoComplete="off"
            disabled={!enabled}
            className={`${INPUT_CLS} flex-1 ${!enabled ? 'opacity-45' : ''}`}
          />
          <button
            type="button"
            disabled={!enabled}
            onClick={onSave}
            className="shrink-0 px-3 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-[10px] font-bold text-gray-200 ring-1 ring-white/[0.08] disabled:opacity-40 transition-colors"
          >
            保存
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ToApisPathGroup({
  enabledChannels,
  draft,
  compact,
  onTogglePath,
  onDraftChange,
  onSave,
}: {
  enabledChannels: ChannelId[];
  draft: ChannelDraft;
  compact: boolean;
  onTogglePath: (channel: ChannelId, next: boolean) => void;
  onDraftChange: (patch: Partial<ChannelDraft>) => void;
  onSave: () => void;
}) {
  const anyEnabled = TOAPIS_PATH_CHANNELS.some((ch) => enabledChannels.includes(ch));
  const anyReady = TOAPIS_PATH_CHANNELS.some((ch) => enabledChannels.includes(ch) && isChannelReady(ch));
  const status = !anyEnabled
    ? { text: '未启用', cls: 'text-gray-500 ring-white/[0.08] bg-white/[0.03]' }
    : anyReady
      ? { text: '可用', cls: 'text-emerald-300 ring-emerald-500/30 bg-emerald-950/30' }
      : { text: '待配置', cls: 'text-amber-300 ring-amber-500/30 bg-amber-950/25' };

  return (
    <div className={`rounded-xl border border-[#2a2a30] bg-[#16161a] ${compact ? 'p-2.5' : 'p-3'} space-y-2`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold text-gray-100 leading-snug flex-1">ToAPIs 网关（中转 · 共用密钥）</span>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[9px] font-bold ring-1 ${status.cls}`}>{status.text}</span>
      </div>
      <p className="text-[9px] text-gray-500 leading-relaxed">
        同一套 Key / Base URL；勾选已接入的路径即可挂 binding（Gemini 系 / OpenAI 系可分别启用）。
      </p>
      <input
        type="url"
        value={draft.baseUrl}
        onChange={(e) => onDraftChange({ baseUrl: e.target.value })}
        onBlur={onSave}
        placeholder="https://toapis.com/v1"
        autoComplete="off"
        className={INPUT_CLS}
      />
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="password"
          value={draft.apiKey}
          onChange={(e) => onDraftChange({ apiKey: e.target.value })}
          onBlur={onSave}
          placeholder="ToAPIs API Key"
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
      <div className="flex flex-wrap gap-3 pl-0 sm:pl-1 pt-1">
        {TOAPIS_PATH_CHANNELS.map((ch) => (
          <label key={ch} className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={enabledChannels.includes(ch)}
              onChange={(e) => onTogglePath(ch, e.target.checked)}
              className="h-3.5 w-3.5 shrink-0 rounded border-[#3a3a40] bg-[#121214] text-blue-500 focus:ring-blue-500/40"
            />
            <span className="text-[9px] text-gray-300">{TOAPIS_PATH_LABELS[ch]}</span>
          </label>
        ))}
      </div>
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

  const families = useMemo(() => ['gemini', 'openai'] as const, []);

  const handleToggle = (channel: ChannelId, nextEnabled: boolean) => {
    setChannelEnabled(channel, nextEnabled);
    setEnabledChannelsState(getEnabledChannels());
    onChanged?.();
  };

  const updateDraft = (channel: ChannelId, patch: Partial<ChannelDraft>) => {
    setDrafts((prev) => ({ ...prev, [channel]: { ...prev[channel], ...patch } }));
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
      if (isToapisPathChannel(row.channel)) continue;
      if (row.needsApiKey || row.needsBaseUrl) {
        saveChannelDraft(row.channel, drafts[row.channel] ?? readChannelDraft(row.channel));
      }
    }
    handleSaveToapis();
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[9px] text-gray-500 leading-relaxed">
          按模型族配置通道接线；同一产品模型可挂多条 binding，运行时按优先级自动 failover。
        </p>
        <button
          type="button"
          onClick={handleSaveAll}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold uppercase tracking-wider transition-colors"
        >
          保存全部
        </button>
      </div>

      {families.map((family) => (
        <div key={family} className="space-y-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500">{FAMILY_LABELS[family]}</p>
          {channelsForFamilyPanel(family).map((row) => {
            const enabled = enabledChannels.includes(row.channel);
            const draft = drafts[row.channel] ?? readChannelDraft(row.channel);
            return (
              <div key={row.channel}>
                <ChannelRow
                  row={row}
                  enabled={enabled}
                  draft={draft}
                  compact={compact}
                  onToggle={(next) => handleToggle(row.channel, next)}
                  onDraftChange={(patch) => updateDraft(row.channel, patch)}
                  onSave={() => handleSaveRow(row.channel)}
                />
              </div>
            );
          })}
        </div>
      ))}

      <div className="space-y-2">
        <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500">中转 · ToAPIs</p>
        <ToApisPathGroup
          enabledChannels={enabledChannels}
          draft={toapisDraft}
          compact={compact}
          onTogglePath={handleToggle}
          onDraftChange={(patch) => setToapisDraft((prev) => ({ ...prev, ...patch }))}
          onSave={handleSaveToapis}
        />
      </div>

      {savedFlash ? <p className="text-[10px] text-green-400/90">已保存到本机</p> : null}
    </div>
  );
}
