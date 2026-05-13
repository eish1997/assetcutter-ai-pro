/**
 * remove_bg / rembg 错误码 → 用户可见文案（zh-CN）。
 */

const ZH: Record<string, string> = {
  COMPUTE_BAD_JOB: '任务参数不完整，请重试',
  COMPUTE_REMBG_NOT_INSTALLED:
    '当前 Python 环境中未安装 rembg。请点击「去背景」查看安装说明，或安装后设置 COMPANION_REMBG_PYTHON 指向已安装 rembg 的解释器。',
  COMPUTE_REMBG_PYTHON_NOT_FOUND: '找不到 Python 可执行文件。请安装 Python 3.11+ 并设置环境变量 COMPANION_REMBG_PYTHON。',
  COMPUTE_REMBG_MODEL: '不支持的抠图模型或模型加载失败',
  COMPUTE_REMBG_FAILED: '抠图执行失败',
  COMPANION_FETCH: '无法从伴侣读取抠图结果',
  COMPANION_PUT: '写入伴侣失败，请确认本地伴侣已连接',
  NO_PROJECT: '未选择工作区项目',
  BAD_SRC: '无法读取当前图像（请检查图片来源或跨域）',
};

export function humanMessageForRembgFailure(code: string | undefined, fallback: string): string {
  const c = (code || '').trim();
  const fb = String(fallback || '').trim();
  const head = c && ZH[c] ? ZH[c]! : '';
  /** 伴侣已带回 stderr/细节时一并展示，避免只剩泛化文案（尤其 onnx/rembg 报错常很长） */
  if (head && fb && fb !== head && !fb.startsWith(head)) {
    const tail = fb.length > 600 ? `${fb.slice(0, 600)}…` : fb;
    return `${head}：${tail}`;
  }
  if (head) return head;
  return fb || '抠图失败';
}

export function isRembgInstallHelpCode(code: string | undefined): boolean {
  const c = (code || '').trim();
  return c === 'COMPUTE_REMBG_NOT_INSTALLED' || c === 'COMPUTE_REMBG_PYTHON_NOT_FOUND';
}
