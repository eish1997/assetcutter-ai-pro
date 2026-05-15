import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getScript, listScriptRuns } from '../services/scriptHubApi';
import { HttpRequestError } from '../services/httpClient';
import type { ScriptHubRun } from '../types/scriptHub';

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function tail(s: string | undefined, n: number) {
  if (!s) return '—';
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

export function ScriptRunsPage() {
  const { id: scriptId = '' } = useParams();
  const [title, setTitle] = useState<string>('');
  const [runs, setRuns] = useState<ScriptHubRun[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!scriptId) return;
      setErr(null);
      setRuns(null);
      try {
        const [{ script }, { runs: list }] = await Promise.all([
          getScript(scriptId),
          listScriptRuns({ scriptId, limit: 100 }),
        ]);
        if (!cancelled) {
          setTitle(script.title);
          setRuns(list);
        }
      } catch (e) {
        if (!cancelled) {
          const msg =
            e instanceof HttpRequestError && e.status === 404
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
  }, [scriptId]);

  if (!scriptId) return <p className="sh-muted">缺少脚本 id</p>;

  return (
    <div>
      <p style={{ marginBottom: '0.75rem' }}>
        <Link to={`/scripts/${encodeURIComponent(scriptId)}`} className="sh-link-quiet">
          ← 返回编辑
        </Link>
      </p>
      <h1 className="sh-h1">执行历史</h1>
      {title ? (
        <p className="sh-muted" style={{ marginTop: 0 }}>
          脚本：<span className="sh-code">{title}</span>
        </p>
      ) : null}
      {err ? (
        <p className="sh-alert" role="alert">
          {err}
        </p>
      ) : null}
      {!err && runs === null ? <p className="sh-muted">加载中…</p> : null}
      {runs && runs.length === 0 ? <p className="sh-muted">暂无 Run 记录。在编辑页执行 Maya 后会在此列出。</p> : null}
      {runs && runs.length > 0 ? (
        <ul className="sh-list" style={{ marginTop: '1rem' }}>
          {runs.map((r) => (
            <li key={r.id} className="sh-list-item">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'baseline' }}>
                <span
                  style={{
                    fontWeight: 800,
                    color:
                      r.status === 'completed' ? '#4ade80' : r.status === 'failed' ? '#f87171' : '#9ca3af',
                  }}
                >
                  {r.status}
                </span>
                <span className="sh-muted" style={{ fontSize: '0.85rem' }}>
                  {fmtTime(r.createdAt)}
                </span>
                {r.durationMs != null ? (
                  <span className="sh-muted" style={{ fontSize: '0.85rem' }}>
                    {r.durationMs} ms
                  </span>
                ) : null}
              </div>
              <div className="sh-muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                run <span className="sh-mono">{r.id.slice(0, 8)}…</span>
                {r.companionJobId ? (
                  <>
                    {' '}
                    · job <span className="sh-mono">{r.companionJobId.slice(0, 8)}…</span>
                  </>
                ) : null}
                {r.revisionId ? (
                  <>
                    {' '}
                    · rev <span className="sh-mono">{r.revisionId.slice(0, 8)}…</span>
                  </>
                ) : null}
              </div>
              {r.errorMessage ? (
                <p className="sh-alert" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                  {r.errorMessage}
                </p>
              ) : null}
              {r.logExcerpt ? (
                <pre className="sh-pre" style={{ marginTop: '0.5rem', fontSize: '0.75rem', maxHeight: 120, overflow: 'auto' }}>
                  {tail(r.logExcerpt, 2000)}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
