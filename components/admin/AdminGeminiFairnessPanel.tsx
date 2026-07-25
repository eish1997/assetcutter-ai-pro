import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchAdminGeminiFairnessConfig,
  saveAdminGeminiFairnessConfig,
  clearAdminGeminiFairnessConfig,
  type GeminiFairnessConfig,
} from '../../services/adminGeminiFairnessClient';
import { PERMISSIONS } from '../../services/adminPermissions';
import { navigateAdmin } from '../../services/adminNavigate';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { useAdminStaff } from './AdminStaffContext';

const FIELDS: Array<{ key: string; label: string; hint?: string; strict?: boolean }> = [
  { key: 'AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT', label: '全站并发槽（全局）', hint: '1～64' },
  { key: 'GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT', label: '每用户同时执行上限（登录）', hint: '1～32' },
  { key: 'GEMINI_FAIRNESS_USER_MAX_QUEUED', label: '每用户排队深度（登录）', hint: '1～200' },
  { key: 'GEMINI_FAIRNESS_USER_SUBMIT_RPM', label: '每用户提交 RPM（登录）', hint: '1～500' },
  { key: 'GEMINI_FAIRNESS_ANON_MAX_IN_FLIGHT', label: '匿名桶并发', hint: '1～32' },
  { key: 'GEMINI_FAIRNESS_ANON_MAX_QUEUED', label: '匿名桶排队深度', hint: '1～100' },
  { key: 'GEMINI_FAIRNESS_ANON_SUBMIT_RPM', label: '匿名桶 RPM', hint: '1～500' },
  { key: 'GEMINI_FAIRNESS_GLOBAL_QUEUE_MAX', label: '全站队列硬顶', hint: '10～5000' },
  { key: 'GEMINI_FAIRNESS_KEY_MAX_LEN', label: 'Fairness key 最大长度', hint: '8～512', strict: true },
  { key: 'GEMINI_FAIRNESS_HMAC_SKEW_SEC', label: 'HMAC 时间窗（秒）', hint: '10～600', strict: true },
];

const PRESETS: Record<string, Record<string, number>> = {
  conservative: {
    AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT: 4,
    GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT: 1,
    GEMINI_FAIRNESS_USER_MAX_QUEUED: 8,
    GEMINI_FAIRNESS_USER_SUBMIT_RPM: 20,
    GEMINI_FAIRNESS_ANON_MAX_IN_FLIGHT: 1,
    GEMINI_FAIRNESS_ANON_MAX_QUEUED: 4,
    GEMINI_FAIRNESS_ANON_SUBMIT_RPM: 10,
    GEMINI_FAIRNESS_GLOBAL_QUEUE_MAX: 80,
  },
  standard: {
    AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT: 8,
    GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT: 2,
    GEMINI_FAIRNESS_USER_MAX_QUEUED: 16,
    GEMINI_FAIRNESS_USER_SUBMIT_RPM: 60,
    GEMINI_FAIRNESS_ANON_MAX_IN_FLIGHT: 2,
    GEMINI_FAIRNESS_ANON_MAX_QUEUED: 8,
    GEMINI_FAIRNESS_ANON_SUBMIT_RPM: 30,
    GEMINI_FAIRNESS_GLOBAL_QUEUE_MAX: 200,
  },
  peak: {
    AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT: 16,
    GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT: 4,
    GEMINI_FAIRNESS_USER_MAX_QUEUED: 32,
    GEMINI_FAIRNESS_USER_SUBMIT_RPM: 120,
    GEMINI_FAIRNESS_ANON_MAX_IN_FLIGHT: 4,
    GEMINI_FAIRNESS_ANON_MAX_QUEUED: 16,
    GEMINI_FAIRNESS_ANON_SUBMIT_RPM: 60,
    GEMINI_FAIRNESS_GLOBAL_QUEUE_MAX: 500,
  },
};

const AdminGeminiFairnessPanel: React.FC = () => {
  const { can, isRolePreview } = useAdminStaff();
  const canWrite = can(PERMISSIONS.GEMINI_FAIRNESS_WRITE);
  const canStrict = can(PERMISSIONS.GEMINI_FAIRNESS_STRICT);
  const [storageLabel, setStorageLabel] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchAdminGeminiFairnessConfig();
      const storage =
        r.storage === 'postgres'
          ? 'Postgres（auth-api 与 ai-worker-proxy 共享）'
          : r.source === 'disk'
            ? `磁盘 ${r.path || ''}`
            : r.source === 'env_only'
              ? '仅环境变量（env_only）'
              : r.path || '';
      setStorageLabel(storage);
      setUpdatedAt(r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '');
      const next: Record<string, string> = {};
      for (const f of FIELDS) {
        const v = r.config[f.key];
        next[f.key] = v != null && Number.isFinite(Number(v)) ? String(v) : '';
      }
      setValues(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const body: GeminiFairnessConfig = {};
      for (const f of FIELDS) {
        const raw = (values[f.key] || '').trim();
        if (!raw) continue;
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          setError(`「${f.label}」须为数字`);
          setSaving(false);
          return;
        }
        body[f.key] = n;
      }
      const r = await saveAdminGeminiFairnessConfig(body);
      setMessage(`已保存（${Object.keys(r.config || {}).length} 项）。ai-worker-proxy 约 3 秒内热加载。`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onClearDisk = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    if (
      !window.confirm(
        '将清空全部公平限流数值覆盖（{}），代理约 3 秒后按纯环境变量运行。确定？'
      )
    ) {
      return;
    }
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await clearAdminGeminiFairnessConfig();
      setMessage('已清空覆盖；ai-worker-proxy 约 3 秒内热加载。');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (presetId: keyof typeof PRESETS) => {
    const preset = PRESETS[presetId];
    if (!preset) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(preset)) {
        next[k] = String(v);
      }
      return next;
    });
    setMessage(`已填入「${presetId === 'conservative' ? '保守' : presetId === 'standard' ? '标准' : '高峰'}」预设，请确认后保存`);
  };

  if (loading) {
    return <div className="text-[11px] text-gray-400">加载配置…</div>;
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Gemini 代理公平限流</h2>
        <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
          持久化：<code className="text-gray-400">{storageLabel || 'server/data/gemini-fairness-config.json'}</code>
          {updatedAt ? <span className="text-gray-600"> · 更新于 {updatedAt}</span> : null}
          ，与 <code className="text-gray-400">GEMINI_FAIRNESS_ENABLED=true</code> 的 ai-worker-proxy 同机时可热更新数值。
          总开关、密钥类仍用环境变量。排障：代理根 <code className="text-gray-400">GET /healthz.fairness</code>。
          架构见 <code className="text-gray-400">docs/Gemini代理-公平排队与每用户限流.md</code> 开篇「全链路速查」。
          {' · '}
          <button
            type="button"
            onClick={() => navigateAdmin('/admin/system-status')}
            className="text-blue-400 hover:text-blue-300"
          >
            系统状态（只读指标）
          </button>
        </p>
      </div>
      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-[11px] text-red-200">{error}</div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-100">
          {message}
        </div>
      )}
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => applyPreset('conservative')}
            className="rounded-lg border border-[#2e2e32] bg-[#1c1c22] px-3 py-2 text-[10px] text-gray-300 hover:bg-[#2a2a30]"
          >
            保守预设
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => applyPreset('standard')}
            className="rounded-lg border border-[#2e2e32] bg-[#1c1c22] px-3 py-2 text-[10px] text-gray-300 hover:bg-[#2a2a30]"
          >
            标准预设
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => applyPreset('peak')}
            className="rounded-lg border border-[#2e2e32] bg-[#1c1c22] px-3 py-2 text-[10px] text-gray-300 hover:bg-[#2a2a30]"
          >
            高峰预设
          </button>
        </div>
      ) : null}
      <div className="space-y-3 rounded-xl border border-[#2e2e32] bg-[#121216] p-4">
        {FIELDS.map((f) => {
          const fieldDisabled = !canWrite || (f.strict && !canStrict);
          return (
          <label key={f.key} className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-gray-500">
              {f.label}
              {f.strict ? <span className="text-amber-600/80 normal-case"> · 高危</span> : null}
              {f.hint ? <span className="text-gray-600 normal-case"> · {f.hint}</span> : null}
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={values[f.key] ?? ''}
              onChange={(ev) => setValues((prev) => ({ ...prev, [f.key]: ev.target.value }))}
              disabled={fieldDisabled}
              className="w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[12px] text-gray-100 outline-none focus:border-[#3b82f6] disabled:opacity-40"
              placeholder="留空表示不写该键（保存时省略）"
            />
          </label>
        );})}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving || !canWrite}
          onClick={() => void onSave()}
          className="rounded-lg bg-[#2563eb] px-4 py-2 text-[11px] font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void load()}
          className="rounded-lg border border-[#2e2e32] bg-[#1c1c22] px-4 py-2 text-[11px] text-gray-300 hover:bg-[#2a2a30]"
        >
          重新加载
        </button>
        <button
          type="button"
          disabled={saving || !canWrite}
          onClick={() => void onClearDisk()}
          className="rounded-lg border border-red-900/50 bg-red-950/25 px-4 py-2 text-[11px] text-red-200 hover:bg-red-950/45 disabled:opacity-50"
        >
          清空磁盘覆盖
        </button>
      </div>
    </div>
  );
};

export default AdminGeminiFairnessPanel;
