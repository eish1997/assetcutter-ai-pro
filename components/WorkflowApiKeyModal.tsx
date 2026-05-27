import React, { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getTripoApiKey, setTripoApiKey } from '../services/settingsStore';
import AiProviderCredentialsPanel from './AiProviderCredentialsPanel';
import AppIcon from './ui/AppIcon';

export const WorkflowApiKeyModal: React.FC<{
  open: boolean;
  onClose: () => void;
  /** 保存成功后回调，用于刷新外部状态信号等 */
  onSaved?: () => void;
}> = ({ open, onClose, onSaved }) => {
  const [tripoKey, setTripoKey] = React.useState('');

  useEffect(() => {
    if (!open) return;
    setTripoKey(getTripoApiKey() ?? '');
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

  const handleSaveTripo = () => {
    setTripoApiKey(tripoKey.trim() || null);
    onSaved?.();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-lg max-h-[min(88vh,720px)] overflow-y-auto rounded-2xl border border-white/10 bg-[#0e0e14]/90 backdrop-blur-md shadow-xl p-5"
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
        <div className="space-y-5">
          <AiProviderCredentialsPanel compact onChanged={onSaved} />
          <div className="rounded-xl border border-[#2a2a30] bg-[#16161a] p-3 space-y-2">
            <span className="block text-[10px] font-semibold text-gray-200">Tripo 3D（可选）</span>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="password"
                value={tripoKey}
                onChange={(e) => setTripoKey(e.target.value)}
                placeholder="Tripo API Key"
                autoComplete="off"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[#121214] border border-[#2e2e32] text-[11px] text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveTripo}
                className="shrink-0 px-3 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-[10px] font-bold text-gray-200 ring-1 ring-white/[0.08]"
              >
                保存 Tripo
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default WorkflowApiKeyModal;
