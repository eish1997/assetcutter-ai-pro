import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  getAiProvider,
  setAiProvider,
  getUserApiKey,
  setUserApiKey,
  getToapisApiKey,
  setToapisApiKey,
  getToapisBaseUrl,
  setToapisBaseUrl,
  getVectorengineApiKey,
  setVectorengineApiKey,
  getVectorengineBaseUrl,
  setVectorengineBaseUrl,
  type AiProvider,
} from '../services/settingsStore';
import { CustomDropdown, DROPDOWN_TRIGGER_COMPACT } from './ui/CustomDropdown';
import AppIcon from './ui/AppIcon';

const AI_PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
  { value: 'gemini', label: 'Google Gemini（官方 API）' },
  { value: 'toapis', label: 'ToAPIs 网关' },
  { value: 'vectorengine', label: '向量引擎 VectorEngine' },
];

export const WorkflowApiKeyModal: React.FC<{
  open: boolean;
  onClose: () => void;
  /** 保存成功后回调，用于刷新外部状态信号等 */
  onSaved?: () => void;
}> = ({ open, onClose, onSaved }) => {
  const [provider, setProvider] = useState<AiProvider>('gemini');
  const [geminiKey, setGeminiKey] = useState('');
  const [toapisKey, setToapisKey] = useState('');
  const [veKey, setVeKey] = useState('');
  const [toapisBase, setToapisBase] = useState('');
  const [veBase, setVeBase] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProvider(getAiProvider());
    setGeminiKey(getUserApiKey() ?? '');
    setToapisKey(getToapisApiKey() ?? '');
    setVeKey(getVectorengineApiKey() ?? '');
    setToapisBase(getToapisBaseUrl());
    setVeBase(getVectorengineBaseUrl());
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

  const keyValue = provider === 'gemini' ? geminiKey : provider === 'toapis' ? toapisKey : veKey;
  const setKeyValue = (v: string) => {
    if (provider === 'gemini') setGeminiKey(v);
    else if (provider === 'toapis') setToapisKey(v);
    else setVeKey(v);
  };

  const handleProviderChange = (value: string) => {
    const v: AiProvider =
      value === 'toapis' ? 'toapis' : value === 'vectorengine' ? 'vectorengine' : 'gemini';
    setProvider(v);
  };

  const handleSave = () => {
    setAiProvider(provider);
    setUserApiKey(geminiKey.trim() || null);
    setToapisApiKey(toapisKey.trim() || null);
    setToapisBaseUrl(toapisBase.trim() || null);
    setVectorengineApiKey(veKey.trim() || null);
    setVectorengineBaseUrl(veBase.trim() || null);
    setSavedFlash(true);
    onSaved?.();
    setTimeout(() => setSavedFlash(false), 2000);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0f0f] shadow-xl p-5"
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
            className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white rounded-lg hover:bg-white/10"
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
          </div>
          <div>
            <span className="block text-[9px] font-black uppercase text-gray-500 mb-2">API Key</span>
            <input
              type="password"
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              placeholder="粘贴密钥"
              autoComplete="off"
              className="w-full min-w-0 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-sm text-white placeholder-gray-500 focus:border-blue-500/50 focus:outline-none"
            />
          </div>
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
              className="px-5 py-2.5 rounded-xl bg-white/10 border border-white/15 text-[10px] font-black uppercase text-gray-300 hover:bg-white/15 transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
