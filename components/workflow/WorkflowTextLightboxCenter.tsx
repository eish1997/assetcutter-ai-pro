import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { clampWorkflowTextBody } from '../../services/workflowTextAsset';
import {
  WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS,
  workflowTextLengthTier,
} from '../../services/workflowTextLimits';

export type WorkflowTextLightboxCenterHandle = {
  flush: () => void;
};

type Props = {
  resetKey: string;
  title: string;
  body: string;
  onPersist: (next: { textTitle: string; textBody: string }) => void;
  onAddToComposeInput?: (text: string) => void;
};

type TextViewMode = 'read' | 'edit' | 'structure';

function normalizeTitle(title: string): string {
  return title.trim() || '文本资产';
}

function buildMarkdown(title: string, body: string): string {
  const safeTitle = normalizeTitle(title).replace(/^#+\s*/gm, '');
  return `# ${safeTitle}\n\n${body.trim()}\n`;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

const WorkflowTextLightboxCenter = forwardRef<WorkflowTextLightboxCenterHandle, Props>(
  function WorkflowTextLightboxCenter({ resetKey, title, body, onPersist, onAddToComposeInput }, ref) {
    const [draftBody, setDraftBody] = useState(body);
    const [mode, setMode] = useState<TextViewMode>('read');
    const titleRef = useRef(title);
    const onPersistRef = useRef(onPersist);

    useEffect(() => {
      titleRef.current = title;
    }, [title]);

    useEffect(() => {
      onPersistRef.current = onPersist;
    }, [onPersist]);

    useEffect(() => {
      setDraftBody(body);
      setMode('read');
    }, [resetKey, body]);

    const flush = useCallback(() => {
      onPersistRef.current({
        textTitle: titleRef.current.trim(),
        textBody: clampWorkflowTextBody(draftBody),
      });
    }, [draftBody]);

    useImperativeHandle(ref, () => ({ flush }), [flush]);

    const lengthTier = workflowTextLengthTier(draftBody.length);
    const titleText = normalizeTitle(title);
    const stats = useMemo(() => {
      const trimmed = draftBody.trim();
      const paragraphs = trimmed ? trimmed.split(/\n\s*\n/g).filter((part) => part.trim()).length : 0;
      const lines = draftBody ? draftBody.split(/\r?\n/).length : 0;
      const cjkChars = (draftBody.match(/[\u3400-\u9fff]/g) || []).length;
      const words = (draftBody.match(/[A-Za-z0-9_'-]+/g) || []).length + cjkChars;
      return { chars: draftBody.length, lines, paragraphs, words };
    }, [draftBody]);
    const structureRows = useMemo(
      () => [
        ['标题', titleText],
        ['字符', stats.chars.toLocaleString()],
        ['词/字', stats.words.toLocaleString()],
        ['段落', stats.paragraphs.toLocaleString()],
        ['行数', stats.lines.toLocaleString()],
      ],
      [stats.chars, stats.lines, stats.paragraphs, stats.words, titleText]
    );

    const copyFullText = useCallback(() => {
      const text = `${titleText}\n\n${draftBody}`.trim();
      void navigator.clipboard?.writeText(text);
    }, [draftBody, titleText]);

    const downloadTxt = useCallback(() => {
      downloadTextFile('workflow-text-asset.txt', `${titleText}\n\n${draftBody}`.trim(), 'text/plain;charset=utf-8');
    }, [draftBody, titleText]);

    const downloadMd = useCallback(() => {
      downloadTextFile('workflow-text-asset.md', buildMarkdown(titleText, draftBody), 'text/markdown;charset=utf-8');
    }, [draftBody, titleText]);

    const addToComposeInput = useCallback(() => {
      onAddToComposeInput?.(`${titleText}\n\n${draftBody}`.trim());
    }, [draftBody, onAddToComposeInput, titleText]);

    return (
      <div
        className="pointer-events-auto flex h-[min(82vh,56rem)] w-full min-h-0 min-w-0 flex-col rounded-2xl border border-white/10 bg-[#101114]/96 shadow-2xl"
        onMouseDownCapture={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-gray-100">{titleText}</p>
            <p
              className={`mt-0.5 text-[10px] tabular-nums ${
                lengthTier === 'confirm'
                  ? 'text-amber-300'
                  : lengthTier === 'warn'
                    ? 'text-amber-500/90'
                    : 'text-gray-500'
              }`}
            >
              {draftBody.length.toLocaleString()} / {WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS.toLocaleString()}
              {lengthTier === 'warn' ? ' · 较长' : null}
              {lengthTier === 'confirm' ? ' · 入队前将确认' : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-lg bg-white/[0.04] p-1">
            {(['read', 'edit', 'structure'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={[
                  'h-7 rounded-md px-2 text-[10px] font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60',
                  mode === key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-white/[0.08] hover:text-gray-200',
                ].join(' ')}
              >
                {key === 'read' ? '阅读' : key === 'edit' ? '编辑' : '结构'}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={copyFullText}
              className="h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[10px] font-bold text-gray-300 hover:bg-white/[0.08] hover:text-white"
            >
              复制全文
            </button>
            {onAddToComposeInput ? (
              <button
                type="button"
                onClick={addToComposeInput}
                className="h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[10px] font-bold text-gray-300 hover:bg-white/[0.08] hover:text-white"
              >
                加入输入框
              </button>
            ) : null}
            <button
              type="button"
              onClick={downloadTxt}
              className="h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[10px] font-bold text-gray-300 hover:bg-white/[0.08] hover:text-white"
            >
              TXT
            </button>
            <button
              type="button"
              onClick={downloadMd}
              className="h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[10px] font-bold text-gray-300 hover:bg-white/[0.08] hover:text-white"
            >
              MD
            </button>
          </div>
        </div>

        <div
          className="grid shrink-0 grid-cols-4 gap-px border-b border-white/10 bg-white/[0.04] text-center text-[10px] text-gray-400"
          aria-label="文本统计"
        >
          <div className="bg-[#101114] px-2 py-2">
            <strong className="text-gray-200">{stats.chars.toLocaleString()}</strong> 字符
          </div>
          <div className="bg-[#101114] px-2 py-2">
            <strong className="text-gray-200">{stats.words.toLocaleString()}</strong> 词/字
          </div>
          <div className="bg-[#101114] px-2 py-2">
            <strong className="text-gray-200">{stats.paragraphs.toLocaleString()}</strong> 段
          </div>
          <div className="bg-[#101114] px-2 py-2">
            <strong className="text-gray-200">{stats.lines.toLocaleString()}</strong> 行
          </div>
        </div>

        {mode === 'edit' ? (
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(clampWorkflowTextBody(e.target.value))}
            className="min-h-0 w-full flex-1 resize-none border-0 bg-[#141416]/95 px-5 py-4 font-mono text-[13px] leading-relaxed text-gray-100 outline-none focus:ring-1 focus:ring-inset focus:ring-blue-500"
            placeholder="在此输入文字内容..."
            spellCheck={false}
            data-image-preview-scroll
          />
        ) : mode === 'structure' ? (
          <div className="min-h-0 flex-1 overflow-auto p-4" data-image-preview-scroll>
            <div className="overflow-hidden rounded-xl border border-white/10">
              {structureRows.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[5rem_1fr] border-b border-white/10 last:border-b-0">
                  <div className="bg-white/[0.04] px-3 py-2 text-[11px] font-bold text-gray-400">{label}</div>
                  <div className="min-w-0 px-3 py-2 text-[11px] text-gray-200">{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[10px] font-bold uppercase text-gray-500">Preview</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-gray-300">
                {draftBody.trim() || '空白文本'}
              </p>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto px-6 py-5" data-image-preview-scroll>
            <article className="mx-auto max-w-3xl whitespace-pre-wrap break-words text-[14px] leading-7 text-gray-100">
              {draftBody.trim() || '空白文本'}
            </article>
          </div>
        )}
      </div>
    );
  }
);

export default WorkflowTextLightboxCenter;
