import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createRevision, getRevisionContent, getScript, updateScript } from '../services/scriptHubApi';
import { useScriptHubPrefs } from '../context/ScriptHubPrefsContext';
import { useRunScriptMaya } from '../hooks/useRunScriptMaya';
import { ScriptParamsModal } from '../components/ScriptParamsModal';
import { ParamSchemaForm } from '../components/ParamSchemaForm';
import type { ParamSchemaV1, ScriptDetail } from '../types/scriptHub';
import { resolveParamsForRun } from '../utils/paramDefaults';

export function ScriptDetailPage() {
  const { id } = useParams();
  const scriptId = id || '';

  const [script, setScript] = useState<ScriptDetail | null>(null);
  const [content, setContent] = useState('');
  const [schemaJson, setSchemaJson] = useState('');
  const [schema, setSchema] = useState<ParamSchemaV1 | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mayaRunBusy, setMayaRunBusy] = useState(false);
  const [runLog, setRunLog] = useState<string | null>(null);
  const [paramsModalOpen, setParamsModalOpen] = useState(false);

  const { getLastParams, saveLastParams, ready: prefsReady } = useScriptHubPrefs();
  const { runScriptMaya } = useRunScriptMaya();

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
    const last = prefsReady ? getLastParams(scriptId) : null;
    setParams(resolveParamsForRun(rev.schema, last));
  }, [scriptId, getLastParams, prefsReady]);

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

  async function runMaya(overrideParams?: Record<string, unknown>) {
    if (!script || script.targetType !== 'maya') return;
    if (!script.currentRevisionId) {
      setErr('当前无已保存的 revision，请先「保存为新版本」再执行。');
      return;
    }
    const runParams = overrideParams ?? params;
    setMayaRunBusy(true);
    setErr(null);
    setRunLog('正在提交本机任务…');
    try {
      parseSchemaFromEditor();
      const result = await runScriptMaya({
        scriptId: script.id,
        revisionId: script.currentRevisionId,
        params: runParams,
        content,
        onProgress: setRunLog,
      });
      if (!result.ok) throw new Error(result.error);
      setRunLog(result.log);
      await saveLastParams(script.id, runParams, script.currentRevisionId);
      setParams(runParams);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMayaRunBusy(false);
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <h3 className="sh-h3" style={{ margin: 0 }}>
              运行参数
            </h3>
            <button type="button" className="sh-btn" style={{ fontSize: '0.8rem' }} onClick={() => setParamsModalOpen(true)}>
              弹窗编辑…
            </button>
          </div>
          <ParamSchemaForm schema={schema} value={params} onChange={setParams} />
        </>
      ) : (
        <p className="sh-alert">修正 ParamSchema JSON 后可编辑参数。</p>
      )}

      <div className="sh-row-actions">
        <button type="button" className="sh-btn sh-btn-primary" disabled={busy} onClick={() => void saveMeta()}>
          保存为新版本
        </button>
        {script?.targetType === 'maya' ? (
          <>
            <button type="button" className="sh-btn" disabled={mayaRunBusy || !schema} onClick={() => void runMaya()}>
              {mayaRunBusy ? 'Maya 执行中…' : '本机执行（Maya）'}
            </button>
            <button
              type="button"
              className="sh-btn sh-btn-ghost"
              disabled={mayaRunBusy || !schema}
              onClick={() => setParamsModalOpen(true)}
            >
              参数…
            </button>
          </>
        ) : null}
      </div>

      {runLog ? <pre className="sh-pre">{runLog}</pre> : null}

      {err ? (
        <p className="sh-alert sh-alert-wrap" role="alert">
          {err}
        </p>
      ) : null}

      {schema && script ? (
        <ScriptParamsModal
          open={paramsModalOpen}
          title={script.title}
          schema={schema}
          initialParams={params}
          busy={mayaRunBusy}
          onClose={() => setParamsModalOpen(false)}
          onSave={async (p) => {
            setParams(p);
            await saveLastParams(script.id, p, script.currentRevisionId ?? undefined);
            setParamsModalOpen(false);
          }}
          onSaveAndRun={async (p) => {
            setParams(p);
            await saveLastParams(script.id, p, script.currentRevisionId ?? undefined);
            setParamsModalOpen(false);
            await runMaya(p);
          }}
        />
      ) : null}
    </div>
  );
}
