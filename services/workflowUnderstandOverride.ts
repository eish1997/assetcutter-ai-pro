/**
 * 分组/快捷栏「理解」开关 → 入队任务 `overrideSkipUnderstand`。
 * 字段语义：**true = 本次跳过理解（直发提示词）**；与 `runTask` 写入的 `preset.skipUnderstand` 一致。
 */
export function overrideSkipUnderstandFromUnderstandEnabled(
  understandEnabled: boolean | undefined
): boolean | undefined {
  if (typeof understandEnabled !== 'boolean') return undefined;
  return !understandEnabled;
}
