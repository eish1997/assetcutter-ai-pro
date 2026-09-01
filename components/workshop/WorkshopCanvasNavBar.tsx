import React from 'react';
import { ArrowUp, Box, ChevronLeft, ChevronRight, File, FileText, Film, Image, LayoutGrid } from 'lucide-react';
import { WORKFLOW_EDGE_GUTTER } from '../workflow/workflowSectionUiConstants';
import type {
  WorkshopCanvasKindFilter,
  WorkshopNavCrumb,
  WorkshopNavLoc,
} from '../../services/workshopCanvasNav';

const KIND_CHIPS: Array<{
  id: WorkshopCanvasKindFilter;
  label: string;
  Icon: typeof LayoutGrid;
}> = [
  { id: 'all', label: '全部', Icon: LayoutGrid },
  { id: 'image', label: '图片', Icon: Image },
  { id: 'model3d', label: '三维', Icon: Box },
  { id: 'video', label: '视频', Icon: Film },
  { id: 'text', label: '文本', Icon: FileText },
  { id: 'file', label: '其它', Icon: File },
];

const NAV_BTN =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-gray-300 ring-1 ring-white/[0.08] hover:bg-white/[0.1] hover:text-[#e8e6e1] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#c9a36a]/45 disabled:opacity-35 disabled:pointer-events-none disabled:hover:bg-white/[0.05] disabled:hover:text-gray-300';

function kindChipClass(on: boolean): string {
  return on
    ? 'flex h-11 w-9 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md bg-[#c9a36a]/15 text-[#c9a36a] ring-1 ring-[#c9a36a]/70 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#c9a36a]/45'
    : 'flex h-11 w-9 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md bg-white/[0.05] text-[#8b8b93] ring-1 ring-white/[0.08] hover:bg-white/[0.1] hover:text-[#e8e6e1] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#c9a36a]/45';
}

export function WorkshopCanvasNavBar(props: {
  kindFilter: WorkshopCanvasKindFilter;
  kindCounts: Record<WorkshopCanvasKindFilter, number>;
  onKindFilter: (next: WorkshopCanvasKindFilter) => void;
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  crumbs: WorkshopNavCrumb[];
  onCrumb: (loc: WorkshopNavLoc) => void;
}): React.ReactElement {
  return (
    <div
      data-workshop-canvas-nav
      className={`shrink-0 flex flex-col gap-1 ${WORKFLOW_EDGE_GUTTER} pt-1.5 pb-1`}
    >
      <div className="flex items-end gap-1">
        {KIND_CHIPS.map((chip) => {
          const on = props.kindFilter === chip.id;
          const count = props.kindCounts[chip.id] ?? 0;
          return (
            <button
              key={chip.id}
              type="button"
              title={chip.label}
              aria-pressed={on}
              aria-label={`${chip.label} ${count}`}
              onClick={() => {
                if (chip.id !== 'all' && on) props.onKindFilter('all');
                else props.onKindFilter(chip.id);
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
      </div>
    </div>
  );
}
