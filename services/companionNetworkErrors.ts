/**
 * 本地伴侣 fetch / HTTP 错误 → 用户可见文案（zh-CN）。
 */

const CODE_ZH: Record<string, string> = {
  AUTH_ORIGIN_DENIED: '本地伴侣拒绝了当前网站来源。请在桌面伴侣配对设置中允许本站，或从桌面壳「工作台」进入。',
  AUTH_TOKEN_REQUIRED: '本地伴侣需要通信密码。请在「设置 → 本地伴侣」填写与桌面壳一致的 Token。',
  AUTH_TOKEN_INVALID: '本地伴侣通信密码不正确。请在「设置 → 本地伴侣」与桌面壳配对页对齐 Token。',
  AUTH_TOKEN_REVOKED: '本地伴侣配对已撤销，请重新配对后再试。',
};

export function humanMessageForCompanionClientFailure(code: string | undefined, fallback: string): string {
  const c = (code || '').trim();
  const fb = String(fallback || '').trim();

  if (c && CODE_ZH[c]) return CODE_ZH[c]!;
  if (fb === 'origin_not_allowed') return CODE_ZH.AUTH_ORIGIN_DENIED!;
  if (fb === 'bearer_required') return CODE_ZH.AUTH_TOKEN_REQUIRED!;
  if (fb === 'bearer_invalid') return CODE_ZH.AUTH_TOKEN_INVALID!;
  if (fb === 'bearer_revoked') return CODE_ZH.AUTH_TOKEN_REVOKED!;

  if (/failed to fetch|fetch failed|networkerror|load failed|connection refused|econnrefused|network request failed/i.test(fb)) {
    return '无法连接本地伴侣。请确认桌面伴侣已启动（默认 http://127.0.0.1:18765），OCR 已一键安装，且设置里地址/Token 与壳内配对一致。';
  }

  return fb || '本地伴侣请求失败';
}
