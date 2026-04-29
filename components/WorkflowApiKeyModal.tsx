import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_AI_PROVIDER,
  getAiProvider,
  setAiProvider,
  getUserApiKey,
  setUserApiKey,
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
  getTripoApiKey,
  setTripoApiKey,
  type AiProvider,
} from '../services/settingsStore';
import { CustomDropdown, DROPDOWN_TRIGGER_COMPACT } from './ui/CustomDropdown';
import AppIcon from './ui/AppIcon';
import { getCompanionLocalBaseUrl } from '../services/companionLocalPrefs';
import { probeCompanionHealth } from '../services/companionClient';

const AI_PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
  { value: 'trial', label: '试用（代理通道）' },
  { value: 'gemini', label: 'Google Gemini（官方 API）' },
  { value: 'vertex', label: 'Vertex AI（经 gemini-proxy）' },
  { value: 'toapis', label: 'ToAPIs 网关' },
  { value: 'antigravity', label: 'Antigravity Tools（本机反代）' },
  { value: 'vectorengine', label: '向量引擎 VectorEngine' },
];

export const WorkflowApiKeyModal: React.FC<{
  open: boolean;
  onClose: () => void;
  /** 保存成功后回调，用于刷新外部状态信号等 */
  onSaved?: () => void;
}> = ({ open, onClose, onSaved }) => {
  const [provider, setProvider] = useState<AiProvider>(DEFAULT_AI_PROVIDER);
  const [geminiKey, setGeminiKey] = useState('');
  const [toapisKey, setToapisKey] = useState('');
  const [agKey, setAgKey] = useState('');
  const [veKey, setVeKey] = useState('');
  const [toapisBase, setToapisBase] = useState('');
  const [agBase, setAgBase] = useState('');
  const [veBase, setVeBase] = useState('');
  const [tripoKey, setTripoKey] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [companionStatus, setCompanionStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [companionStatusText, setCompanionStatusText] = useState('检测中…');

  useEffect(() => {
    if (!open) return;
    setProvider(getAiProvider());
    setGeminiKey(getUserApiKey() ?? '');
    setToapisKey(getToapisApiKey() ?? '');
    setAgKey(getAntigravityApiKey() ?? '');
    setVeKey(getVectorengineApiKey() ?? '');
    setTripoKey(getTripoApiKey() ?? '');
    setToapisBase(getToapisBaseUrl());
    setAgBase(getAntigravityBaseUrl());
    setVeBase(getVectorengineBaseUrl());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: number | null = null;
    const run = async () => {
      setCompanionStatus('checking');
      setCompanionStatusText('检测中…');
      try {
        const base = getCompanionLocalBaseUrl();
        const r = await probeCompanionHealth(base);
        if (!alive) return;
        if (r.ok) {
          setCompanionStatus('online');
          setCompanionStatusText(`已连接（${base}）`);
        } else {
          setCompanionStatus('offline');
          setCompanionStatusText(`未连接（${base}）`);
        }
      } catch {
        if (!alive) return;
        setCompanionStatus('offline');
        setCompanionStatusText('未连接');
      }
      if (!alive) return;
      timer = window.setTimeout(run, 15000);
    };
    void run();
    return () => {
      alive = false;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [open]);

  const onEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open, onEscape]);

  if (!open) return null;

  const keyValue =
    provider === 'gemini'
      ? geminiKey
      : provider === 'vertex'
        ? ''
        : provider === 'trial'
          ? ''
        : provider === 'toapis'
          ? toapisKey
          : provider === 'antigravity'
            ? agKey
            : veKey;
  const setKeyValue = (v: string) => {
    if (provider === 'gemini') setGeminiKey(v);
    else if (provider === 'toapis') setToapisKey(v);
    else if (provider === 'antigravity') setAgKey(v);
    else if (provider === 'vectorengine') setVeKey(v);
  };

  const handleProviderChange = (value: string) => {
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
    setProvider(v);
  };

  const handleSave = () => {
    setAiProvider(provider);
    setUserApiKey(geminiKey.trim() || null);
    setToapisApiKey(toapisKey.trim() || null);
    setToapisBaseUrl(toapisBase.trim() || null);
    setAntigravityApiKey(agKey.trim() || null);
    setAntigravityBaseUrl(agBase.trim() || null);
    setVectorengineApiKey(veKey.trim() || null);
    setVectorengineBaseUrl(veBase.trim() || null);
    setTripoApiKey(tripoKey.trim() || null);
    setSavedFlash(true);
    onSaved?.();
    setTimeout(() => setSavedFlash(false), 2000);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0e0e14]/90 backdrop-blur-md shadow-xl p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-api-key-title"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="workflow-api-key-title" className="text-[11px] font-black uppercase tracking-wider text-blue-400">
            API 密钥
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white rounded-lg hover:bg-[#2e2e36]"
            aria-label="关闭"
          >
            <AppIcon name="close" className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <span className="block text-[9px] font-black uppercase text-gray-500 mb-2">供应商</span>
            <CustomDropdown
              options={AI_PROVIDER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              value={provider}
              onChange={handleProviderChange}
              triggerClassName={`${DROPDOWN_TRIGGER_COMPACT} w-full`}
              portalZIndex={{ backdrop: 2200, list: 2201 }}
            />
            <div className="mt-2 flex items-center gap-2 text-[10px]">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  companionStatus === 'online'
                    ? 'bg-emerald-400'
                    : companionStatus === 'checking'
                    ? 'bg-amber-300'
                    : 'bg-rose-400'
                }`}
              />
              <span className={companionStatus === 'online' ? 'text-emerald-300' : 'text-gray-400'}>
                本地伴侣：{companionStatusText}
              </span>
            </div>
          </div>
          {provider === 'antigravity' ? (
            <div>
              <span className="block text-[9px] font-black uppercase text-gray-500 mb-2">Base URL（含 /v1）</span>
              <input
                type="url"
                value={agBase}
                onChange={(e) => setAgBase(e.target.value)}
                placeholder="http://127.0.0.1:8045/v1"
                autoComplete="off"
                className="w-full min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none mb-3"
              />
            </div>
          ) : null}
          {provider === 'trial' ? (
            <p className="text-[10px] text-gray-500 leading-relaxed">
              试用模式固定走代理通道（<code className="text-gray-400">VITE_BULK_IMAGE_API</code>），无需填写 Key。
            </p>
          ) : provider === 'vertex' ? (
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Vertex 凭据在服务端配置（见 <code className="text-gray-400">docs/VERTEX_AI_INTEGRATION.md</code>
              ）；站点须设置 <code className="text-gray-400">VITE_BULK_IMAGE_API</code>。此处无需填写 Key。
            </p>
          ) : (
            <div>
              <span className="block text-[9px] font-black uppercase text-gray-500 mb-2">API Key</span>
              <input
                type="password"
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
                placeholder="粘贴密钥"
                autoComplete="off"
                className="w-full min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
              />
            </div>
          )}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black uppercase tracking-wider transition-colors"
            >
              {savedFlash ? '已保存' : '保存'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl bg-[#26262c] border border-[#343438] text-[10px] font-black uppercase text-gray-300 hover:bg-white/15 transition-colors"
            >
              关闭
            </button>
          </div>
          <div className="pt-2 border-t border-white/10">
            <span className="block text-[9px] font-black uppercase text-gray-500 mb-2">Tripo API Key（3D）</span>
            <input
              type="password"
              value={tripoKey}
              onChange={(e) => setTripoKey(e.target.value)}
              placeholder="tsk_..."
              autoComplete="off"
              className="w-full min-w-0 px-4 py-3 rounded-xl bg-[#16161a] border border-[#2e2e32] text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
            />
            <p className="mt-2 text-[10px] text-gray-500">
              用于工作流「生成3D」预设调用 Tripo（当前测试版为前端直连）。
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
