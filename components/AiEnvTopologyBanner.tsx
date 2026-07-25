import React, { useEffect, useState } from 'react';
import { readSessionJson, writeSessionJson } from '../services/clientPersist';
import { warnAiEnvTopologyOnce } from '../services/aiEnvTopology';

/** Session-only dismiss (D3) — refresh / new tab shows banner again for severe mismatch. */
const DISMISS_KEY = 'ac_ai_env_topology_banner_dismissed';

/**
 * DEV：auth↔proxy 拓扑错配黄条（C5/D3）。生产不展示（靠 env:profile:prod-like 硬失败）。
 */
export const AiEnvTopologyBanner: React.FC = () => {
  const [dismissed, setDismissed] = useState(() => readSessionJson<boolean>(DISMISS_KEY, false) === true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (!import.meta.env.DEV || import.meta.env.PROD) return;
    } catch {
      return;
    }
    const result = warnAiEnvTopologyOnce();
    if (!result.ok && result.issue) setMessage(result.issue.messageZh);
  }, []);

  if (dismissed || !message) return null;

  return (
    <div className="mx-0 mb-2 flex shrink-0 items-center gap-2 rounded-lg border border-amber-700/45 bg-amber-950/30 px-3 py-2 text-[10px] text-amber-100/90">
      <p className="min-w-0 flex-1 leading-relaxed">{message}</p>
      <button
        type="button"
        onClick={() => {
          writeSessionJson(DISMISS_KEY, true);
          setDismissed(true);
        }}
        className="shrink-0 rounded-md px-1.5 py-1 text-[9px] text-amber-200/70 hover:text-amber-50"
        aria-label="关闭拓扑提示（本标签页会话）"
        title="关闭后本标签页不再显示；刷新或新标签会再出现"
      >
        关闭
      </button>
    </div>
  );
};

export default AiEnvTopologyBanner;
