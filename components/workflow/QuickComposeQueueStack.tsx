import React from 'react';

export type QuickComposeQueueStackItem = {
  id: string;
  thumb: string;
  label: string;
};

function QueueThumb({ src, alt }: { src: string; alt: string }) {
  if (src && (src.startsWith('data:image/') || src.startsWith('blob:') || /^https?:\/\//i.test(src))) {
    return (
      <img
        src={src}
        alt={alt}
        className="h-full w-full rounded-md object-cover"
        draggable={false}
      />
    );
  }
  return (
    <span className="grid h-full w-full place-items-center rounded-md bg-white/[0.08] text-[8px] font-bold text-gray-500">
      @
    </span>
  );
}

export default function QuickComposeQueueStack(props: {
  items: QuickComposeQueueStackItem[];
  open: boolean;
  executing?: boolean;
  /** 弹出窗里叠卡留在按钮盒内，避免压到旁边的控件 */
  compact?: boolean;
  onToggle: () => void;
  onClear?: () => void;
  onRemoveItem?: (id: string) => void;
}): React.ReactElement | null {
  const { items, open, executing, compact = false, onToggle, onClear, onRemoveItem } = props;
  if (items.length === 0) return null;
  const shown = items.slice(0, 3);

  return (
    <div className="relative z-20 shrink-0" data-quick-compose-queue>
      <button
        type="button"
        onClick={onToggle}
        className="relative h-10 w-11 shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
        title={open ? '收起队列' : `待处理 ${items.length} 项`}
        aria-label={open ? '收起队列' : `展开队列（${items.length}）`}
        aria-expanded={open}
      >
        {shown.map((item, i) => (
          <span
            key={item.id}
            className="absolute h-9 w-9 overflow-hidden rounded-md ring-1 ring-white/20 shadow-md"
            style={
              compact
                ? { left: i * 3, top: i * 2, zIndex: shown.length - i }
                : {
                    left: i * 5,
                    top: i * 4 - 8,
                    zIndex: shown.length - i,
                    transform: `rotate(${(i - 1) * 7}deg)`,
                  }
            }
          >
            <QueueThumb src={item.thumb} alt="" />
          </span>
        ))}
        <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 z-10 grid h-4 min-w-4 place-items-center rounded-full bg-white px-0.5 text-[8px] font-black text-[#0a0a0c]">
          {items.length}
        </span>
      </button>
      <div
        className={`absolute right-0 top-full z-30 mt-1 w-[min(16rem,70vw)] overflow-hidden transition-[grid-template-rows] duration-200 ease-out grid ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <ul className="max-h-52 overflow-y-auto rounded-xl border border-white/10 bg-[#0f0f12] py-1 shadow-xl ring-1 ring-white/[0.05]">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 px-2 py-1.5">
                <span className="h-8 w-8 shrink-0 overflow-hidden rounded-md ring-1 ring-white/15">
                  <QueueThumb src={item.thumb} alt="" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-gray-200">{item.label}</span>
                {onRemoveItem && !executing ? (
                  <button
                    type="button"
                    onClick={() => onRemoveItem(item.id)}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-gray-500 hover:bg-white/[0.08] hover:text-white"
                    aria-label={`移除 ${item.label}`}
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
            {onClear && !executing ? (
              <li className="border-t border-white/[0.06] px-2 py-1">
                <button
                  type="button"
                  onClick={onClear}
                  className="w-full rounded-md py-1 text-[10px] font-semibold text-gray-500 hover:bg-white/[0.05] hover:text-gray-200"
                >
                  清空队列
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}
