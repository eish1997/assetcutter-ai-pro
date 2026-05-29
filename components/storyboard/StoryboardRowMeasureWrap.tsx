import React, { useEffect, useRef } from 'react';

type Props = {
  rowId: string;
  measureRow: (rowId: string, height: number) => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

/** 仅对挂载中的可见行测量高度，供虚拟列表与合成列对齐 */
export function StoryboardRowMeasureWrap({ rowId, measureRow, children, className, style }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const report = () => measureRow(rowId, el.getBoundingClientRect().height);
    report();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => report());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureRow, rowId]);

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
