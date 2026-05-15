import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createRevision, createScriptRun, getRevisionContent, getScript, issueRevisionContentToken, patchScriptRun, updateScript } from '../services/scriptHubApi';
import { getComputeJob, submitScriptMayaJob } from '../services/companionJobs';
import { fetchScriptConnectors, type ScriptConnectorsResponse } from '../services/companionScriptConnectors';
import { getCompanionLocalToken, setCompanionLocalToken } from '../../../services/companionLocalPrefs';
import { ParamSchemaForm } from '../components/ParamSchemaForm';
import type { ParamSchemaV1, ScriptDetail } from '../types/scriptHub';

function paramDefaultsFromSchema(sch: ParamSchemaV1): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const f of sch.fields) {
    if (f.default !== undefined) o[f.key] = f.default;
  }
  return o;
}

export function ScriptDetailPage() {
  const { id } = useParams();
  const scriptId = id || '';

  const [script, setScript] = useState<ScriptDetail | null>(null);
  const [content, setContent] = useState('');
  const [schemaJson, setSchemaJson] = useState('');
  const [schema, setSchema] = useState<ParamSchemaV1 | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [mayaHost, setMayaHost] = useState('127.0.0.1');
  const [mayaPort, setMayaPort] = useState(7001);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runLog, setRunLog] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<ScriptConnectorsResponse | null>(null);
  const [connectorsErr, setConnectorsErr] = useState<string | null>(null);
  const [companionTokenDraft, setCompanionTokenDraft] = useState('');
  const [companionTokenBump, setCompanionTokenBump] = useState(0);

  const load = useCallback(async () => {
    if (!scriptId) return;
    setErr(null);
    const { script: s } = await getScript(scriptId);
    setScript(s);
    if (!s.currentRevisionId) {
      setContent('');
      setSchemaJson('');
      setSchema(null);
      setParams({});
      return;
    }
    const rev = await getRevisionContent(scriptId, s.currentRevisionId);
    setContent(rev.content);
    setSchema(rev.schema);
    setSchemaJson(JSON.stringify(rev.schema, null, 2));
    setParams(paramDefaultsFromSchema(rev.schema));
  }, [scriptId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!scriptId) return;
        await load();
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, scriptId]);

  useEffect(() => {
    if (!script || script.targetType !== 'maya') {
      setConnectors(null);
      setConnectorsErr(null);
      return;
    }
    setCompanionTokenDraft(getCompanionLocalToken());
    let cancelled = false;
    const tick = async () => {
      try {
        const snap = await fetchScriptConnectors({ mayaHost, mayaPort });
        if (!cancelled) {
          setConnectors(snap);
          setConnectorsErr(null);
        }
      } catch (e) {
        if (!cancelled) {
          setConnectors(null);
          setConnectorsErr(e instanceof Error ? e.message : String(e));
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [script, mayaHost, mayaPort, companionTokenBump]);

  function parseSchemaFromEditor(): ParamSchemaV1 {
    try {
      return JSON.parse(schemaJson) as ParamSchemaV1;
    } catch {
      throw new Error('ParamSchema JSON 无法解析');
    }
  }

  async function saveMeta() {
    if (!script) return;
    setBusy(true);
    setErr(null);
    try {
      const sch = parseSchemaFromEditor();
      await updateScript(script.id, { title: script.title.trim() });
      await createRevision(script.id, { schema: sch, content, changelog: 'edit' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runMaya() {
    if (!script || script.targetType !== 'maya') return;
    if (!script.currentRevisionId) {
      setErr('当前无已保存的 revision，请先「保存为新版本」再执行。');
      return;
    }
    setBusy(true);
    setErr(null);
    setRunLog(null);
    const t0 = Date.now();
    let runId: string | null = null;
    try {
      parseSchemaFromEditor();
      const { run } = await createScriptRun({
        scriptId: script.id,
        revisionId: script.currentRevisionId,
        targetType: 'maya',
        params,
      });
      runId = run.id;
      let mayaPayload:
        | { content: string; params: Record<string, unknown>; mayaHost: string; mayaPort: number; timeoutMs: number }
        | {
            scriptSource: 'cloud';
            scriptId: string;
            revisionId: string;
            contentJwt: string;
            params: Record<string, unknown>;
            mayaHost: string;
            mayaPort: number;
            timeoutMs: number;
          } = {
        content,
        params,
        mayaHost,
        mayaPort,
        timeoutMs: 120_000,
      };
      try {
        const { token } = await issueRevisionContentToken(script.id, script.currentRevisionId);
        if (token) {
          mayaPayload = {
            scriptSource: 'cloud',
            scriptId: script.id,
            revisionId: script.currentRevisionId,
            contentJwt: token,
            params,
            mayaHost,
            mayaPort,
            timeoutMs: 120_000,
          };
        }
      } catch {
        /* 无 JWT 或未配置时回退内联 content */
      }
      const { jobId } = await submitScriptMayaJob(mayaPayload);
      await patchScriptRun(runId, { status: 'running', companionJobId: jobId });
      const deadline = Date.now() + 130_000;
      let status = 'queued';
      let note = '';
      while (Date.now() < deadline) {
        const j = await getComputeJob(jobId);
        status = j.job.status;
        if (j.job.status === 'completed') {
          note = j.job.result?.note || '完成';
          break;
        }
        if (j.job.status === 'failed') {
          throw new Error(j.job.error?.message || j.job.error?.code || '执行失败');
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      if (status !== 'completed') throw new Error('执行超时');
      setRunLog(note);
      await patchScriptRun(runId, {
        status: 'completed',
        exitCode: 0,
        durationMs: Date.now() - t0,
        logExcerpt: note,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (runId) {
        try {
          await patchScriptRun(runId, {
            status: 'failed',
            errorCode: 'SCRIPT_HUB_MAYA_RUN',
            errorMessage: msg,
            durationMs: Date.now() - t0,
          });
        } catch {
          /* ignore */
        }
      }
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!scriptId) return <p className="sh-muted">缺少脚本 id</p>;
  if (!script && !err) return <p className="sh-muted">加载中…</p>;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '1rem',
        }}
      >
        <Link to="/library" className="sh-link-quiet">
          ← 返回列表
        </Link>
        {scriptId ? (
          <Link to={`/scripts/${encodeURIComponent(scriptId)}/runs`} className="sh-link">
            执行历史
          </Link>
        ) : null}
      </div>
      {script ? (
        <>
          <h1 className="sh-h1">{script.title}</h1>
          <p className="sh-muted" style={{ marginTop: 0 }}>
            slug: <span className="sh-code">{script.slug}</span> · target:{' '}
            <span className="sh-code">{script.targetType}</span>
            {script.currentRevisionId ? (
              <>
                {' '}
                · revision: <span className="sh-code">{script.currentRevisionId.slice(0, 8)}…</span>
              </>
            ) : null}
          </p>
          <label className="sh-label" style={{ marginBottom: '0.85rem', maxWidth: 480 }}>
            标题
            <input
              className="sh-input"
              value={script.title}
              onChange={(e) => setScript({ ...script, title: e.target.value })}
            />
          </label>
        </>
      ) : null}

      <h3 className="sh-h3">ParamSchema（JSON）</h3>
      <textarea
        className="sh-textarea sh-mono code"
        value={schemaJson}
        onChange={(e) => {
          const t = e.target.value;
          setSchemaJson(t);
          try {
            setSchema(JSON.parse(t) as ParamSchemaV1);
          } catch {
            setSchema(null);
          }
        }}
        rows={10}
        style={{ marginBottom: '0.75rem' }}
      />

      <h3 className="sh-h3">Python 正文</h3>
      <textarea
        className="sh-textarea sh-mono code"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={14}
        style={{ marginBottom: '0.75rem' }}
      />

      {schema && schema.schemaVersion === 1 ? (
        <>
          <h3 className="sh-h3">运行参数</h3>
          <ParamSchemaForm schema={schema} value={params} onChange={setParams} />
        </>
      ) : (
        <p className="sh-alert">修正 ParamSchema JSON 后可编辑参数。</p>
      )}

      {script?.targetType === 'maya' ? (
        <section className="sh-panel sh-panel-tight" style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
          <h3 className="sh-h3" style={{ marginTop: 0 }}>
            本机连接器
          </h3>
          {connectorsErr ? (
            <p className="sh-alert" style={{ margin: 0 }} role="status">
              {connectorsErr}
            </p>
          ) : null}
          {connectorsErr && (connectorsErr.includes('bearer') || connectorsErr.includes('401')) ? (
            <div style={{ marginTop: '0.65rem' }}>
              <p className="sh-muted" style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', lineHeight: 1.45 }}>
                与 Maya 的 7001 无关：本机伴侣若启用了通信密码（环境变量里叫 <span className="sh-mono">COMPANION_SHARED_TOKEN</span>），
                浏览器请求须带同一串值。<strong>主工作台</strong>路径：<strong>设置 → 本地伴侣 →「① 与网站配对」</strong> → 填「通信密码」→{' '}
                <strong>「保存配对密码」</strong>。<strong>桌面伴侣</strong>：<strong>设置 →「② 与网站配对」</strong> → 同一密码 →{' '}
                <strong>「保存配对」</strong>，且「允许的网站」须含本页 origin（如 <span className="sh-mono">http://127.0.0.1:5174</span>）。
                工作台与 Script Hub 端口不同则 <strong>localStorage 不共享</strong>，工作台已配过时请把同一串密码复制到下方再保存。
                Script Hub 已与工作台对齐：<strong>直连</strong>本机伴侣 HTTP 根（默认 <span className="sh-mono">http://127.0.0.1:18765</span>，与主站「设置 → 本地伴侣」里保存的根同源），<strong>不再经本站 Vite 的 /v1 代理</strong>。
              </p>
              <label className="sh-label" style={{ display: 'block', marginBottom: '0.35rem' }}>
                通信密码（与伴侣「设置 → 与网站配对」一致）
                <input
                  className="sh-input sh-mono"
                  type="password"
                  autoComplete="off"
                  value={companionTokenDraft}
                  onChange={(e) => setCompanionTokenDraft(e.target.value)}
                  placeholder="从伴侣设置页复制，或粘贴 .env 里同一串"
                  style={{ marginTop: 4 }}
                />
              </label>
              <button
                type="button"
                className="sh-btn"
                style={{ marginTop: '0.35rem' }}
                onClick={() => {
                  setCompanionLocalToken(companionTokenDraft);
                  setCompanionTokenBump((n) => n + 1);
                }}
              >
                保存并重试连接
              </button>
            </div>
          ) : null}
          {!connectorsErr && !connectors ? (
            <p className="sh-muted" style={{ margin: 0 }}>
              正在探测本机伴侣与 Maya…
            </p>
          ) : null}
          {connectors ? (
            <>
              <p className="sh-muted" style={{ margin: '0 0 0.5rem', fontSize: '0.8rem' }}>
                探测时间 {new Date(connectors.probedAt).toLocaleString()}（约每 10 秒刷新；与下方 Host/Port 一致）
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.15rem' }}>
                {connectors.connectors.map((c) => (
                  <li key={c.id} style={{ marginBottom: '0.35rem', color: '#d1d5db' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        minWidth: '3.5rem',
                        fontWeight: 700,
                        color:
                          c.status === 'ok' ? '#4ade80' : c.status === 'skipped' ? '#9ca3af' : '#f87171',
                      }}
                    >
                      {c.status === 'ok' ? 'OK' : c.status === 'skipped' ? '—' : 'ERR'}
                    </span>
                    <span className="sh-mono" style={{ fontSize: '0.85rem' }}>
                      {c.id}
                    </span>
                    {c.host != null && c.port != null ? (
                      <span className="sh-muted" style={{ marginLeft: 6 }}>
                        {c.host}:{c.port}
                      </span>
                    ) : null}
                    <div className="sh-muted" style={{ marginTop: 2, fontSize: '0.85rem' }}>
                      {c.message}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {script?.targetType === 'maya' ? (
        <div className="sh-grid-2">
          <label className="sh-label">
            Maya Host
            <input className="sh-input sh-mono" value={mayaHost} onChange={(e) => setMayaHost(e.target.value)} />
          </label>
          <label className="sh-label">
            Port
            <input
              className="sh-input sh-mono"
              type="number"
              value={mayaPort}
              onChange={(e) => setMayaPort(Number.parseInt(e.target.value, 10) || 7001)}
            />
          </label>
        </div>
      ) : null}

      <div className="sh-row-actions">
        <button type="button" className="sh-btn sh-btn-primary" disabled={busy} onClick={() => void saveMeta()}>
          保存为新版本
        </button>
        {script?.targetType === 'maya' ? (
          <button type="button" className="sh-btn" disabled={busy || !schema} onClick={() => void runMaya()}>
            本机执行（Maya）
          </button>
        ) : null}
      </div>

      {runLog ? <pre className="sh-pre">{runLog}</pre> : null}

      {err ? (
        <p className="sh-alert sh-alert-wrap" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
