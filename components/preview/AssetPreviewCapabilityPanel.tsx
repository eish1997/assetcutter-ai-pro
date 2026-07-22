import React, { useMemo, useState } from 'react';

import { CustomDropdown, DROPDOWN_TRIGGER_COMPACT } from '../ui/CustomDropdown';
import type {
  AssetCapability,
  AssetCapabilityInputField,
  AssetCapabilityRunResult,
  AssetPreviewContext,
} from './assetPreviewTypes';

function defaultValueForField(field: AssetCapabilityInputField): unknown {
  if ('defaultValue' in field && field.defaultValue !== undefined) return field.defaultValue;
  if (field.type === 'boolean') return false;
  if (field.type === 'number') return field.min ?? 0;
  return '';
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

type Props = {
  capability: AssetCapability;
  context: AssetPreviewContext;
  onClose: () => void;
  onResult: (result: AssetCapabilityRunResult) => void;
};

export const AssetPreviewCapabilityPanel: React.FC<Props> = ({
  capability,
  context,
  onClose,
  onResult,
}) => {
  const schema = useMemo(() => capability.inputSchema || [], [capability.inputSchema]);
  const initialInput = useMemo(() => {
    const next: Record<string, unknown> = {};
    for (const field of schema) next[field.name] = defaultValueForField(field);
    return next;
  }, [schema]);
  const [input, setInput] = useState<Record<string, unknown>>(initialInput);
  const [running, setRunning] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');

  const update = (name: string, value: unknown) => {
    setInput((prev) => ({ ...prev, [name]: value }));
  };

  const run = async () => {
    if (running) return;
    setRunning(true);
    setErrorText('');
    setStatusText('准备运行...');
    try {
      const result = await capability.run({
        asset: context.asset,
        variant: context.variant,
        input,
        source: 'preview_inspector',
        onProgress: (event) => {
          setStatusText(
            event.progress != null ? `${event.label} ${Math.round(event.progress * 100)}%` : event.label
          );
        },
      });
      onResult(result);
      setStatusText(result.status === 'succeeded' ? '已生成输出' : result.error?.message || result.status);
      if (result.status === 'failed') setErrorText(result.error?.message || '能力运行失败');
    } catch (e) {
      const message = e instanceof Error ? e.message : '能力运行异常';
      setErrorText(message);
      onResult({ status: 'failed', error: { message, retryable: true } });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="pointer-events-auto w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-white/10 bg-[#0d0e12]/95 p-3 text-gray-200 shadow-2xl ring-1 ring-white/[0.05] backdrop-blur-xl"
      data-image-preview-no-wheel
      data-image-preview-scroll
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-black text-white">{capability.label}</div>
          {capability.description ? (
            <div className="mt-1 text-[9px] leading-4 text-gray-500">{capability.description}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded-md border border-white/10 bg-white/[0.04] px-2 text-[10px] font-bold text-gray-400 hover:bg-white/[0.08] hover:text-white"
        >
          关闭
        </button>
      </div>
      {schema.length > 0 ? (
        <div className="mt-3 space-y-2">
          {schema.map((field) => (
            <label key={field.name} className="block">
              <span className="mb-1 block text-[9px] font-black text-gray-500">{field.label}</span>
              {field.type === 'boolean' ? (
                <button
                  type="button"
                  aria-pressed={Boolean(input[field.name])}
                  onClick={() => update(field.name, !input[field.name])}
                  className={`h-8 rounded-lg px-3 text-[10px] font-bold ring-1 transition-colors ${
                    input[field.name]
                      ? 'bg-blue-600/80 text-white ring-blue-300/40'
                      : 'bg-white/[0.04] text-gray-300 ring-white/10 hover:bg-white/[0.08]'
                  }`}
                >
                  {input[field.name] ? '开启' : '关闭'}
                </button>
              ) : field.type === 'select' ? (
                <CustomDropdown
                  value={stringifyValue(input[field.name])}
                  onChange={(value) => update(field.name, value)}
                  options={field.options}
                  triggerClassName={`${DROPDOWN_TRIGGER_COMPACT} w-full`}
                  portalZIndex={{ backdrop: 2700, list: 2701 }}
                />
              ) : field.type === 'number' ? (
                <input
                  type="number"
                  value={stringifyValue(input[field.name])}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  onChange={(e) => update(field.name, Number(e.currentTarget.value))}
                  className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[10px] text-gray-200 outline-none focus:border-blue-400"
                />
              ) : (
                <input
                  type="text"
                  value={stringifyValue(input[field.name])}
                  onChange={(e) => update(field.name, e.currentTarget.value)}
                  className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[10px] text-gray-200 outline-none focus:border-blue-400"
                />
              )}
            </label>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-[9px] text-gray-500">{errorText || statusText || '等待运行'}</div>
        <button
          type="button"
          disabled={running}
          onClick={() => void run()}
          className="h-8 rounded-lg bg-blue-600 px-3 text-[10px] font-black text-white shadow-lg shadow-blue-950/30 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? '运行中' : '运行'}
        </button>
      </div>
    </div>
  );
};

export default AssetPreviewCapabilityPanel;
