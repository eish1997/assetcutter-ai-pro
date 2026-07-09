/**
 * 分镜 bulk LLM 请求常量（独立文件，避免 `storyboardTableParse` 加载 bulk 检测模块时拉取 executor 依赖链）。
 */
export const STORYBOARD_BULK_LLM_TIMEOUT_MS = 300_000;

export const STORYBOARD_BULK_LLM_REQUEST_OPTIONS = {
  responseMimeType: 'application/json' as const,
  timeoutMs: STORYBOARD_BULK_LLM_TIMEOUT_MS,
  requestPhase: '分镜批量',
  retries: 1,
};
