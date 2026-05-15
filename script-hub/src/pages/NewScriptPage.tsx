import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createScript, createRevision } from '../services/scriptHubApi';
import { DEFAULT_MAYA_SCRIPT, DEFAULT_PARAM_SCHEMA } from '../defaultScriptHub';

export function NewScriptPage() {
  const nav = useNavigate();
  const [title, setTitle] = useState('Script Hub 联调测试');
  const [slug, setSlug] = useState(`local-smoke-${Date.now().toString(36)}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const { script } = await createScript({
        title: title.trim(),
        slug: slug.trim().toLowerCase(),
        targetType: 'maya',
      });
      await createRevision(script.id, {
        schema: DEFAULT_PARAM_SCHEMA,
        content: DEFAULT_MAYA_SCRIPT,
        changelog: 'init',
      });
      nav(`/scripts/${script.id}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="sh-h1">新建脚本</h1>
      <p className="sh-muted" style={{ marginTop: 0 }}>
        将创建 Maya 目标脚本，并写入默认示例 revision。
      </p>
      <form className="sh-grid-form" onSubmit={onSubmit} style={{ maxWidth: 440 }}>
        <label className="sh-label">
          标题
          <input className="sh-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="sh-label">
          Slug（URL 用，小写+数字+连字符）
          <input className="sh-input sh-mono" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>
        {err ? (
          <p className="sh-alert" role="alert">
            {err}
          </p>
        ) : null}
        <button className="sh-btn sh-btn-primary" type="submit" disabled={busy}>
          {busy ? '创建中…' : '创建'}
        </button>
      </form>
    </div>
  );
}
