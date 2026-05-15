import { useMemo } from 'react';
import type { ParamFieldV1, ParamSchemaV1 } from '../types/scriptHub';

type Props = {
  schema: ParamSchemaV1;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
};

export function ParamSchemaForm({ schema, value, onChange }: Props) {
  const fields = schema.fields;
  const setKey = (key: string, v: unknown) => {
    onChange({ ...value, [key]: v });
  };

  return (
    <div className="sh-grid-form">
      {fields.map((f) => (
        <FieldRow key={f.key} field={f} val={value[f.key]} onChange={(v) => setKey(f.key, v)} />
      ))}
    </div>
  );
}

function FieldRow({
  field,
  val,
  onChange,
}: {
  field: ParamFieldV1;
  val: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `pf-${field.key}`;
  switch (field.type) {
    case 'bool': {
      const checked = Boolean(val ?? field.default ?? false);
      return (
        <label className="sh-radio-label" style={{ display: 'flex', gap: 8 }}>
          <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
          <span>{field.label}</span>
        </label>
      );
    }
    case 'int':
    case 'float': {
      const n = typeof val === 'number' ? val : Number(val ?? field.default ?? 0);
      return (
        <label className="sh-label">
          {field.label}
          <input
            id={id}
            className="sh-input sh-mono"
            type="number"
            value={Number.isFinite(n) ? n : 0}
            onChange={(e) =>
              onChange(field.type === 'int' ? Number.parseInt(e.target.value, 10) : Number(e.target.value))
            }
          />
        </label>
      );
    }
    case 'text': {
      const t = String(val ?? field.default ?? '');
      return (
        <label className="sh-label">
          {field.label}
          <textarea id={id} className="sh-textarea sh-mono" rows={4} value={t} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    }
    case 'enum': {
      const opts = field.enumOptions ?? [];
      const cur = String(val ?? field.default ?? (opts[0]?.value ?? ''));
      return (
        <fieldset className="sh-fieldset">
          <legend>{field.label}</legend>
          <div className="sh-radio-row">
            {opts.map((o) => (
              <label key={o.value} className="sh-radio-label">
                <input type="radio" name={field.key} checked={cur === o.value} onChange={() => onChange(o.value)} />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    case 'path':
    case 'string':
    default: {
      const t = String(val ?? field.default ?? '');
      return (
        <label className="sh-label">
          {field.label}
          <input id={id} className="sh-input" type="text" value={t} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    }
  }
}

export function useParamDefaults(schema: ParamSchemaV1): Record<string, unknown> {
  return useMemo(() => {
    const o: Record<string, unknown> = {};
    for (const f of schema.fields) {
      if (f.default !== undefined) o[f.key] = f.default;
    }
    return o;
  }, [schema]);
}
