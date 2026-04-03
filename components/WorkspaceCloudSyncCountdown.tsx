import React, { useEffect, useState } from 'react';

function formatCountdownText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * 自动同步倒计时：独立 1s 刷新，避免在 App 根上 setState 导致整个工作区（含 WorkflowSection）每秒重绘。
 */
export function WorkspaceCloudSyncCountdown({
  enabled,
  nextAt,
  syncing,
}: {
  enabled: boolean;
  nextAt: number | null;
  syncing: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled || nextAt == null) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [enabled, nextAt]);

  if (syncing) return <>正在同步...</>;
  if (!enabled) return <>已关闭</>;
  if (nextAt == null) return <>--:--</>;
  return <>{formatCountdownText(nextAt - now)}</>;
}
