/** 自动同步倒计时文案（供侧栏 Tooltip 等复用，避免整树每秒 setState）。 */
export function formatWorkspaceSyncCountdownRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
