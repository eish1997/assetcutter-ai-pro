import React, { useEffect, useState } from 'react';
import type { AuthUser } from '../services/authClient';
import type { UserUiPrefs } from '../services/userUiPrefs';

function sidebarAccountSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const SIDEBAR_ACCOUNT_GRADIENTS = [
  'from-violet-600 to-fuchsia-700',
  'from-sky-600 to-blue-700',
  'from-emerald-600 to-teal-700',
  'from-amber-600 to-orange-700',
  'from-rose-600 to-pink-700',
  'from-indigo-600 to-violet-700',
] as const;

/**
 * 侧栏账户入口：圆角矩形与整站 rounded-xl 一致；可显示自定义图或渐变缩写。
 */
export const SidebarAccountAvatar: React.FC<{ user: AuthUser; prefs: UserUiPrefs }> = ({ user, prefs }) => {
  const nameSource =
    prefs.displayName.trim() || user.username?.trim() || user.email?.trim() || '?';
  const raw = nameSource.replace(/\s+/g, '') || '?';
  const initials =
    raw.length >= 2 ? `${raw[0]}${raw[raw.length - 1]}`.toUpperCase() : raw.slice(0, 2).toUpperCase();
  const g =
    SIDEBAR_ACCOUNT_GRADIENTS[sidebarAccountSeed(user.email || user.username) % SIDEBAR_ACCOUNT_GRADIENTS.length];
  const url = prefs.avatarUrl.trim();
  const showImg =
    !!url &&
    (/^data:image\//i.test(url) || /^https?:\/\//i.test(url));

  const [imgBroken, setImgBroken] = useState(false);
  useEffect(() => {
    setImgBroken(false);
  }, [url]);

  return (
    <span
      className="relative flex h-9 w-9 shrink-0 overflow-hidden rounded-xl ring-2 ring-black/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
      aria-hidden
    >
      {showImg && !imgBroken ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setImgBroken(true)}
        />
      ) : (
        <span
          className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${g} text-[11px] font-black tracking-tight text-white`}
        >
          {initials}
        </span>
      )}
    </span>
  );
};
