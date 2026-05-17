import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listScripts } from '../services/scriptHubApi';
import type { ScriptListItem } from '../types/scriptHub';
import { HttpRequestError } from '../services/httpClient';
import { ScriptParamsModal } from '../components/ScriptParamsModal';
import { useScriptHubPrefs } from '../context/ScriptHubPrefsContext';
import { useRunScriptMaya } from '../hooks/useRunScriptMaya';
import { resolveParamsForRun } from '../utils/paramDefaults';
import { fetchScriptConnectors } from '../services/companionScriptConnectors';

type RowRunState = {
  phase: 'idle' | 'running' | 'ok' | 'err';
  message?: string;
};

export function LibraryPage() {
  const [scripts, setScripts] = useState<ScriptListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rowRuns, setRowRuns] = useState<Record<string, RowRunState>>({});
  const [paramsModal, setParamsModal] = useState<ScriptListItem | null>(null);
  const { getLastParams, saveLastParams, mayaHost, mayaPort } = useScriptHubPrefs();
  const { runScriptMaya } = useRunScriptMaya();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await listScripts();
        if (!cancelled) setScripts(r.scripts);
      } catch (e) {
        if (!cancelled) {
          const msg =
            e instanceof HttpRequestError && e.status === 503
              ? String(e.message)
              : e instanceof Error
                ? e.message
                : String(e);
          setErr(msg);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setRow = useCallback((scriptId: string, next: RowRunState) => {
    setRowRuns((prev) => ({ ...prev, [scriptId]: next }));
  }, []);

  const executeScript = useCallback(
    async (item: ScriptListItem, params: Record<string, unknown>) => {
      if (item.targetType !== 'maya') return;
      const rev = item.currentRevision;
      if (!rev) {
        setRow(item.id, { phase: 'err', message: '无已保存版本' });
        return;
      }
      setRow(item.id, { phase: 'running', message: '提交中…' });
      const result = await runScriptMaya({
        scriptId: item.id,
        revisionId: rev.id,
        params,
        onProgress: (label) => setRow(item.id, { phase: 'running', message: label }),
      });
      if (result.ok) {
        setRow(item.id, { phase: 'ok', message: '完成' });
        void fetchScriptConnectors({ mayaHost, mayaPort, bustCache: true }).catch(() => undefined);
      } else {
        setRow(item.id, { phase: 'err', message: result.error });
      }
    },
    [mayaHost, mayaPort, runScriptMaya, setRow],
  );

  const onQuickRun = useCallback(
    async (item: ScriptListItem) => {
      const rev = item.currentRevision;
      if (!rev) return;
      const last = getLastParams(item.id);
      const params = resolveParamsForRun(rev.schema, last);
      await executeScript(item, params);
    },
    [executeScript, getLastParams],
  );

  return (
    <div>
      <div className="sh-toolbar">
        <h1 className="sh-h1" style={{ marginBottom: 0 }}>
          我的脚本
        </h1>
        <Link to="/scripts/new" className="sh-btn sh-btn-primary" style={{ textDecoration: 'none' }}>
          新建
        </Link>
      </div>
      {err ? (
        <p className="sh-alert" role="alert">
          {err}
        </p>
      ) : null}
      {!err && scripts === null ? <p className="sh-muted">加载中…</p> : null}
      {scripts && scripts.length === 0 ? (
        <p className="sh-muted">暂无脚本，点击「新建」开始。</p>
      ) : null}
      <ul className="sh-list">
        {(scripts ?? []).map((s) => {
          const row = rowRuns[s.id] ?? { phase: 'idle' as const };
          const rev = s.currentRevision;
          const canRun = s.targetType === 'maya' && Boolean(rev);
          const running = row.phase === 'running';
          return (
            <li key={s.id} className="sh-list-item" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
                <Link to={`/scripts/${s.id}`} className="sh-link" style={{ fontSize: '1rem' }}>
                  {s.title}
                </Link>
                <span className="sh-muted" style={{ marginLeft: 8 }}>
                  {s.targetType} · v{rev?.version ?? '—'}
                </span>
                {row.phase !== 'idle' ? (
                  <div
                    className="sh-muted"
                    style={{
                      marginTop: 4,
                      fontSize: '0.8rem',
                      color: row.phase === 'err' ? '#f87171' : row.phase === 'ok' ? '#4ade80' : '#fbbf24',
                    }}
                  >
                    {row.message}
                  </div>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {canRun ? (
                  <>
                    <button
                      type="button"
                      className="sh-btn sh-btn-primary"
                      disabled={running}
                      onClick={() => void onQuickRun(s)}
                    >
                      {running ? '执行中…' : '执行'}
                    </button>
                    <button
                      type="button"
                      className="sh-btn"
                      disabled={running}
                      onClick={() => setParamsModal(s)}
                    >
                      参数…
                    </button>
                  </>
                ) : s.targetType === 'maya' ? (
                  <span className="sh-muted" style={{ fontSize: '0.8rem' }}>
                    请先保存版本
                  </span>
                ) : (
                  <span className="sh-muted" style={{ fontSize: '0.8rem' }}>
                    UE 待支持
                  </span>
                )}
                <Link to={`/scripts/${s.id}`} className="sh-btn sh-btn-ghost" style={{ textDecoration: 'none' }}>
                  编辑
                </Link>
                <Link to={`/scripts/${s.id}/runs`} className="sh-btn sh-btn-ghost" style={{ textDecoration: 'none' }}>
                  历史
                </Link>
              </div>
            </li>
          );
        })}
      </ul>

      {paramsModal && paramsModal.currentRevision ? (
        <ScriptParamsModal
          open
          title={paramsModal.title}
          schema={paramsModal.currentRevision.schema}
          initialParams={getLastParams(paramsModal.id)}
          busy={rowRuns[paramsModal.id]?.phase === 'running'}
          onClose={() => setParamsModal(null)}
          onSave={async (p) => {
            await saveLastParams(paramsModal.id, p, paramsModal.currentRevision!.id);
            setParamsModal(null);
          }}
          onSaveAndRun={async (p) => {
            await saveLastParams(paramsModal.id, p, paramsModal.currentRevision!.id);
            const item = paramsModal;
            setParamsModal(null);
            await executeScript(item, p);
          }}
        />
      ) : null}
    </div>
  );
}
