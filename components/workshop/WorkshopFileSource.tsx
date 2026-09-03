import React, { useCallback, useEffect, useState } from 'react';
import {
  hasWorkbenchFileSourceApi as workshopHasFileSourceApi,
  isWorkshopBrowserLibraryRoot,
  isWorkshopPinnedTreeRoot,
  isWorkshopRecycleRoot,
  parentRel,
  workshopBrowserLibraryRoot,
  workshopRecycleLibraryRoot,
  workshopFileSourceApi,
  type WorkshopDirEntry,
  type WorkshopRootInfo,
} from '../../services/workshopFileTree';
import {
  WorkshopFolderContextMenu,
  type WorkshopFolderMenuTarget,
} from './WorkshopFolderContextMenu';
import { getWorkshopEntryClip, setWorkshopEntryClip, subscribeWorkshopEntryClip } from '../../services/workshopEntryClipboard';

/** Keep a local export: Electron/Vite HMR can still import this name from this file. */
export function hasWorkbenchFileSourceApi(): boolean {
  return workshopHasFileSourceApi();
}

function FolderMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className || 'h-3.5 w-3.5'} fill="none" aria-hidden>
      <path
        d="M2.2 4.2h4.1l1.1 1.2H13.8v7.3H2.2V4.2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function treeKey(root: string, rel: string): string {
  return `${root}\n${rel}`;
}

export function WorkshopFileTreeColumn(props: {
  roots: WorkshopRootInfo[];
  activeRoot: string;
  currentRel: string;
  workspaceDir?: string;
  flatten: boolean;
  onToggleFlatten: () => void;
  onSelectFolder: (root: string, rel: string) => void;
  onAddFolder: () => void;
  onRemoveRoot: (root: string) => void;
  onTreeMutated: () => void;
}): React.ReactElement {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [childrenByKey, setChildrenByKey] = useState<Record<string, WorkshopDirEntry[]>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; target: WorkshopFolderMenuTarget } | null>(null);
  const [clip, setClip] = useState(getWorkshopEntryClip);
  useEffect(() => subscribeWorkshopEntryClip(() => setClip(getWorkshopEntryClip())), []);

  const loadChildren = useCallback(async (root: string, rel: string) => {
    const api = workshopFileSourceApi();
    if (!api?.listWorkshopDir) return;
    const key = treeKey(root, rel);
    const out = await api.listWorkshopDir({ root, rel });
    if (!out.ok || !Array.isArray(out.entries)) return;
    setChildrenByKey((prev) => ({
      ...prev,
      [key]: out.entries.filter((e) => e.kind === 'dir' && !e.isPackage),
    }));
  }, []);

  useEffect(() => {
    for (const item of props.roots) {
      const key = treeKey(item.root, '');
      if (!expanded.has(key)) continue;
      void loadChildren(item.root, '');
    }
  }, [props.roots, expanded, loadChildren]);

  const onTreeMutated = props.onTreeMutated;
  const refreshParent = useCallback(
    (root: string, rel: string) => {
      void loadChildren(root, rel);
      void loadChildren(root, parentRel(rel));
      onTreeMutated();
    },
    [loadChildren, onTreeMutated],
  );

  const openMenu = (event: React.MouseEvent, target: WorkshopFolderMenuTarget) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, target });
  };

  const menuRel = menu?.target.kind === 'root' ? '' : menu?.target.rel || '';
  const menuRoot = menu?.target.root || '';

  const copyAbsPath = async () => {
    const api = workshopFileSourceApi();
    const hit = await api?.resolveWorkshopAbs?.({ root: menuRoot, rel: menuRel });
    if (!hit?.ok || !hit.abs) return;
    try {
      await navigator.clipboard.writeText(hit.abs);
    } catch {
      /* ignore */
    }
  };

  const toggle = (root: string, rel: string) => {
    const key = treeKey(root, rel);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!childrenByKey[key]) void loadChildren(root, rel);
  };

  const renderDirs = (root: string, rel: string, depth: number): React.ReactNode => {
    const dirs = childrenByKey[treeKey(root, rel)] || [];
    return dirs.map((dir) => {
      const open = expanded.has(treeKey(root, dir.rel));
      const on = props.activeRoot === root && props.currentRel === dir.rel;
      return (
        <div key={`${root}:${dir.rel}`}>
          <div className="flex h-6 min-w-0 items-center" style={{ paddingLeft: `${8 + depth * 12}px` }}>
            <button
              type="button"
              className="flex h-6 w-4 shrink-0 items-center justify-center text-[9px] text-white/35 hover:text-white/80"
              onClick={() => toggle(root, dir.rel)}
              aria-label={open ? '折叠' : '展开'}
            >
              {open ? '▾' : '▸'}
            </button>
            <button
              type="button"
              title={dir.name}
              onClick={() => props.onSelectFolder(root, dir.rel)}
              onContextMenu={(e) => openMenu(e, { kind: 'dir', root, rel: dir.rel, name: dir.name })}
              className={`flex min-w-0 flex-1 items-center gap-1.5 truncate rounded px-1 text-left text-[11px] leading-none ${
                on ? 'bg-white/[0.1] text-white' : 'text-white/70 hover:bg-white/[0.05] hover:text-white'
              }`}
            >
              <FolderMark className="h-3 w-3 shrink-0 text-white/45" />
              <span className="min-w-0 truncate">{dir.name}</span>
            </button>
          </div>
          {open ? renderDirs(root, dir.rel, depth + 1) : null}
        </div>
      );
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-r border-white/[0.06] bg-[#0c0c0e]" data-workshop-file-tree>
      <div className="flex h-8 shrink-0 items-center justify-between px-2">
        <span className="text-[10px] font-medium tracking-wide text-white/45">文件夹</span>
        <button
          type="button"
          title="挂上素材文件夹（文件仍在原地）"
          onClick={props.onAddFolder}
          className="flex h-6 w-6 items-center justify-center rounded text-[16px] leading-none text-white/70 hover:bg-white/[0.08] hover:text-white"
        >
          +
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2 no-scrollbar">
        {[
          workshopBrowserLibraryRoot(),
          ...(String(props.workspaceDir || '').trim() ? [workshopRecycleLibraryRoot()] : []),
          ...props.roots,
        ].map((item) => {
            const browser = isWorkshopBrowserLibraryRoot(item.root);
            const recycle = isWorkshopRecycleRoot(item.root);
            const pinned = isWorkshopPinnedTreeRoot(item.root);
            const open = !browser && expanded.has(treeKey(item.root, ''));
            const on = props.activeRoot === item.root && !props.currentRel;
            return (
              <div key={item.root}>
                <div className="flex h-7 min-w-0 items-center px-1">
                  {browser ? (
                    <span className="w-4 shrink-0" aria-hidden />
                  ) : (
                    <button
                      type="button"
                      className="flex h-6 w-4 shrink-0 items-center justify-center text-[9px] text-white/35 hover:text-white/80"
                      onClick={() => toggle(item.root, '')}
                    >
                      {open ? '▾' : '▸'}
                    </button>
                  )}
                  <button
                    type="button"
                    title={
                      browser
                        ? '存在浏览器里的资产'
                        : recycle
                          ? '已删除的素材，7 天后从库里清除'
                          : item.root
                    }
                    onClick={() => props.onSelectFolder(item.root, '')}
                    onContextMenu={(e) => {
                      if (pinned) return;
                      openMenu(e, { kind: 'root', root: item.root, label: item.label });
                    }}
                    className={`flex min-w-0 flex-1 items-center gap-1.5 truncate rounded px-1 text-left text-[11px] ${
                      on ? 'bg-white/[0.1] text-white' : 'text-white/80 hover:bg-white/[0.05]'
                    }`}
                  >
                    <FolderMark
                      className={`h-3.5 w-3.5 shrink-0 ${
                        browser
                          ? 'text-violet-300/85'
                          : recycle
                            ? 'text-amber-300/80'
                            : 'text-sky-300/80'
                      }`}
                    />
                    <span className="min-w-0 truncate">{item.label}</span>
                  </button>
                </div>
                {open ? renderDirs(item.root, '', 1) : null}
              </div>
            );
          })}
      </div>
      <WorkshopFolderContextMenu
        open={Boolean(menu)}
        x={menu?.x || 0}
        y={menu?.y || 0}
        target={menu?.target || null}
        flatten={props.flatten}
        canPaste={Boolean(clip && menu && clip.root === menu.target.root)}
        onClose={() => setMenu(null)}
        onReveal={() => {
          void workshopFileSourceApi()?.revealWorkshopPath?.({ root: menuRoot, rel: menuRel });
        }}
        onCopyPath={() => {
          void copyAbsPath();
        }}
        onRemoveRoot={
          menu?.target.kind === 'root' ? () => props.onRemoveRoot(menu.target.root) : undefined
        }
        onMkdir={
          menu?.target.kind === 'dir'
            ? () => {
                const name = window.prompt('新文件夹名称', '组');
                if (!name?.trim()) return;
                void workshopFileSourceApi()
                  ?.mkdirWorkshopDir?.({ root: menuRoot, parentRel: menuRel, name: name.trim() })
                  .then(() => refreshParent(menuRoot, menuRel));
              }
            : undefined
        }
        onRename={
          menu?.target.kind === 'dir'
            ? () => {
                const name = window.prompt('重命名', menu.target.kind === 'dir' ? menu.target.name : '');
                if (!name?.trim()) return;
                void workshopFileSourceApi()
                  ?.renameWorkshopEntry?.({ root: menuRoot, rel: menuRel, name: name.trim() })
                  .then(() => refreshParent(menuRoot, menuRel));
              }
            : undefined
        }
        onTrash={
          menu?.target.kind === 'dir'
            ? () => {
                void workshopFileSourceApi()
                  ?.trashWorkshopEntries?.({ root: menuRoot, rel: menuRel })
                  .then(() => refreshParent(menuRoot, menuRel));
              }
            : undefined
        }
        onCut={
          menu?.target.kind === 'dir'
            ? () => setWorkshopEntryClip({ root: menuRoot, rels: [menuRel], mode: 'cut' })
            : undefined
        }
        onCopy={
          menu?.target.kind === 'dir'
            ? () => setWorkshopEntryClip({ root: menuRoot, rels: [menuRel], mode: 'copy' })
            : undefined
        }
        onPaste={
          clip && menu && clip.root === menu.target.root
            ? () => {
                const destRel = menuRel;
                const api = workshopFileSourceApi();
                const done = () => {
                  if (clip.mode === 'cut') setWorkshopEntryClip(null);
                  refreshParent(menuRoot, destRel);
                };
                if (clip.mode === 'cut') {
                  void api?.moveWorkshopEntries?.({ root: clip.root, destRel, rels: clip.rels }).then(done);
                } else {
                  void api?.copyWorkshopEntries?.({ root: clip.root, destRel, rels: clip.rels }).then(done);
                }
              }
            : undefined
        }
        onToggleFlatten={props.onToggleFlatten}
      />
    </div>
  );
}
