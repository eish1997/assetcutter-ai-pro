export type WorkshopEntryClip = {
  root: string;
  rels: string[];
  mode: 'cut' | 'copy';
};

let clip: WorkshopEntryClip | null = null;
const listeners = new Set<() => void>();

export function getWorkshopEntryClip(): WorkshopEntryClip | null {
  return clip;
}

export function setWorkshopEntryClip(next: WorkshopEntryClip | null): void {
  clip = next;
  for (const fn of listeners) fn();
}

export function subscribeWorkshopEntryClip(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
