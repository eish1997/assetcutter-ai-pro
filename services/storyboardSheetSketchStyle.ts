/** 分镜拼图预览/导出：白底 + 手写字体，模拟手绘分镜表 */

export const STORYBOARD_SHEET_SKETCH_BG = '#ffffff';
export const STORYBOARD_SHEET_SKETCH_PLACEHOLDER_BG = '#f3f3f5';
export const STORYBOARD_SHEET_SKETCH_BORDER = '#000000';
export const STORYBOARD_SHEET_SKETCH_BORDER_WIDTH = 1.5;
export const STORYBOARD_SHEET_SKETCH_TEXT_HEADER = 'rgba(35,35,42,0.88)';
export const STORYBOARD_SHEET_SKETCH_TEXT_BODY = 'rgba(18,18,22,0.92)';
export const STORYBOARD_SHEET_SKETCH_TEXT_DIALOGUE = 'rgba(55,55,62,0.82)';
export const STORYBOARD_SHEET_SKETCH_TEXT_MUTED = 'rgba(100,100,108,0.75)';

export const STORYBOARD_SHEET_SKETCH_FONT_STACK =
  '"Ma Shan Zheng", "KaiTi", "STKaiti", "FangSong", "Segoe Print", "Bradley Hand", cursive';

/** 镜号/时长顶栏：黑体，与正文手写字体区分 */
export const STORYBOARD_SHEET_HEADER_FONT_STACK =
  '"SimHei", "Heiti SC", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

const SKETCH_FONT_LINK_ID = 'storyboard-sheet-sketch-font';

let sketchFontLoadPromise: Promise<void> | null = null;

export function storyboardSheetCanvasFont(weight: 400 | 500 | 600, sizePx: number): string {
  return `${weight} ${sizePx}px ${STORYBOARD_SHEET_SKETCH_FONT_STACK}`;
}

export function storyboardSheetCanvasHeaderFont(sizePx: number): string {
  return `700 ${sizePx}px ${STORYBOARD_SHEET_HEADER_FONT_STACK}`;
}

/** Canvas 绘制前加载手写字体（Google Fonts，失败则回退 KaiTi 等系统字体） */
export function ensureStoryboardSheetSketchFontLoaded(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (sketchFontLoadPromise) return sketchFontLoadPromise;

  sketchFontLoadPromise = (async () => {
    if (!document.getElementById(SKETCH_FONT_LINK_ID)) {
      const link = document.createElement('link');
      link.id = SKETCH_FONT_LINK_ID;
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&display=swap';
      document.head.appendChild(link);
    }
    if (document.fonts?.load) {
      try {
        await Promise.all([
          document.fonts.load(`400 16px ${STORYBOARD_SHEET_SKETCH_FONT_STACK}`),
          document.fonts.load(`500 16px ${STORYBOARD_SHEET_SKETCH_FONT_STACK}`),
        ]);
      } catch {
        /* 系统回退字体 */
      }
    }
  })();

  return sketchFontLoadPromise;
}

export function storyboardSheetFooterGap(canvasWidth?: number): number {
  const root = canvasWidth && canvasWidth > 0 ? canvasWidth : 960;
  return Math.max(1, Math.round((root / 960) * 2));
}

export function measureSheetCellFooterTextHeight(
  headerBlockH: number,
  footerBlockH: number,
  imageH: number,
  gap: number
): number {
  return headerBlockH + imageH + gap + footerBlockH;
}

export const storyboardSheetSketchDomStyle = {
  fontFamily: STORYBOARD_SHEET_SKETCH_FONT_STACK,
  backgroundColor: STORYBOARD_SHEET_SKETCH_BG,
  color: STORYBOARD_SHEET_SKETCH_TEXT_BODY,
} as const;

export const storyboardSheetHeaderDomStyle = {
  fontFamily: STORYBOARD_SHEET_HEADER_FONT_STACK,
  fontWeight: 700,
} as const;
