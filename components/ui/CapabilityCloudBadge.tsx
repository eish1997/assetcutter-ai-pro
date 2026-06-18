import React from 'react';

type CapabilityCloudBadgeProps = {
  className?: string;
  size?: 'xs' | 'sm';
};

const CapabilityCloudBadge: React.FC<CapabilityCloudBadgeProps> = ({ className = '', size = 'xs' }) => {
  const box = size === 'sm' ? 'h-[18px] w-[18px]' : 'h-4 w-4';
  const icon = size === 'sm' ? 'h-3 w-3' : 'h-2.5 w-2.5';
  return (
    <span
      className={`pointer-events-none inline-flex ${box} items-center justify-center rounded-full bg-black/30 text-sky-200/50 ring-1 ring-sky-300/10 ${className}`}
      title="云端预设"
      aria-label="云端预设"
    >
      <svg viewBox="0 0 16 16" className={icon} fill="currentColor" aria-hidden>
        <path d="M12 10a2.5 2.5 0 0 0 .09-5 3.5 3.5 0 0 0-6.77-1.1A2.75 2.75 0 0 0 3.5 10h8.5z" />
      </svg>
    </span>
  );
};

export default CapabilityCloudBadge;
