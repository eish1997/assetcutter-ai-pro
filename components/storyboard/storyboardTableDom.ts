/** 分镜表面板内 DOM id，供大纲点击滚动定位 */
export function storyboardRowDomId(rowId: string): string {
  return `ac-storyboard-row-${rowId}`;
}

export function storyboardCompositeDomId(rowId: string): string {
  return `ac-storyboard-composite-${rowId}`;
}

export function storyboardGroupCompositeDomId(groupId: string): string {
  return `ac-storyboard-group-${groupId}`;
}

export function storyboardInputRowDomId(rowId: string): string {
  return `ac-storyboard-input-${rowId}`;
}
