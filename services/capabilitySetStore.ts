import type { CapabilitySet } from '../types';

export const CAPABILITY_SETS_KEY = 'ac_capability_sets';
const CAPABILITY_SETS_VERSION = 1;

type Payload = { version: number; sets: CapabilitySet[] };

export function loadCapabilitySets(): CapabilitySet[] {
  try {
    const raw = localStorage.getItem(CAPABILITY_SETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Payload;
    if (parsed?.version === CAPABILITY_SETS_VERSION && Array.isArray(parsed.sets)) {
      return parsed.sets;
    }
    return [];
  } catch {
    return [];
  }
}

export function saveCapabilitySets(sets: CapabilitySet[]): void {
  const payload: Payload = { version: CAPABILITY_SETS_VERSION, sets };
  localStorage.setItem(CAPABILITY_SETS_KEY, JSON.stringify(payload));
}
