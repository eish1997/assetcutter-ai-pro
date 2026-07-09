/** 轻量镜号格式化，避免 feedback 模块 import 整颗 storyboardTableAsset */

export function formatStoryboardShotNo(index: number): string {
  const n = String(Math.max(0, index) + 1);
  return /^\d+$/.test(n) ? n.padStart(3, '0') : n;
}
