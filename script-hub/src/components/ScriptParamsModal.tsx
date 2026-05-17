import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ParamSchemaForm } from './ParamSchemaForm';
import type { ParamSchemaV1 } from '../types/scriptHub';
import { resolveParamsForRun } from '../utils/paramDefaults';

type Props = {
  open: boolean;
  title: string;
  schema: ParamSchemaV1;
  initialParams: Record<string, unknown> | null;
  busy?: boolean;
  onClose: () => void;
  onSave: (params: Record<string, unknown>) => void | Promise<void>;
  onSaveAndRun?: (params: Record<string, unknown>) => void | Promise<void>;
};

export function ScriptParamsModal({
  open,
  title,
  schema,
  initialParams,
  busy,
  onClose,
  onSave,
  onSaveAndRun,
}: Props) {
  const [params, setParams] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!open) return;
    setParams(resolveParamsForRun(schema, initialParams));
  }, [open, schema, initialParams]);

  if (!open) return null;

  return createPortal(
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2400,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        className="sh-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="script-params-modal-title"
        style={{ width: 'min(520px, 92vw)', maxHeight: '85vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="script-params-modal-title" className="sh-h3" style={{ marginTop: 0 }}>
          运行参数 · {title}
        </h2>
        <p className="sh-muted" style={{ margin: '0 0 1rem', fontSize: '0.85rem' }}>
          保存后将同步到账号云端，作为该脚本的「上次参数」；直接执行也会使用此处数值。
        </p>
        <ParamSchemaForm schema={schema} value={params} onChange={setParams} />
        <div className="sh-row-actions" style={{ marginTop: '1.25rem' }}>
          <button type="button" className="sh-btn sh-btn-ghost" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="sh-btn"
            disabled={busy}
            onClick={() => void Promise.resolve(onSave(params))}
          >
            保存为上次参数
          </button>
          {onSaveAndRun ? (
            <button
              type="button"
              className="sh-btn sh-btn-primary"
              disabled={busy}
              onClick={() => void Promise.resolve(onSaveAndRun(params))}
            >
              保存并执行
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
