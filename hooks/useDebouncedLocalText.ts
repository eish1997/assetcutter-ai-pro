import { useCallback, useEffect, useRef, useState } from 'react';

/** 本地草稿 + 防抖写回，避免每次按键触发父级重绘 / autosave。 */
export function useDebouncedLocalText(
  externalValue: string,
  onCommit: (value: string) => void,
  delayMs = 400
) {
  const [draft, setDraft] = useState(externalValue);
  const timerRef = useRef(0);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    setDraft(externalValue);
  }, [externalValue]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const flush = useCallback((value: string) => {
    window.clearTimeout(timerRef.current);
    onCommitRef.current(value);
  }, []);

  const onChange = useCallback(
    (value: string) => {
      setDraft(value);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => onCommitRef.current(value), delayMs);
    },
    [delayMs]
  );

  const onBlur = useCallback(() => {
    flush(draft);
  }, [draft, flush]);

  return { draft, onChange, onBlur, flush };
}
