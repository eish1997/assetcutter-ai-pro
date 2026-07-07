import React from 'react';
import { batchAdjustAdminCredits } from '../../services/adminClient';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { fmtCredits } from '../../shared/credits';

type BatchRowResult = {
  username: string;
  userId?: string;
  delta?: number;
  note?: string;
  status: string;
  balanceAfter?: number;
  error?: string;
};

type AdminCreditsBatchPanelProps = {
  open: boolean;
  onClose: () => void;
  isRolePreview: boolean;
};

const SAMPLE_CSV = `username,delta,note
alice,5000,活动奖励
bob,-200,误发扣回`;

const AdminCreditsBatchPanel: React.FC<AdminCreditsBatchPanelProps> = ({ open, onClose, isRolePreview }) => {
  const [csv, setCsv] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [results, setResults] = React.useState<BatchRowResult[] | null>(null);
  const [summary, setSummary] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setResults(null);
    setSummary('');
  }, [open]);

  if (!open) return null;

  const run = async (dryRun: boolean) => {
    if (blockIfRolePreview(isRolePreview)) return;
    const text = csv.trim();
    if (!text) {
      setError('请粘贴 CSV 内容');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await batchAdjustAdminCredits({ csv: text, dryRun });
      setResults(res.results || []);
      setSummary(
        dryRun
          ? `预览：成功 ${res.successCount}，跳过 ${res.skipped}，失败 ${res.failed}`
          : `完成：成功 ${res.successCount}，跳过 ${res.skipped}，失败 ${res.failed}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '批量发放失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col rounded-2xl border border-[#2e2e32] bg-[#121216] shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-[#2e2e32] flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">批量发放积分</h2>
            <p className="text-[10px] text-gray-400 mt-1">CSV 列：username,delta,note（delta 为正发放、为负扣回）</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg leading-none px-2"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={SAMPLE_CSV}
            rows={10}
            className="w-full rounded-xl border border-[#2e2e32] bg-[#0a0a0c] text-[11px] text-gray-200 px-3 py-2 font-mono resize-y min-h-[160px] focus:outline-none focus:border-blue-500/50"
          />
          {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
          {summary ? <p className="text-[11px] text-emerald-300/90">{summary}</p> : null}
          {results?.length ? (
            <div className="rounded-xl border border-[#2e2e32] overflow-hidden">
              <table className="w-full text-[10px]">
                <thead className="bg-[#1a1a1f] text-gray-400">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">用户</th>
                    <th className="text-right px-3 py-2 font-medium">变动</th>
                    <th className="text-left px-3 py-2 font-medium">状态</th>
                    <th className="text-right px-3 py-2 font-medium">余额</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, i) => (
                    <tr key={`${row.username}-${i}`} className="border-t border-[#2e2e32]/80">
                      <td className="px-3 py-1.5 text-gray-200">{row.username}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-gray-300">
                        {row.delta != null ? (row.delta > 0 ? `+${row.delta}` : row.delta) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-gray-400">
                        {row.error || row.status}
                      </td>
                      <td className="px-3 py-1.5 text-right text-gray-300">
                        {row.balanceAfter != null ? fmtCredits(row.balanceAfter) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <div className="px-5 py-4 border-t border-[#2e2e32] flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => setCsv(SAMPLE_CSV)}
            className="px-3 py-1.5 rounded-lg text-[11px] border border-[#2e2e32] text-gray-300 hover:bg-[#1c1c22] disabled:opacity-50"
          >
            填入示例
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(true)}
            className="px-3 py-1.5 rounded-lg text-[11px] border border-amber-700/40 bg-amber-950/30 text-amber-100 hover:bg-amber-950/50 disabled:opacity-50"
          >
            {busy ? '处理中…' : '预览'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm('确认执行批量积分调整？此操作将写入流水并审计。')) return;
              void run(false);
            }}
            className="px-3 py-1.5 rounded-lg text-[11px] border border-blue-600/50 bg-[#264670] text-blue-100 hover:bg-[#2d5280] disabled:opacity-50"
          >
            {busy ? '执行中…' : '确认发放'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminCreditsBatchPanel;
