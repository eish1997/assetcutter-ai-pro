import type { AppMode } from '../types';

export type KeyboardShortcutEntry = {
  keys: string;
  description: string;
};

export type KeyboardShortcutsSection = {
  title: string;
  items: KeyboardShortcutEntry[];
};

export type KeyboardShortcutsPageId =
  | 'global'
  | 'workflow-project-list'
  | 'workflow-canvas'
  | 'workflow-lightbox'
  | 'workflow-lightbox-annotate'
  | 'settings'
  | 'seam-repair'
  | 'pbr-texture'
  | 'arena';

export type KeyboardShortcutsPage = {
  id: KeyboardShortcutsPageId;
  title: string;
  sections: KeyboardShortcutsSection[];
};

const GLOBAL_SHORTCUTS: KeyboardShortcutsSection = {
  title: '全局',
  items: [
    { keys: 'B', description: '打开 / 关闭快捷键说明' },
    { keys: 'Shift + B', description: '打开 / 关闭快捷键说明（大图标注模式下亦可用）' },
    { keys: 'C', description: '打开 / 关闭全局日志' },
    { keys: 'Esc', description: '关闭当前弹窗 / 大图预览' },
  ],
};

const WORKFLOW_CANVAS: KeyboardShortcutsSection = {
  title: '工作区画布',
  items: [
    { keys: 'Space（按住）', description: '进入框选模式，拖动框选资产' },
    { keys: 'Alt + 拖动', description: '框选时从当前选择中减选' },
    { keys: 'Q / E', description: '鼠标悬停资产卡片时，切换上一张 / 下一张预览' },
    { keys: 'W（按住）', description: '鼠标悬停资产卡片时，居中放大卡片' },
    { keys: '1 / 2', description: '切换画卷分档：能力+功能 / 功能+工作区' },
    { keys: '0', description: '切换到最左档（同 1）' },
  ],
};

const WORKFLOW_LIGHTBOX: KeyboardShortcutsSection = {
  title: '大图预览',
  items: [
    { keys: 'Esc', description: '关闭大图' },
    { keys: 'Tab', description: '隐藏 / 显示界面控件' },
    { keys: 'Q', description: '切换预览模式（平面图 / 全景 / 3D 等）' },
    { keys: 'W', description: '切换画布平移' },
    { keys: 'R（按住）', description: '旋转视图' },
    { keys: 'Z / X', description: '放大 / 缩小' },
    { keys: '1 – 4', description: '切换预览背景' },
  ],
};

const WORKFLOW_LIGHTBOX_ANNOTATE: KeyboardShortcutsSection = {
  title: '大图标注',
  items: [
    { keys: 'B', description: '画笔工具' },
    { keys: 'C', description: '裁切工具（沿用上次裁切方式）' },
    { keys: 'A', description: '局部重绘选区（沿用上次选区形状）' },
    { keys: 'S', description: '分割 / SAM 点选' },
    { keys: 'Ctrl + Z', description: '撤销标注' },
    { keys: 'Ctrl + Shift + Z', description: '重做标注' },
  ],
};

const PAGE_SECTIONS: Record<KeyboardShortcutsPageId, KeyboardShortcutsSection[]> = {
  global: [],
  'workflow-project-list': [],
  'workflow-canvas': [WORKFLOW_CANVAS],
  'workflow-lightbox': [WORKFLOW_LIGHTBOX],
  'workflow-lightbox-annotate': [WORKFLOW_LIGHTBOX, WORKFLOW_LIGHTBOX_ANNOTATE],
  settings: [],
  'seam-repair': [],
  'pbr-texture': [],
  arena: [],
};

const PAGE_TITLES: Record<KeyboardShortcutsPageId, string> = {
  global: 'AssetCutter',
  'workflow-project-list': '项目列表',
  'workflow-canvas': '工作区',
  'workflow-lightbox': '大图预览',
  'workflow-lightbox-annotate': '大图预览 · 标注',
  settings: '设置',
  'seam-repair': '贴图修缝',
  'pbr-texture': '生成贴图',
  arena: '提示词擂台',
};

export function resolveKeyboardShortcutsPage(
  args: {
    mode: AppMode;
    activeWorkspaceProjectId: string | null;
  },
  opts?: { lightboxOpen?: boolean; lightboxRaster?: boolean }
): KeyboardShortcutsPageId {
  const lightboxRaster =
    opts?.lightboxRaster ??
    (typeof document !== 'undefined' &&
      document.documentElement.hasAttribute('data-ac-lightbox-raster-shortcuts'));
  const lightboxOpen =
    opts?.lightboxOpen ??
    (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-ac-lightbox-open'));
  if (lightboxRaster) return 'workflow-lightbox-annotate';
  if (lightboxOpen) return 'workflow-lightbox';
  if (args.mode === 'WORKFLOW') {
    return args.activeWorkspaceProjectId ? 'workflow-canvas' : 'workflow-project-list';
  }
  const modeMap: Partial<Record<AppMode, KeyboardShortcutsPageId>> = {
    SETTINGS: 'settings',
    SEAM_REPAIR: 'seam-repair',
    PBR_TEXTURE: 'pbr-texture',
    ARENA: 'arena',
  };
  return modeMap[args.mode] ?? 'global';
}

export function getKeyboardShortcutsPage(pageId: KeyboardShortcutsPageId): KeyboardShortcutsPage {
  const pageSections = PAGE_SECTIONS[pageId] ?? [];
  const globalItems =
    pageId === 'workflow-lightbox-annotate'
      ? [
          { keys: 'Shift + B', description: '打开 / 关闭快捷键说明（B 为画笔）' },
          { keys: 'Esc', description: '关闭当前弹窗 / 大图预览' },
        ]
      : [...GLOBAL_SHORTCUTS.items];
  return {
    id: pageId,
    title: PAGE_TITLES[pageId] ?? 'AssetCutter',
    sections: [{ title: GLOBAL_SHORTCUTS.title, items: globalItems }, ...pageSections],
  };
}
