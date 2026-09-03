import React from 'react';
import { ArrowUp, Box, ChevronLeft, ChevronRight, File, FileText, Film, FolderOpen, FolderX, Image, ListFilter, RefreshCw, Tag } from 'lucide-react';
import { CustomDropdown } from '../ui/CustomDropdown';
import { WORKFLOW_EDGE_GUTTER } from '../workflow/workflowSectionUiConstants';
import { workshopPreviewKindExts } from '../../services/workshopPreviewKind';
import type {
  WorkshopCanvasKindId,
  WorkshopCanvasListPrefs,
  WorkshopCanvasSortKey,
  WorkshopNavCrumb,
  WorkshopNavLoc,
} from '../../services/workshopCanvasNav';

const KIND_CHIPS: Array<{
  id: WorkshopCanvasKindId;
  label: string;
  Icon: typeof Image;
}> = [
  { id: 'image', label: '图片', Icon: Image },
  { id: 'model3d', label: '三维', Icon: Box },
  { id: 'video', label: '视频', Icon: Film },
  { id: 'text', label: '文本', Icon: FileText },
  { id: 'file', label: '其它', Icon: File },
];

function chipTitle(id: WorkshopCanvasKindId, label: string): string {
  if (id === 'file') return `${label} · 右键仅显示此类`;
  const exts = workshopPreviewKindExts(id).join(' ');
  return `${label} ${exts} · 右键仅显示此类`;
}

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'name', label: '名称' },
  { value: 'created', label: '创建时间' },
  { value: 'modified', label: '修改时间' },
  { value: 'size', label: '文件大小' },
  { value: 'folder', label: '文件夹' },
  { value: 'groupByType', label: '按类型分组' },
];

const NAV_BTN =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-gray-300 ring-1 ring-white/[0.08] hover:bg-white/[0.1] hover:text-[#e8e6e1] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#c9a36a]/45 disabled:opacity-35 disabled:pointer-events-none disabled:hover:bg-white/[0.05] disabled:hover:text-gray-300';

function kindChipClass(on: boolean): string {
  return on
    ? 'flex h-11 w-9 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md bg-[#c9a36a]/15 text-[#c9a36a] ring-1 ring-[#c9a36a]/70 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#c9a36a]/45'
    : 'flex h-11 w-9 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md bg-white/[0.05] text-[#8b8b93] ring-1 ring-white/[0.08] hover:bg-white/[0.1] hover:text-[#e8e6e1] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#c9a36a]/45';
}

function toolBtnClass(on: boolean): string {
  return on
    ? `${NAV_BTN} text-[#c9a36a] ring-[#c9a36a]/70`
    : NAV_BTN;
}

export function WorkshopCanvasNavBar(props: {
  kindFilter: WorkshopCanvasKindId[];
  kindCounts: Record<WorkshopCanvasKindId, number>;
  onToggleKind: (id: WorkshopCanvasKindId) => void;
  onIsolateKind: (id: WorkshopCanvasKindId) => void;
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  canRevealCurrent?: boolean;
  onRevealCurrent?: () => void;
  crumbs: WorkshopNavCrumb[];
  onCrumb: (loc: WorkshopNavLoc) => void;
  listPrefs: WorkshopCanvasListPrefs;
  onListPrefs: (next: WorkshopCanvasListPrefs) => void;
  onRefresh: () => void;
  nameFilter: string;
  onNameFilter: (next: string) => void;
}): React.ReactElement {
  const { listPrefs } = props;
  const kindSet = new Set(props.kindFilter);
  return (
    <div
      data-workshop-canvas-nav
      className={`shrink-0 flex flex-col gap-1 ${WORKFLOW_EDGE_GUTTER} pt-1.5 pb-1`}
    >
      <div className="flex items-end gap-1">
        {KIND_CHIPS.map((chip) => {
          const on = kindSet.has(chip.id);
          const count = props.kindCounts[chip.id] ?? 0;
          return (
            <button
              key={chip.id}
              type="button"
              title={chipTitle(chip.id, chip.label)}
              aria-pressed={on}
              aria-label={`${chip.label} ${count}`}
              onClick={() => props.onToggleKind(chip.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                props.onIsolateKind(chip.id);
              }}
              className={kindChipClass(on)}
            >
              <chip.Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="mono text-[8px] leading-none tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <button type="button" className={NAV_BTN} disabled={!props.canBack} onClick={props.onBack} aria-label="后退" title="后退">
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          className={NAV_BTN}
          disabled={!props.canForward}
          onClick={props.onForward}
          aria-label="前进"
          title="前进"
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button type="button" className={NAV_BTN} disabled={!props.canUp} onClick={props.onUp} aria-label="上一级" title="上一级">
          <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          className={NAV_BTN}
          disabled={!props.canRevealCurrent}
          onClick={props.onRevealCurrent}
          aria-label="打开当前文件夹"
          title="打开当前文件夹"
        >
          <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <nav
          aria-label="目录路径"
          className="ml-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto no-scrollbar rounded-md bg-white/[0.03] px-1.5 py-0.5 ring-1 ring-white/[0.06]"
        >
          {props.crumbs.map((crumb, idx) => {
            const last = idx === props.crumbs.length - 1;
            return (
              <React.Fragment key={crumb.id}>
                {idx > 0 ? (
                  <ChevronRight className="h-3 w-3 shrink-0 text-white/25" strokeWidth={2} aria-hidden />
                ) : null}
                <button
                  type="button"
                  title={crumb.label}
                  disabled={last}
                  onClick={() => props.onCrumb(crumb.loc)}
                  className={`mono max-w-[10rem] truncate text-[10px] leading-none ${
                    last
                      ? 'text-[#e8e6e1] cursor-default'
                      : 'text-[#8b8b93] hover:text-[#e8e6e1] hover:underline underline-offset-2'
                  }`}
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            );
          })}
        </nav>
        <button
          type="button"
          className={toolBtnClass(listPrefs.flatten)}
          aria-pressed={listPrefs.flatten}
          aria-label="忽略文件夹并显示全部"
          title={listPrefs.flatten ? '正在显示全部文件（已忽略文件夹）' : '忽略文件夹，显示全部'}
          onClick={() => props.onListPrefs({ ...listPrefs, flatten: !listPrefs.flatten })}
        >
          <FolderX className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          className={toolBtnClass(listPrefs.hideFormatBadges)}
          aria-pressed={listPrefs.hideFormatBadges}
          aria-label="隐藏格式角标"
          title={listPrefs.hideFormatBadges ? '正在隐藏格式角标' : '隐藏格式角标'}
          onClick={() => props.onListPrefs({ ...listPrefs, hideFormatBadges: !listPrefs.hideFormatBadges })}
        >
          <Tag className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          className={NAV_BTN}
          aria-label="刷新"
          title="刷新"
          onClick={props.onRefresh}
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <CustomDropdown
          value={listPrefs.sortKey}
          options={SORT_OPTIONS}
          listMinWidth={148}
          listDensity="compact"
          triggerAriaLabel="排序"
          triggerClassName={`${NAV_BTN} p-0`}
          renderTrigger={({ open }) => (
            <span className={open ? 'text-[#c9a36a]' : undefined} title="排序">
              <ListFilter className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
          )}
          renderListItem={(opt) => {
            if (opt.value === 'groupByType') {
              return (
                <span className="flex w-full items-center justify-between gap-2">
                  <span>{opt.label}</span>
                  <span className="text-[9px] text-[#c9a36a]">{listPrefs.groupByType ? '✓' : ''}</span>
                </span>
              );
            }
            const on = opt.value === listPrefs.sortKey;
            return (
              <span className="flex w-full items-center justify-between gap-2">
                <span>{opt.label}</span>
                {on ? <span className="text-[9px] text-[#c9a36a]">{listPrefs.sortDir === 'desc' ? '↓' : '↑'}</span> : null}
              </span>
            );
          }}
          onChange={(next) => {
            if (next === 'groupByType') {
              props.onListPrefs({ ...listPrefs, groupByType: !listPrefs.groupByType });
              return;
            }
            const sortKey = next as WorkshopCanvasSortKey;
            if (sortKey === listPrefs.sortKey) {
              props.onListPrefs({
                ...listPrefs,
                sortDir: listPrefs.sortDir === 'asc' ? 'desc' : 'asc',
              });
              return;
            }
            props.onListPrefs({ ...listPrefs, sortKey, sortDir: 'asc' });
          }}
        />
        <input
          type="search"
          value={props.nameFilter}
          onChange={(e) => props.onNameFilter(e.target.value)}
          placeholder="过滤文件名"
          aria-label="过滤文件名"
          className="h-7 w-[7.5rem] shrink-0 rounded-md bg-white/[0.05] px-2 text-[10px] text-[#e8e6e1] outline-none ring-1 ring-white/[0.08] placeholder:text-white/30 focus-visible:ring-2 focus-visible:ring-[#c9a36a]/45"
        />
      </div>
    </div>
  );
}
