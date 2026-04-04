import type { CapabilitySet } from '../types';
import { readLocalJson, writeLocalJson } from './clientPersist';

export const CAPABILITY_SETS_KEY = 'ac_capability_sets';
const CAPABILITY_SETS_VERSION = 1;

type Payload = { version: number; sets: CapabilitySet[] };

function parseCapabilitySetsPayload(parsed: unknown): CapabilitySet[] | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Payload;
  if (p.version === CAPABILITY_SETS_VERSION && Array.isArray(p.sets)) return p.sets;
  return null;
}

export function loadCapabilitySets(): CapabilitySet[] {
  return readLocalJson<CapabilitySet[]>(CAPABILITY_SETS_KEY, [], parseCapabilitySetsPayload);
}

export function saveCapabilitySets(sets: CapabilitySet[]): void {
  const payload: Payload = { version: CAPABILITY_SETS_VERSION, sets };
  writeLocalJson(CAPABILITY_SETS_KEY, payload);
}
