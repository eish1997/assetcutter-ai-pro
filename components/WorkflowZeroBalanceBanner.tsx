import React from 'react';
import { readLocalJson, scopedStorageKey, writeLocalJson } from '../services/clientPersist';
import { navigateToSettingsSection } from '../services/navigateSettings';

const DISMISS_KEY_BASE = 'ac_workflow_zero_balance_banner_dismissed';

type WorkflowZeroBalanceBannerProps = {
  preferenceScope: string | null | undefined;
  balance: number | null;
  loading: boolean;
  compact?: boolean;
};

/** 余额为 0 时的轻量引导（可关闭，按账号记忆）。不占工作区顶栏行高。 */
export const WorkflowZeroBalanceBanner: React.FC<WorkflowZeroBalanceBannerProps> = ({
  preferenceScope,
  balance,
  loading,
  compact = false,
}) => {
  const dismissKey = scopedStorageKey(DISMISS_KEY_BASE, preferenceScope);
  const [dismissed, setDismissed] = React.useState(() => readLocalJson<boolean>(dismissKey) === true);

  if (loading || balance == null || balance > 0 || dismissed) return null;

  return (
    <div
      className={
        compact
          ? 'mb-1.5 flex flex-col gap-1.5 rounded-md border border-rose-800/40 bg-rose-950/25 px-2.5 py-1.5 text-[9px] text-rose-100/90'
          : 'flex items-center gap-2 rounded-lg border border-rose-800/40 bg-rose-950/25 px-3 py-2 text-[10px] text-rose-100/90'
      }
    >
      <p className="min-w-0 flex-1 leading-relaxed">
        {compact
          ? '积分已用完，代理任务无法执行。'
          : 'AI 积分已用完，生图 / 视频 / 3D 等代理任务将无法执行。请联系管理员发放，或在设置中查看用量。'}
      </p>
      <div className={compact ? 'flex items-center gap-1.5' : 'contents'}>
      <button
        type="button"
        onClick={() => navigateToSettingsSection('settings-usage')}
        className="shrink-0 rounded-md bg-rose-900/50 px-2 py-1 text-[9px] font-semibold text-rose-50 hover:bg-rose-800/60"
      >
        查看用量
      </button>
      <button
        type="button"
        onClick={() => {
          writeLocalJson(dismissKey, true);
          setDismissed(true);
        }}
        className="shrink-0 rounded-md px-1.5 py-1 text-[9px] text-rose-200/70 hover:text-rose-50"
        aria-label="关闭提示"
      >
        关闭
      </button>
      </div>
    </div>
  );
};

export default WorkflowZeroBalanceBanner;
