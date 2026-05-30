import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  readLocalJson,
  writeLocalJson,
} from '../../services/clientPersist';
import {
  defaultStoryboardBulkDraft,
  storyboardBulkDraftStorageKey,
  type StoryboardBulkDraft,
} from '../../services/storyboardTableInput';
import {
  applyStoryboardBulkImport,
  parseStoryboardBulkText,
} from '../../services/storyboardTableBulkImport';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import {
  STORYBOARD_FIELD_INPUT,
  STORYBOARD_TOOL_BTN_PRIMARY,
} from './storyboardTableUi';

type Props = {
  assetId: string;
  rows: StoryboardTableRow[];
  fieldCatalog: StoryboardParseFieldDef[];
  readOnly?: boolean;
  onImport: (result: { catalog: StoryboardParseFieldDef[]; rows: StoryboardTableRow[] }) => void;
  onDraftChange?: () => void;
  onNotify?: (level: 'info' | 'warn' | 'error', message: string) => void;
};

const PIPE_PLACEHOLDER = `镜头号 | 景别 | 角度 | 运镜 | 时长 | 画面内容 | 对白 | 服化道建议 | 光影设计
SC01_SH001 | 大远景 | 平视 | 固定 | 3.0s | 清北市夜景全景，万家灯火，高楼林立 | - | - | 暖黄色城市灯光
SC01_SH002 | 远景 | 俯视 | 缓慢摇 | 2.5s | 凯丰药业大厦外观，落地窗透出微光 | - | - | 冷调环境光`;

function draftStorageKey(assetId: string): string {
  return storyboardBulkDraftStorageKey(assetId);
}

function defaultDraft(): StoryboardBulkDraft {
  return defaultStoryboardBulkDraft();
}

export default function StoryboardTableBulkInput({
  assetId,
  rows,
  fieldCatalog,
  readOnly = false,
  onImport,
  onDraftChange,
  onNotify,
}: Props) {
  const [pipeText, setPipeText] = useState('');
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    const draft = readLocalJson(draftStorageKey(assetId), defaultDraft());
    setPipeText(draft.pipeText);
  }, [assetId]);

  const persistDraft = useCallback(
    (patch: Partial<StoryboardBulkDraft>) => {
      const current = readLocalJson(draftStorageKey(assetId), defaultDraft());
      const next: StoryboardBulkDraft = {
        mode: 'pipe',
        pipeText: patch.pipeText ?? current.pipeText,
        tsvText: patch.tsvText ?? current.tsvText,
        imageDataUrl: patch.imageDataUrl !== undefined ? patch.imageDataUrl : current.imageDataUrl,
      };
      writeLocalJson(draftStorageKey(assetId), next);
      onDraftChange?.();
    },
    [assetId, onDraftChange]
  );

  const preview = useMemo(() => {
    if (!pipeText.trim()) return null;
    return parseStoryboardBulkText(pipeText, 'pipe');
  }, [pipeText]);

  const handleTextChange = (value: string) => {
    setPipeText(value);
    persistDraft({ pipeText: value });
  };

  const handleImport = () => {
    if (readOnly || importBusy) return;

    const parsed = parseStoryboardBulkText(pipeText, 'pipe');
    if (!parsed.rows.length) {
      onNotify?.('warn', parsed.errors[0] || '未解析到有效镜头');
      return;
    }

    const hasExisting = rows.some(
      (row) =>
        (row.shotRaw || '').trim() ||
        Object.values(row.shotFields || {}).some((value) => String(value || '').trim())
    );
    const replace =
      !hasExisting ||
      typeof window === 'undefined' ||
      window.confirm(`将导入 ${parsed.rows.length} 镜。覆盖当前 ${rows.length} 镜？取消则追加到末尾。`);

    setImportBusy(true);
    try {
      const result = applyStoryboardBulkImport(
        fieldCatalog,
        rows,
        parsed.rows,
        replace ? 'replace' : 'append'
      );
      onImport(result);
      const warn = parsed.errors[0];
      onNotify?.(
        'info',
        `已导入 ${parsed.rows.length} 镜${replace ? '' : '（追加）'}${warn ? `；${warn}` : ''}`
      );
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-2.5">
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold text-gray-400">解析</span>
        <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-medium text-violet-200/90 ring-1 ring-violet-400/20">
          分镜文本
        </span>
        {preview?.rows.length ? (
          <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-gray-400">
            已识别 {preview.rows.length} 镜
          </span>
        ) : null}
        <button
          type="button"
          disabled={readOnly || importBusy}
          onClick={handleImport}
          className={`${STORYBOARD_TOOL_BTN_PRIMARY} ml-auto h-7 px-2.5 text-[10px]`}
        >
          {importBusy ? '导入中…' : '导入到镜头'}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col space-y-1.5">
        <textarea
          value={pipeText}
          readOnly={readOnly}
          placeholder={PIPE_PLACEHOLDER}
          onChange={(event) => handleTextChange(event.target.value)}
          className={`${STORYBOARD_FIELD_INPUT} min-h-[10rem] flex-1 resize-none font-mono text-[10px] leading-relaxed`}
        />
        {preview?.errors.length ? (
          <p className="text-[9px] text-amber-300/90">{preview.errors[0]}</p>
        ) : null}
        <p className="text-[9px] text-gray-600">管道符分隔，首行为列名；「-」视为空。</p>
      </div>
    </div>
  );
}
