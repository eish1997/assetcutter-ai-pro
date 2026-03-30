import React, { useCallback, useState } from 'react';
import type { CustomAppModule } from '../types';
import type { PipelinePlan } from '../types/planner';
import {
  getPipelinePlannerEnabled,
  getPromptCompilerEnabled,
  setPipelinePlannerEnabled,
  setPromptCompilerEnabled,
} from '../services/featureFlags';
import { loadDefaultRuleset, validateRulesetPresetIds } from '../services/planner/loadRuleset';
import { planPipeline } from '../services/planner/planPipeline';

type Props = {
  actionModules: CustomAppModule[];
  selectedAssetId: string | null;
  /** 将某预设加入当前选中资产的待处理队列 */
  onAddToQueue: (presetId: string) => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
};

export const WorkflowPlannerBar: React.FC<Props> = ({
  actionModules,
  selectedAssetId,
  onAddToQueue,
  onLog,
}) => {
  const [compilerOn, setCompilerOn] = useState(() => getPromptCompilerEnabled());
  const [plannerOn, setPlannerOn] = useState(() => getPipelinePlannerEnabled());
  const [goalText, setGoalText] = useState('');
  const [plan, setPlan] = useState<PipelinePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const presetIdSet = useCallback(() => new Set(actionModules.map((m) => m.id)), [actionModules]);

  const suggest = useCallback(async () => {
    setErr(null);
    setPlan(null);
    setLoading(true);
    try {
      const ruleset = await loadDefaultRuleset();
      const { missing } = validateRulesetPresetIds(ruleset, presetIdSet());
      if (missing.length) {
        const msg = `规则引用了未安装的预设：${missing.join('、')}`;
        setErr(msg);
        onLog?.('warn', msg, missing.join(','));
        return;
      }
      const next = planPipeline({
        inputProfile: { source_kind: 'unknown' },
        targetSummary: goalText.trim() || '写实',
        ruleset,
        availablePresetIds: presetIdSet(),
      });
      setPlan(next);
      if (next.fallback_used) {
        onLog?.('info', 'Planner：无规则命中，可调整目标描述后重试', undefined);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      onLog?.('error', `Planner：${msg}`, msg);
    } finally {
      setLoading(false);
    }
  }, [goalText, onLog, presetIdSet]);

  return (
    <div className="rounded-xl border border-white/10 bg-[#0c0d10] p-3 space-y-2">
      <div className="text-[8px] font-black uppercase text-gray-400">阶段 B 实验</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 items-center text-[8px] text-gray-300">
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded border-white/20"
            checked={compilerOn}
            onChange={(e) => {
              const v = e.target.checked;
              setCompilerOn(v);
              setPromptCompilerEnabled(v);
            }}
          />
          提示词编译器（跳过「理解」）
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded border-white/20"
            checked={plannerOn}
            onChange={(e) => {
              const v = e.target.checked;
              setPlannerOn(v);
              setPipelinePlannerEnabled(v);
            }}
          />
          流程建议
        </label>
      </div>

      {plannerOn && (
        <div className="pt-1 space-y-2 border-t border-white/5">
          <label className="block text-[8px] text-gray-500">目标 / 关键词（用于规则匹配）</label>
          <input
            type="text"
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            placeholder="例如：写实照片、线稿…"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[9px] text-gray-100 placeholder:text-gray-600 outline-none focus:border-blue-500"
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => void suggest()}
            className="w-full rounded-lg border border-blue-500/40 bg-blue-600/20 px-2 py-1.5 text-[9px] font-black uppercase text-blue-200 hover:bg-blue-600/30 disabled:opacity-40"
          >
            {loading ? '规划中…' : '生成建议流程'}
          </button>
          {err && <p className="text-[8px] text-red-400">{err}</p>}
          {plan && (
            <div className="rounded-lg border border-white/10 bg-black/30 p-2 space-y-1.5">
              <div className="text-[8px] text-gray-400">
                {plan.fallback_used ? '未命中规则（可换关键词）' : `计划 ${plan.steps.length} 步`}
                <span className="text-gray-600"> · {plan.ruleset_version}</span>
              </div>
              <ol className="list-decimal list-inside text-[8px] text-gray-200 space-y-0.5">
                {plan.steps.map((s) => (
                  <li key={`${s.ordinal}-${s.preset_id}`}>
                    {s.label ?? s.preset_id}{' '}
                    <span className="text-gray-500 font-mono text-[7px]">{s.preset_id}</span>
                  </li>
                ))}
              </ol>
              {plan.steps.length > 0 && (
                <button
                  type="button"
                  disabled={!selectedAssetId}
                  onClick={() => onAddToQueue(plan.steps[0]!.preset_id)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[8px] text-blue-200 hover:bg-white/10 disabled:opacity-30"
                  title={!selectedAssetId ? '请先在网格中选中一张图' : undefined}
                >
                  将第一步加入待处理
                </button>
              )}
              <details className="text-[7px] text-gray-500">
                <summary className="cursor-pointer text-gray-400">决策轨迹</summary>
                <ul className="mt-1 space-y-0.5 pl-2">
                  {plan.decision_trace.map((t, i) => (
                    <li key={`${t.rule_id}-${i}`}>
                      {t.matched ? '✓' : '×'} {t.rule_id} (p{t.priority}) — {t.reason}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
