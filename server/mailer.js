import { Resend } from 'resend';

const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const MAIL_FROM = String(process.env.AUTH_MAIL_FROM || '').trim();
const MAIL_REPLY_TO = String(process.env.AUTH_MAIL_REPLY_TO || '').trim();
const RESET_PAGE_URL = String(process.env.AUTH_RESET_PAGE_URL || '').trim();

let resendClient = null;

function getResend() {
  if (!RESEND_API_KEY) return null;
  if (!resendClient) resendClient = new Resend(RESEND_API_KEY);
  return resendClient;
}

export function buildResetLink(token) {
  if (!RESET_PAGE_URL) return '';
  const base = RESET_PAGE_URL.replace(/\/+$/, '');
  return `${base}?resetToken=${encodeURIComponent(token)}`;
}

export async function sendPasswordResetMail({ to, token }) {
  const client = getResend();
  if (!client || !MAIL_FROM) return { sent: false, reason: 'mail_not_configured' };
  const resetLink = buildResetLink(token);
  const tokenLine = token;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
      <h2>重置密码</h2>
      <p>你正在请求重置密码。该链接 15 分钟内有效。</p>
      ${resetLink ? `<p><a href="${resetLink}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none">点击重置密码</a></p>` : ''}
      <p>若按钮不可用，请手动输入重置码：</p>
      <pre style="padding:10px;background:#f5f5f5;border-radius:6px">${tokenLine}</pre>
      <p>如果这不是你的操作，请忽略本邮件。</p>
    </div>
  `;
  await client.emails.send({
    from: MAIL_FROM,
    to,
    subject: '重置你的账号密码',
    html,
    ...(MAIL_REPLY_TO ? { replyTo: MAIL_REPLY_TO } : {}),
  });
  return { sent: true };
}

