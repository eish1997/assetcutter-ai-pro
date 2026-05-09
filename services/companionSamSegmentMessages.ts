/**
 * 附录 A 错误码 → 用户可见文案（zh-CN）。
 * i18n 时可改为 companion.sam_segment.error.<code> 查表。
 */

const ZH: Record<string, string> = {
  COMPUTE_BAD_JOB: '任务参数不完整，请重试或联系支持',
  COMPUTE_SAM_PROMPT_MISMATCH: '选区与当前图片尺寸不匹配，请关闭大图后重试',
  COMPUTE_SAM_INPUT_TOO_LARGE: '图片过大，请缩小后再试',
  COMPUTE_SAM_BACKEND:
    '本机分割服务未启动或异常：请确认 SamLocal 已运行（仓库根 npm run dev:sam-local），并托盘「重新启动本地伴侣」。若已启动仍失败，多为系统代理拦截本机端口（伴侣已尝试自动设置 NO_PROXY 排除回环）。',
  COMPUTE_SAM_MODEL_MISSING: '本机分割模型未就绪；当前若为 SAM_MODE=sam 需配置检查点；stub 模式请确认 SamLocal 已启动',
  COMPUTE_SAM_TIMEOUT: '分割耗时过长已中断，请减小图片或稍后重试',
  COMPUTE_SAM_OUTPUT: '分割结果无效，请重试',
  COMPANION_FETCH: '无法从伴侣读取分割结果，请检查网络与项目',
  SAM_PROBE_NOT_LOOPBACK: '伴侣配置的 SamLocal 地址必须是本机回环地址',
  NO_PROJECT: '未选择工作区项目',
  BAD_SRC: '无法读取当前图像（请检查图片来源或跨域）',
  COMPANION_PUT: '写入伴侣失败，请确认本地伴侣已连接',
};

export function humanMessageForSamSegmentFailure(code: string | undefined, fallback: string): string {
  const c = (code || '').trim();
  if (c && ZH[c]) return ZH[c]!;
  return fallback;
}
