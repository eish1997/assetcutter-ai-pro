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
  type StoryboardBulkTextMode,
} from '../../services/storyboardTableBulkImport';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import {
  STORYBOARD_FIELD_INPUT,
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
  STORYBOARD_VIEW_TOGGLE,
  STORYBOARD_VIEW_TOGGLE_ACTIVE,
  STORYBOARD_VIEW_TOGGLE_BTN,
  STORYBOARD_VIEW_TOGGLE_IDLE,
} from './storyboardTableUi';

export type StoryboardBulkInputMode = 'image' | 'pipe' | 'tsv';

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

const TSV_PLACEHOLDER = `镜头号\t景别\t角度\t运镜\t时长\t画面内容\t对白\t服化道建议\t光影设计
SC01_SH001\t大远景\t平视\t固定\t3.0s\t清北市夜景全景\t-\t-\t暖黄色城市灯光`;

const LEGEND_ITEMS = [
  { color: 'text-red-400', label: '红箭头', desc: '人物 / 动作' },
  { color: 'text-sky-400', label: '蓝箭头', desc: '摄影机运动' },
  { color: 'text-emerald-400', label: '绿括号', desc: '取景 / 构图' },
  { color: 'text-amber-400', label: '橙箭头', desc: '灯光方向' },
  { color: 'text-violet-400', label: '紫波浪', desc: '情绪 / 声音' },
] as const;

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<StoryboardBulkInputMode>('pipe');
  const [pipeText, setPipeText] = useState('');
  const [tsvText, setTsvText] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | undefined>();
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    const draft = readLocalJson(draftStorageKey(assetId), defaultDraft());
    setMode(draft.mode);
    setPipeText(draft.pipeText);
    setTsvText(draft.tsvText);
    setImageDataUrl(draft.imageDataUrl);
  }, [assetId]);

  const persistDraft = useCallback(
    (patch: Partial<StoryboardBulkDraft>) => {
      const next: StoryboardBulkDraft = {
        mode: patch.mode ?? mode,
        pipeText: patch.pipeText ?? pipeText,
        tsvText: patch.tsvText ?? tsvText,
        imageDataUrl: patch.imageDataUrl !== undefined ? patch.imageDataUrl : imageDataUrl,
      };
      writeLocalJson(draftStorageKey(assetId), next);
      onDraftChange?.();
    },
    [assetId, imageDataUrl, mode, onDraftChange, pipeText, tsvText]
  );

  const activeText = mode === 'tsv' ? tsvText : pipeText;
  const preview = useMemo(() => {
    if (mode === 'image' || !activeText.trim()) return null;
    return parseStoryboardBulkText(activeText, mode as StoryboardBulkTextMode);
  }, [activeText, mode]);

  const handleModeChange = (next: StoryboardBulkInputMode) => {
    setMode(next);
    persistDraft({ mode: next });
  };

  const handleTextChange = (value: string) => {
    if (mode === 'tsv') {
      setTsvText(value);
      persistDraft({ tsvText: value });
      return;
    }
    setPipeText(value);
    persistDraft({ pipeText: value });
  };

  const handlePickImage = () => {
    fileRef.current?.click();
  };

  const handleImageFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) {
      onNotify?.('warn', '请选择图片文件');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      onNotify?.('warn', '图片过大，请小于 12MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      setImageDataUrl(dataUrl);
      persistDraft({ imageDataUrl: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const handleImport = () => {
    if (readOnly || importBusy) return;
    if (mode === 'image') {
      onNotify?.('info', '分镜图已保存为参考，结构化识别即将支持');
      return;
    }

    const parsed = parseStoryboardBulkText(activeText, mode as StoryboardBulkTextMode);
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
        <div className={STORYBOARD_VIEW_TOGGLE} role="group" aria-label="批量输入方式">
          {(
            [
              ['image', '分镜图'],
              ['pipe', '分镜文本'],
              ['tsv', '表格'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={readOnly}
              onClick={() => handleModeChange(value)}
              className={`${STORYBOARD_VIEW_TOGGLE_BTN} ${
                mode === value ? STORYBOARD_VIEW_TOGGLE_ACTIVE : STORYBOARD_VIEW_TOGGLE_IDLE
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode !== 'image' && preview?.rows.length ? (
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
          {importBusy ? '导入中…' : mode === 'image' ? '保存参考' : '导入到镜头'}
        </button>
      </div>

      {mode === 'image' ? (
        <div className="flex min-h-0 flex-1 flex-col space-y-2 overflow-auto">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              handleImageFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <div className="flex flex-wrap gap-2">
            {LEGEND_ITEMS.map((item) => (
              <span key={item.label} className="text-[9px] text-gray-500">
                <span className={`font-semibold ${item.color}`}>{item.label}</span>
                <span className="text-gray-600"> {item.desc}</span>
              </span>
            ))}
          </div>
          {imageDataUrl ? (
            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/30">
              <img
                src={imageDataUrl}
                alt="分镜表参考"
                className="max-h-40 w-full object-contain"
              />
            </div>
          ) : (
            <p className="text-[10px] leading-relaxed text-gray-600">
              上传手绘分镜表或打印稿作参考。左侧为镜头元数据，右侧为草图与标注（红动作、蓝运镜、绿构图、橙灯光、紫情绪）。
            </p>
          )}
          <button
            type="button"
            disabled={readOnly}
            onClick={handlePickImage}
            className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-7 px-2.5 text-[10px]`}
          >
            {imageDataUrl ? '更换图片' : '上传分镜图'}
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col space-y-1.5">
          <textarea
            value={activeText}
            readOnly={readOnly}
            placeholder={mode === 'tsv' ? TSV_PLACEHOLDER : PIPE_PLACEHOLDER}
            onChange={(event) => handleTextChange(event.target.value)}
            className={`${STORYBOARD_FIELD_INPUT} min-h-[10rem] flex-1 resize-none font-mono text-[10px] leading-relaxed`}
          />
          {preview?.errors.length ? (
            <p className="text-[9px] text-amber-300/90">{preview.errors[0]}</p>
          ) : null}
          <p className="text-[9px] text-gray-600">
            {mode === 'tsv'
              ? '从 Excel 复制表格后粘贴（制表符分隔）；首行须为列名。'
              : '管道符分隔，首行为列名；「-」视为空。'}
          </p>
        </div>
      )}
    </div>
  );
}
