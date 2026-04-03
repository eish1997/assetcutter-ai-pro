/** 云端 hydrate 前预览图为空时避免 img 的 src 为空字符串 */
export const WORKFLOW_IMG_EMPTY_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function workflowSafeImgSrc(s: string | undefined | null): string {
  if (typeof s !== 'string' || s.trim() === '') return WORKFLOW_IMG_EMPTY_PLACEHOLDER;
  return s;
}
