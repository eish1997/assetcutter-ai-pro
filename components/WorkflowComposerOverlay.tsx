import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CapabilitySetCanvas from './CapabilitySetCanvas';
import type { CustomAppModule } from '../types';
import type { CapabilitySet } from '../types';
import type { CapabilityAssetCandidate } from './CapabilitySetCanvas';
import AppIcon from './ui/AppIcon';
import { getWorkflowDockChipFixedStyle } from './floatingDockConstants';

export type WorkflowComposerOverlayProps = {
  open: boolean;
  onClose: () => void;
  /** 切换打开内容时重置画布 */
  sessionKey: number;
  presets: CustomAppModule[];
  initialSet: CapabilitySet | null;
  onSave: (set: CapabilitySet) => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  getPartialTestInputImage?: () => string | null;
  assetCandidates?: CapabilityAssetCandidate[];
  /** 多会话时仅一个为前台：全屏编辑；其余强制最小化仅显示 Dock条 */
  isForeground?: boolean;
  /** 右侧 Dock 竖向堆叠序号（0 为最上），与飞入动画落点一致 */
  dockStackIndex?: number;
  /** 当前纵向堆叠条数（含将落位的会话），用于相对 50vh 居中 */
  dockStackCount?: number;
  /** 点击最小化条时由父级将本会话切为前台 */
  onRequestForeground?: () => void;
  /** Dock 是否处于最小化（供父级计算堆叠） */
  onMinimizedChange?: (minimized: boolean) => void;
  /** 工作区当前项目 id（可选），画布运行测试提交 host_bundle 时带给本机伴侣 */
  companionProjectId?: string | null;
  /** 与设置页文字模型一致，能力集合断点测试用 */
  textModelRegistryId?: string | null;
  /** 平台积分余额（试运行预估） */
  creditBalance?: number | null;
};

function isEscapeKey(e: KeyboardEvent): boolean {
  return e.key === 'Escape' || e.code === 'Escape' || (e as KeyboardEvent & { keyCode?: number }).keyCode === 27;
}

/** 大图预览等全屏层挂载 `data-ac-esc-sink`，工作流 Esc 应让路，避免抢在顶层预览之前 */
function shouldYieldEscapeToEscSink(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('[data-ac-esc-sink]') != null;
}

type ComposerDock = 'fullscreen' | 'collapsing' | 'minimized' | 'expanding';

/**
 * 全屏「工作流创建」：内嵌能力集合画布。
 * 右上角为「收起」：收缩动画至右下角后变为悬浮条；点击条可再打开；Esc 不在最小化时全局展开（避免主界面误触）。
 * 多会话：仅 `isForeground` 为 true 的实例可全屏编辑，其余强制最小化；Dock 在右侧相对视口垂直居中堆叠。
 */
export default function WorkflowComposerOverlay({
  open,
  onClose,
  sessionKey,
  presets,
  initialSet,
  onSave,
  onLog,
  getPartialTestInputImage,
  assetCandidates = [],
  isForeground = true,
  dockStackIndex = 0,
  dockStackCount = 1,
  onRequestForeground,
  onMinimizedChange,
  companionProjectId = null,
  textModelRegistryId = null,
  creditBalance = null,
}: WorkflowComposerOverlayProps) {
  const [setLabel, setSetLabel] = useState(initialSet?.label ?? '新建工作流');
  const [dock, setDock] = useState<ComposerDock>('fullscreen');
  const shellRef = useRef<HTMLDivElement | null>(null);
  const onMinimizedChangeRef = useRef(onMinimizedChange);
  const prevIsForegroundRef = useRef<boolean | null>(null);
  useEffect(() => {
    onMinimizedChangeRef.current = onMinimizedChange;
  }, [onMinimizedChange]);

  useEffect(() => {
    if (!open) return;
    setSetLabel(initialSet?.label ?? '新建工作流');
  }, [open, initialSet, sessionKey]);

  useEffect(() => {
    if (!open) {
      setDock('fullscreen');
    }
  }, [open]);

  /** 失焦会话：立即最小化（不抢前台动画） */
  useEffect(() => {
    if (!open) return;
    if (isForeground === false) {
      setDock((d) => {
        if (d === 'fullscreen' || d === 'expanding') return 'minimized';
        return d;
      });
    }
  }, [open, isForeground]);

  /** 从后台切回前台且当前为最小化时才展开（用户主动收起后 isForeground 一直为 true，不得自动再展开） */
  useEffect(() => {
    if (!open) return;
    const prev = prevIsForegroundRef.current;
    prevIsForegroundRef.current = isForeground;
    if (isForeground && prev === false && dock === 'minimized') {
      setDock('expanding');
    }
  }, [open, isForeground, dock]);

  useEffect(() => {
    if (!open) return;
    onMinimizedChangeRef.current?.(dock === 'minimized');
  }, [open, dock]);

  const handleSave = useCallback(
    (set: CapabilitySet) => {
      onSave(set);
      onClose();
    },
    [onSave, onClose]
  );

  const requestCollapse = useCallback(() => {
    setDock((d) => (d === 'fullscreen' ? 'collapsing' : d));
  }, []);

  const requestExpand = useCallback(() => {
    setDock('expanding');
  }, []);

  const onCanvasDockMotionComplete = useCallback((phase: 'collapsing' | 'expanding') => {
    if (phase === 'collapsing') setDock('minimized');
    else setDock('fullscreen');
  }, []);

  /** Esc：仅全屏/展开动画中可收起；最小化时不在全局抢 Esc（主界面按 Esc 勿误展开工作流） */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isEscapeKey(e)) return;
      if (shouldYieldEscapeToEscSink()) return;
      if (dock !== 'fullscreen' && dock !== 'expanding') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      requestCollapse();
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, dock, requestCollapse]);

  useLayoutEffect(() => {
    if (!open || dock !== 'fullscreen') return;
    shellRef.current?.focus({ preventScroll: true });
  }, [open, dock, sessionKey]);

  useEffect(() => {
    if (!open || dock === 'minimized') return;
    const block = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('contextmenu', block, true);
    return () => window.removeEventListener('contextmenu', block, true);
  }, [open, dock]);

  if (!open) return null;

  const showBackdrop = dock === 'fullscreen' || dock === 'collapsing' || dock === 'expanding';

  const panelMotionClass =
    dock === 'fullscreen'
      ? 'opacity-100 scale-100 [filter:none] transition-none'
      : dock === 'collapsing' || dock === 'expanding'
        ? 'opacity-100 scale-100 [filter:none] transition-none'
        : 'scale-[0.06] opacity-0 pointer-events-none [filter:none] transition-none';

  const panelChromeHidden = dock === 'collapsing' || dock === 'expanding';
  const canvasDockPhase = dock === 'collapsing' || dock === 'expanding' ? dock : 'idle';

  const content = (
    <>
      <div
        ref={shellRef}
        tabIndex={-1}
        role="dialog"
        aria-modal={dock !== 'minimized'}
        className={`fixed inset-0 z-[2100] outline-none ${dock === 'minimized' ? 'pointer-events-none' : ''}`}
        data-ac-block-workflow-marquee
        onKeyDownCapture={(e) => {
          if (!isEscapeKey(e)) return;
          if (shouldYieldEscapeToEscSink()) return;
          if (dock !== 'fullscreen' && dock !== 'expanding') return;
          e.preventDefault();
          e.stopPropagation();
          requestCollapse();
        }}
      >
        {showBackdrop ? (
          <button
            type="button"
            aria-label="收起工作流编辑"
            className={`ac-workflow-dock-backdrop absolute inset-0 bg-black/38 backdrop-blur-xl cursor-default border-0 p-0 ${
              dock === 'collapsing' ? 'ac-workflow-dock-backdrop--out' : ''
            } ${dock === 'expanding' ? 'ac-workflow-dock-backdrop--in' : ''}`}
            onClick={requestCollapse}
          />
        ) : null}
        <div
          className={`absolute inset-0 min-h-0 ${panelChromeHidden ? 'overflow-visible' : 'overflow-hidden'}`}
          onClick={(e) => e.stopPropagation()}
        >
        <div
          className={`absolute inset-0 min-h-0 ${panelChromeHidden ? 'overflow-visible' : 'overflow-hidden'} ${panelMotionClass}`}
          onClick={(e) => e.stopPropagation()}
          onContextMenuCapture={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div
            className={`relative h-full min-h-0 w-full ${panelChromeHidden ? 'overflow-visible' : 'overflow-hidden'}`}
            key={sessionKey}
          >
            <div
              className={`absolute right-4 top-4 z-[45] flex items-center gap-2 transition-opacity duration-200 ${
                dock === 'collapsing' ? 'opacity-0 pointer-events-none' : 'opacity-100'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                title="收起（可稍后从右下角继续）"
                onClick={requestCollapse}
                disabled={dock !== 'fullscreen'}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1a1a1e]/95 border border-[#2e2e32] text-white/90 hover:bg-[#2a2a32] hover:text-white disabled:cursor-wait disabled:opacity-50"
              >
                <AppIcon name="chevron-down" className="h-5 w-5" />
              </button>
            </div>
            <div className="absolute inset-0 min-h-0">
              <CapabilitySetCanvas
                presets={presets}
                initialSet={initialSet}
                setLabel={setLabel}
                onSetLabelChange={setSetLabel}
                onSave={handleSave}
                onClose={requestCollapse}
                layoutVariant="overlayGlass"
                dockMotionPhase={canvasDockPhase}
                onDockMotionComplete={onCanvasDockMotionComplete}
                dockFlyStackIndex={dockStackIndex}
                dockFlyStackCount={dockStackCount}
                onLog={onLog}
                getPartialTestInputImage={getPartialTestInputImage}
                assetCandidates={assetCandidates}
                companionProjectId={companionProjectId}
                textModelRegistryId={textModelRegistryId}
                creditBalance={creditBalance}
              />
            </div>
          </div>
        </div>
        </div>
      </div>

      {dock === 'minimized' ? (
        <div
          className="ac-workflow-dock-chip-in fixed flex h-12 max-w-[min(16rem,calc(100vw-3rem))] items-stretch overflow-hidden rounded-full border border-[#343438] bg-[#16161a] shadow-lg pointer-events-auto"
          style={getWorkflowDockChipFixedStyle(dockStackIndex, dockStackCount)}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            title={setLabel || '工作流'}
            onClick={() => {
              if (isForeground) {
                if (dock === 'minimized') requestExpand();
              } else {
                onRequestForeground?.();
              }
            }}
            className="flex min-w-0 flex-1 items-center gap-2 pl-3.5 pr-2 text-left text-gray-200 hover:bg-[#1f1f24] transition-colors"
          >
            <AppIcon name="package" className="h-5 w-5 shrink-0 text-blue-300/90" />
            <span className="truncate text-[10px] font-bold text-gray-100">{setLabel || '工作流'}</span>
          </button>
          <button
            type="button"
            title="结束并关闭"
            onClick={onClose}
            className="flex w-11 shrink-0 items-center justify-center text-white/50 hover:bg-red-950/60 hover:text-red-200 transition-colors"
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
}
