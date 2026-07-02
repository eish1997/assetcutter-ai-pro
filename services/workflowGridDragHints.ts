/** 工作流网格卡片拖放意图：插入排序 vs 叠放成组（横版网格：左右插入、中间成组） */

export type WorkflowCardDropIntent = 'group' | 'insert-before' | 'insert-after';

/** 左右缘「插入」带：约占卡片宽度 12%，可略盖住相邻缝隙 */
export const WORKFLOW_CARD_INSERT_EDGE_RATIO = 0.12;
/** 中间「成组」区域：去掉四边 insert 带后的中心矩形 */
export const WORKFLOW_CARD_GROUP_INSET_RATIO = 0.22;

export function resolveWorkflowCardDropIntent(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  opts: { allowGroup?: boolean } = {}
): WorkflowCardDropIntent {
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const relX = (clientX - rect.left) / w;
  const relY = (clientY - rect.top) / h;

  if (relX < WORKFLOW_CARD_INSERT_EDGE_RATIO) {
    return 'insert-before';
  }
  if (relX > 1 - WORKFLOW_CARD_INSERT_EDGE_RATIO) {
    return 'insert-after';
  }

  const inCenterX =
    relX > WORKFLOW_CARD_GROUP_INSET_RATIO && relX < 1 - WORKFLOW_CARD_GROUP_INSET_RATIO;
  const inCenterY =
    relY > WORKFLOW_CARD_GROUP_INSET_RATIO && relY < 1 - WORKFLOW_CARD_GROUP_INSET_RATIO;

  if (opts.allowGroup !== false && inCenterX && inCenterY) {
    return 'group';
  }

  return relX < 0.5 ? 'insert-before' : 'insert-after';
}
