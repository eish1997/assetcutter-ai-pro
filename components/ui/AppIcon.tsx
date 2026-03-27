import React from 'react';

type AppIconName =
  | 'close'
  | 'check'
  | 'warning'
  | 'star'
  | 'package'
  | 'chat'
  | 'image'
  | 'camera'
  | 'cube'
  | 'edit'
  | 'trash'
  | 'user';

const paths: Record<AppIconName, React.ReactNode> = {
  close: <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  check: <path d="M4.5 10.5 8.2 14 15.5 6.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  warning: (
    <>
      <path d="M10 3.5 16.5 15H3.5L10 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10 7.5v3.8M10 13.8h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  star: <path d="m10 3 2 4.2 4.6.7-3.3 3.2.8 4.7-4.1-2.2-4.1 2.2.8-4.7L3.4 7.9 8 7.2 10 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />,
  package: (
    <>
      <path d="M10 2.8 16 6v8l-6 3.2L4 14V6l6-3.2Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 6l6 3.1L16 6M10 9.1V17" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  chat: <path d="M4 5.5h12v8H9l-3.5 3v-3H4v-8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />,
  image: (
    <>
      <rect x="3.5" y="4" width="13" height="12" rx="1.8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 12l2.2-2.2 2.2 2.2 1.8-1.8L14 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  camera: (
    <>
      <path d="M4 7h2l1.1-1.5h5.8L14 7h2v8H4V7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="10" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  cube: (
    <>
      <path d="M10 2.8 16 6v8l-6 3.2L4 14V6l6-3.2Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 6l6 3.1L16 6" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  edit: <path d="m4 14.5 6.8-6.8 2.3 2.3-6.8 6.8H4v-2.3ZM12 6.5l1.5-1.5a1.3 1.3 0 0 1 1.8 0l.7.7a1.3 1.3 0 0 1 0 1.8L14.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />,
  trash: (
    <>
      <path d="M4.5 6h11M8 6V4.5h4V6M6.2 6l.8 9h6l.8-9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8.5 8.5v5M11.5 8.5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  user: (
    <>
      <circle cx="10" cy="7.2" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.8 15.2c1.2-2 3-3 5.2-3s4 .9 5.2 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
};

const AppIcon: React.FC<{ name: AppIconName; className?: string }> = ({ name, className }) => (
  <svg viewBox="0 0 20 20" className={className ?? 'w-4 h-4'} fill="none" aria-hidden>
    {paths[name]}
  </svg>
);

export default AppIcon;
