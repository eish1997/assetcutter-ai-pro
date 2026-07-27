import React, { useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

type Option = { value: string; label: string; disabled?: boolean; title?: string };

/** 与全局输入框 / 快捷栏同族的默认触发器 */
export const DROPDOWN_TRIGGER_DEFAULT =
  'bg-white/[0.05] ring-1 ring-white/[0.08] rounded-xl px-4 py-3 text-[11px] text-left text-gray-200 flex items-center justify-between outline-none transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-blue-500/45';

/** 表单内联紧凑触发器（能力编辑等） */
export const DROPDOWN_TRIGGER_COMPACT =
  'bg-white/[0.05] ring-1 ring-white/[0.08] rounded-xl px-3 py-2 text-[10px] text-left text-gray-200 flex items-center justify-between outline-none transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-blue-500/45 min-w-[5rem]';

/** 展开列表表面（与快捷栏模型弹层一致） */
export const DROPDOWN_LIST_SURFACE =
  'border border-white/10 bg-[#0f0f12] shadow-xl ring-1 ring-white/[0.05]';

/**
 * 列表项 chip（与 `WorkspaceQuickComposeBar` 模型选项同款）。
 * compose 默认用此形态，而非扁平行。
 */
export const DROPDOWN_OPTION_CHIP_BASE =
  'w-full rounded-md px-2 py-1 text-left text-[9px] font-semibold ring-1 transition-colors';
export const DROPDOWN_OPTION_CHIP_IDLE = `${DROPDOWN_OPTION_CHIP_BASE} bg-white/[0.04] text-gray-300 ring-white/[0.07] hover:bg-white/[0.08]`;
export const DROPDOWN_OPTION_CHIP_ACTIVE = `${DROPDOWN_OPTION_CHIP_BASE} bg-white/[0.16] text-white ring-white/[0.22]`;
export const DROPDOWN_OPTION_CHIP_DISABLED = `${DROPDOWN_OPTION_CHIP_BASE} cursor-not-allowed bg-white/[0.02] text-gray-600 ring-white/[0.05]`;

/** 设置页专用：保留旧实色边框触发器 */
export const DROPDOWN_TRIGGER_SETTINGS =
  'bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[10px] text-left flex items-center justify-between outline-none focus:border-blue-500 hover:bg-[#2e2e36] transition-colors min-w-[5rem]';

/** 设置页专用：旧列表表面 */
export const DROPDOWN_LIST_SETTINGS = 'border border-[#2e2e32] bg-[#0f0f0f] shadow-xl';

type DropdownTone = 'compose' | 'settings';

type CustomDropdownProps = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  triggerClassName?: string;
  /**
   * `compose`（默认）：全局输入框族视觉。
   * `settings`：设置页旧实色边框 / 蓝底选中（仅设置页使用）。
   */
  tone?: DropdownTone;
  /** 自定义触发区（如头像）；提供时不再渲染默认「标签 + ▼」 */
  renderTrigger?: (ctx: { open: boolean }) => React.ReactNode;
  /**
   * 下拉列表项自定义内容（如色块预览）。
   * 提供时列表按钮会以 `aria-label={opt.title ?? opt.label}` 保持可读性。
   */
  renderListItem?: (opt: Option) => React.ReactNode;
  /** 触发按钮 aria-label（自定义触发器时常用） */
  triggerAriaLabel?: string;
  /**
   * Portal 遮罩与列表的 z-index（内联样式，避免低于宿主弹窗时被挡住）。
   * 默认 1002 / 1003；嵌在 z-[2100] 等弹窗内时请传入更大值，例如 { backdrop: 2200, list: 2201 }。
   */
  portalZIndex?: { backdrop: number; list: number };
  /**
   * `compact`：列表宽度贴触发器、去掉过宽 `minWidth`，行内边距收紧（适合色块预览菜单）。
   */
  listDensity?: 'default' | 'compact';
  /** 下拉列表最小宽度（px）；窄触发器但需展示长文案时使用 */
  listMinWidth?: number;
  /** 覆盖列表容器 `border`/`background` 等（不传则按 tone 默认） */
  listClassName?: string;
};

function defaultTriggerClass(tone: DropdownTone): string {
  return tone === 'settings' ? DROPDOWN_TRIGGER_SETTINGS : DROPDOWN_TRIGGER_DEFAULT;
}

function defaultListSurface(tone: DropdownTone): string {
  return tone === 'settings' ? DROPDOWN_LIST_SETTINGS : DROPDOWN_LIST_SURFACE;
}

function composeOptionChipClass(selected: boolean, disabled: boolean | undefined): string {
  if (disabled) return DROPDOWN_OPTION_CHIP_DISABLED;
  return selected ? DROPDOWN_OPTION_CHIP_ACTIVE : DROPDOWN_OPTION_CHIP_IDLE;
}

function settingsItemClass(selected: boolean, disabled: boolean | undefined): string {
  if (disabled) return 'text-gray-600 cursor-not-allowed opacity-60';
  if (selected) return 'bg-[#264670] text-blue-300';
  return 'text-white hover:bg-[#2e2e36]';
}

/** 深色主题下拉组件：触发器 + Portal 到 body 的列表与遮罩，规范见 .cursor/rules/dropdown-ui-style.mdc */
export function CustomDropdown({
  options,
  value,
  onChange,
  disabled = false,
  placeholder = '默认',
  tone = 'compose',
  triggerClassName,
  renderTrigger,
  renderListItem,
  triggerAriaLabel,
  portalZIndex = { backdrop: 1002, list: 1003 },
  listDensity = 'default',
  listMinWidth,
  listClassName,
}: CustomDropdownProps) {
  const [open, setOpen] = useState(false);
  const [listPosition, setListPosition] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const resolvedTriggerClass = triggerClassName ?? defaultTriggerClass(tone);

  useLayoutEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const GAP = 4;
    const MARGIN = 8;
    const MAX_LIST = 224;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const width =
      listMinWidth != null
        ? Math.max(Math.round(rect.width), listMinWidth)
        : listDensity === 'compact'
          ? Math.max(Math.round(rect.width), 44)
          : Math.max(rect.width, 96);
    let left = rect.left;
    if (left + width > vw - MARGIN) left = Math.max(MARGIN, vw - width - MARGIN);
    if (left < MARGIN) left = MARGIN;

    const spaceBelow = vh - rect.bottom - GAP - MARGIN;
    const spaceAbove = rect.top - GAP - MARGIN;
    let top: number | undefined;
    let bottom: number | undefined;
    let maxHeight: number;

    const openDown = spaceBelow >= spaceAbove && spaceBelow >= 80;
    if (openDown) {
      top = rect.bottom + GAP;
      maxHeight = Math.min(MAX_LIST, spaceBelow);
    } else if (spaceAbove >= 80) {
      maxHeight = Math.min(MAX_LIST, spaceAbove);
      // 向上展开时用 bottom 锚点，避免因为 maxHeight 过大导致菜单“飞走”
      bottom = vh - rect.top + GAP;
    } else {
      top = rect.bottom + GAP;
      maxHeight = Math.max(80, Math.min(MAX_LIST, spaceBelow));
    }

    if (top != null) {
      if (top + maxHeight > vh - MARGIN) {
        maxHeight = Math.max(80, vh - MARGIN - top);
      }
      if (top < MARGIN) {
        top = MARGIN;
        maxHeight = Math.min(maxHeight, vh - MARGIN - top);
      }
    }

    setListPosition({ top, bottom, left, width, maxHeight });
  }, [open, options.length, listDensity, listMinWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onScroll = (e: Event) => {
      const targetNode = e.target as Node | null;
      if (!targetNode) return;
      if (triggerRef.current?.contains(targetNode)) return;
      if (listRef.current?.contains(targetNode)) return;
      if (
        targetNode instanceof Element &&
        targetNode.closest('[data-ac-dropdown-overlay], [data-ac-dropdown-list]')
      ) {
        return;
      }
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 大图预览等在 document 捕获阶段会关层；此处若 stopPropagation，部分环境下会阻断后续逻辑。
        if (typeof document !== 'undefined' && document.querySelector('[data-ac-block-workflow-marquee]')) {
          close();
          return;
        }
        e.stopPropagation();
        close();
      }
    };
    const onWheelCapture = (e: WheelEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const list = listRef.current;
      const overList =
        (list && list.contains(target)) ||
        (target instanceof Element && Boolean(target.closest('[data-ac-dropdown-list]')));
      if (overList && list) {
        // 大图/3D 等全局 wheel 捕获会抢走原生滚动；列表内改为手动 scrollTop
        e.preventDefault();
        e.stopPropagation();
        if (list.scrollHeight > list.clientHeight + 1) {
          list.scrollTop += e.deltaY;
        }
        return;
      }
      if (target instanceof Element && target.closest('[data-ac-dropdown-overlay]')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onWheelCapture, { capture: true, passive: false });
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onWheelCapture, true);
    };
  }, [open]);

  const label = value ? options.find((o) => o.value === value)?.label ?? value : placeholder;

  const listSurfaceClass = listClassName ?? defaultListSurface(tone);
  const isCompose = tone === 'compose';
  /** compose：与快捷栏模型弹层同款内边距 + 纵向 gap；settings / compact 保持紧凑扁平 */
  const listLayoutClass = isCompose
    ? listDensity === 'compact'
      ? 'flex flex-col gap-0.5 p-1'
      : 'flex flex-col gap-1 p-1.5'
    : listDensity === 'compact'
      ? 'py-0.5'
      : 'py-1';
  const settingsItemPad = listDensity === 'compact' ? 'px-2 py-1.5' : 'px-3 py-2';
  const listItemWrapClass = listMinWidth != null ? 'whitespace-nowrap' : '';

  const portalContent =
    open && typeof document !== 'undefined' ? (
      <>
        <div
          className="fixed inset-0"
          style={{ zIndex: portalZIndex.backdrop }}
          aria-hidden
          data-prevent-wheel-scroll
          data-ac-dropdown-overlay
          onClick={() => setOpen(false)}
        />
        {listPosition && (
          <ul
            ref={listRef}
            className={`fixed overflow-y-auto rounded-xl text-white ${listLayoutClass} ${listSurfaceClass}`}
            data-prevent-wheel-scroll
            data-ac-dropdown-list
            style={{
              top: listPosition.top,
              bottom: listPosition.bottom,
              left: listPosition.left,
              width: listPosition.width,
              ...(listDensity === 'compact' ? {} : { minWidth: '6rem' }),
              maxHeight: listPosition.maxHeight,
              zIndex: portalZIndex.list,
            }}
          >
            {options.map((opt) => {
              const selected = value === opt.value;
              const itemClass = isCompose
                ? `${composeOptionChipClass(selected, opt.disabled)} ${listItemWrapClass} ${
                    renderListItem ? 'flex items-center justify-center' : ''
                  }`
                : `w-full ${listItemWrapClass} ${settingsItemPad} text-[10px] transition-colors ${
                    renderListItem ? 'flex items-center justify-center' : 'text-left'
                  } ${settingsItemClass(selected, opt.disabled)}`;
              return (
                <li key={opt.value === '' ? '__empty__' : opt.value}>
                  <button
                    type="button"
                    disabled={opt.disabled}
                    title={opt.title}
                    aria-label={opt.title ?? opt.label}
                    onClick={() => {
                      if (opt.disabled) return;
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={itemClass}
                  >
                    {renderListItem ? renderListItem(opt) : opt.label}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </>
    ) : null;

  return (
    <div className="relative inline-flex items-center" ref={triggerRef}>
      <button
        type="button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        onClick={() => !disabled && setOpen((p) => !p)}
        className={`${resolvedTriggerClass} ${disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}`}
      >
        {renderTrigger ? (
          renderTrigger({ open })
        ) : (
          <>
            <span>{label}</span>
            <span className="text-gray-500 shrink-0 ml-1">{open ? '▲' : '▼'}</span>
          </>
        )}
      </button>
      {portalContent && typeof document !== 'undefined' ? createPortal(portalContent, document.body) : null}
    </div>
  );
}
