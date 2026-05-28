/** 分镜表面板内 DOM id，供大纲点击滚动定位 */
export function storyboardRowDomId(rowId: string): string {
  return `ac-storyboard-row-${rowId}`;
}

export function storyboardCompositeDomId(rowId: string): string {
  return `ac-storyboard-composite-${rowId}`;
}
