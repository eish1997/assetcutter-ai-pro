import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { CustomDropdown } from '../ui/CustomDropdown';
import { clampWorkflowTextBody } from '../../services/workflowTextAsset';
import {
  WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS,
  workflowTextLengthTier,
} from '../../services/workflowTextLimits';
import { LIGHTBOX_FLAT_WELL_INSET } from '../../services/imagePreviewFitViewport';
import {
  WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER,
} from './workflowSectionUiConstants';

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

type TextViewMode = 'read' | 'edit';

const COMPOSE_FOCUS =
  'outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f12]';

/** 与右上角预览栏同族，实色底 + 实色描边（不用 white/10 透边）。 */
const TEXT_CHROME_RAIL =
  'flex w-full min-w-0 flex-wrap items-center gap-1 rounded-xl border border-[#2e2e32] bg-[#0f0f12] px-1.5 py-1 shadow-xl';

const TEXT_BTN = [
  'inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md px-2.5',
  'text-[10px] font-semibold whitespace-nowrap transition-colors',
  'bg-white/[0.04] text-gray-400 ring-1 ring-white/[0.07] hover:bg-white/[0.08] hover:text-gray-200',
  COMPOSE_FOCUS,
].join(' ');

const TEXT_BTN_ACTIVE = [
  'inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md px-2.5',
  'text-[10px] font-semibold whitespace-nowrap transition-colors',
  'bg-white/[0.16] text-white ring-1 ring-white/[0.22]',
  COMPOSE_FOCUS,
].join(' ');

const PAPER =
  'w-full rounded-xl border border-[#2e2e32] bg-[#121214] px-8 py-10 text-[#e8e6e1]';

const EXPORT_OPTIONS = [
  { value: 'txt', label: 'TXT' },
  { value: 'md', label: 'MD' },
] as const;

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
    const isEmpty = !draftBody.trim();

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
        className="pointer-events-auto relative h-full w-full min-h-0 min-w-0"
        onMouseDownCapture={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        {/*
          与 WorkspaceQuickComposeBar.resetToDefaultPosition 同一中轴：
          left = floor((vw - w) / 2)。禁止 left:50% + translateX(-50%)：
          transform 一旦被吃掉，左缘会钉在中线，整块趴在右半屏。
        */}
        <div
          className="pointer-events-auto fixed z-[5] flex w-[min(65ch,calc(100vw-8rem))] flex-col gap-2 overflow-auto"
          data-image-preview-scroll
          style={{
            left: 0,
            right: 0,
            marginLeft: 'auto',
            marginRight: 'auto',
            transform: 'none',
            top: LIGHTBOX_FLAT_WELL_INSET.top,
            bottom: LIGHTBOX_FLAT_WELL_INSET.bottom,
          }}
        >
              <div className={TEXT_CHROME_RAIL} role="toolbar" aria-label="文本预览">
                <div className="flex min-w-0 flex-1 items-baseline gap-2 px-1.5">
                  <p className="truncate text-[12px] font-semibold text-[#e8e6e1]">{titleText}</p>
                  <p
                    className={`shrink-0 font-mono text-[10px] tabular-nums ${
                      lengthTier === 'confirm'
                        ? 'text-amber-300'
                        : lengthTier === 'warn'
                          ? 'text-amber-500/90'
                          : 'text-gray-500'
                    }`}
                  >
                    {draftBody.length.toLocaleString()} / {WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS.toLocaleString()}
                    {lengthTier === 'warn' ? ' / Long' : null}
                    {lengthTier === 'confirm' ? ' / Confirm before queue' : null}
                  </p>
                </div>
                <div className={WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER} aria-hidden />
                <div className="flex shrink-0 items-center gap-1">
                  {(['read', 'edit'] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setMode(key)}
                      className={mode === key ? TEXT_BTN_ACTIVE : TEXT_BTN}
                    >
                      {key === 'read' ? '阅读' : '编辑'}
                    </button>
                  ))}
                </div>
                <div className={WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER} aria-hidden />
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={copyFullText} className={TEXT_BTN}>
                    复制全文
                  </button>
                  {onAddToComposeInput ? (
                    <button type="button" onClick={addToComposeInput} className={TEXT_BTN}>
                      加入输入框
                    </button>
                  ) : null}
                  <CustomDropdown
                    value=""
                    placeholder="导出"
                    triggerAriaLabel="导出"
                    options={[...EXPORT_OPTIONS]}
                    onChange={(fmt) => {
                      if (fmt === 'txt') downloadTxt();
                      if (fmt === 'md') downloadMd();
                    }}
                    triggerClassName={`${TEXT_BTN} min-w-[3.75rem] justify-between`}
                    listDensity="compact"
                    listClassName="border border-[#2e2e32] bg-[#0f0f12] shadow-xl"
                    portalZIndex={{ backdrop: 2700, list: 2701 }}
                  />
                </div>
              </div>

              {mode === 'edit' ? (
                <textarea
                  value={draftBody}
                  onChange={(e) => setDraftBody(clampWorkflowTextBody(e.target.value))}
                  className={[
                    PAPER,
                    'min-h-[20rem] resize-none font-mono text-[15px] leading-[1.65]',
                    'caret-white selection:bg-white/20 selection:text-[#e8e6e1]',
                    'placeholder:text-gray-500',
                    COMPOSE_FOCUS,
                  ].join(' ')}
                  placeholder="在此输入文字内容..."
                  spellCheck={false}
                />
              ) : (
                <article
                  className={[
                    PAPER,
                    'whitespace-pre-wrap break-words text-[16px] leading-[1.7]',
                    'selection:bg-white/20 selection:text-[#e8e6e1]',
                  ].join(' ')}
                >
                  {isEmpty ? (
                    <button
                      type="button"
                      onClick={() => setMode('edit')}
                      className={`text-[16px] font-medium text-gray-500 hover:text-gray-300 ${COMPOSE_FOCUS}`}
                    >
                      点这里开始写
                    </button>
                  ) : (
                    draftBody
                  )}
                </article>
              )}
        </div>
      </div>
    );
  }
);

export default WorkflowTextLightboxCenter;
