export function workshopFrontHallHotkey(event: {
  key?: string;
  code?: string;
  shiftKey?: boolean;
}): 'f3-add' | 'f3-remove' | null {
  const key = String(event?.key || '');
  const code = String(event?.code || '');
  if (key !== 'F3' && code !== 'F3') return null;
  return event?.shiftKey ? 'f3-remove' : 'f3-add';
}
