import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listScripts } from '../services/scriptHubApi';
import type { ScriptListItem } from '../types/scriptHub';
import { HttpRequestError } from '../services/httpClient';

export function LibraryPage() {
  const [scripts, setScripts] = useState<ScriptListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
        {(scripts ?? []).map((s) => (
          <li key={s.id} className="sh-list-item">
            <Link to={`/scripts/${s.id}`} className="sh-link" style={{ fontSize: '1rem' }}>
              {s.title}
            </Link>
            <span className="sh-muted" style={{ marginLeft: 8 }}>
              {s.targetType} · v{s.currentRevision?.version ?? '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
