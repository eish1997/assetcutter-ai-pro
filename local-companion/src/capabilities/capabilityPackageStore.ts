import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';
import {
  assertValidCapabilityPackage,
  normalizeCapabilityId,
  type CapabilityPackage,
  type CapabilityPackageType,
} from './capabilityPackages.js';
import { softwareConnectionDraftToCapabilityPackage } from './softwareConnectionAdapter.js';
import { buildConnectionStrategyDraft } from './connectionStrategyDrafts.js';
import { toolManifestToCapabilityPackage } from './toolPackageAdapter.js';
import { workflowDraftToCapabilityPackage } from './workflowPackageAdapter.js';

export type CapabilityPackageDraftInput = {
  id?: string;
  type?: CapabilityPackageType;
  name: string;
  appName?: string;
  description?: string;
  tags?: string[];
  templateHint?: string;
  semver?: string;
  manifest?: Record<string, unknown>;
  createdBy?: string;
};

export type CapabilityPackageDraft = CapabilityPackage & {
  draftStatus: 'created' | 'validated' | 'failed';
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  lastInstall?: unknown;
  lastProbe?: unknown;
  events?: CapabilityPackageEvent[];
};

export type CapabilityPackageEvent = {
  kind: string;
  ok: boolean;
  message: string;
  at: string;
  detail?: unknown;
};

function capabilitiesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'capabilities'));
  return resolve(join(getRepositoryRoot(), '..', 'capabilities'));
}

function draftsDir(): string {
  return join(capabilitiesStateDir(), 'drafts');
}

function draftPath(id: string): string {
  const safeId = normalizeCapabilityId(id);
  if (!safeId) throw new Error('invalid_capability_id');
  return join(draftsDir(), `${safeId}.json`);
}

function writeDraft(draft: CapabilityPackageDraft): void {
  mkdirSync(draftsDir(), { recursive: true });
  const p = draftPath(draft.id);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  renameSync(tmp, p);
}

export function readCapabilityPackageDrafts(): CapabilityPackageDraft[] {
  let names: string[] = [];
  try {
    names = readdirSync(draftsDir()).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const out: CapabilityPackageDraft[] = [];
  for (const name of names) {
    try {
      const raw = JSON.parse(readFileSync(join(draftsDir(), name), 'utf8')) as CapabilityPackageDraft;
      if (raw?.id && raw?.source === 'draft') out.push(assertValidCapabilityPackage(raw) as CapabilityPackageDraft);
    } catch {
      /* ignore broken draft */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function readCapabilityPackageDraft(idRaw: string): CapabilityPackageDraft | null {
  try {
    const id = normalizeCapabilityId(idRaw);
    if (!id) return null;
    const p = draftPath(id);
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, 'utf8')) as CapabilityPackageDraft;
    return raw?.id === id && raw?.source === 'draft' ? (assertValidCapabilityPackage(raw) as CapabilityPackageDraft) : null;
  } catch {
    return null;
  }
}

export function deleteCapabilityPackageDraft(idRaw: string): boolean {
  try {
    const id = normalizeCapabilityId(idRaw);
    if (!id) return false;
    const p = draftPath(id);
    if (!existsSync(p)) return false;
    rmSync(p, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function updateCapabilityPackageDraft(
  idRaw: string,
  update: (draft: CapabilityPackageDraft) => CapabilityPackageDraft,
): CapabilityPackageDraft | null {
  const current = readCapabilityPackageDraft(idRaw);
  if (!current) return null;
  const next = update({ ...current, updatedAt: new Date().toISOString() });
  writeDraft(next);
  return next;
}

export function appendCapabilityPackageEvent(
  idRaw: string,
  event: { kind: string; ok?: boolean; message?: string; detail?: unknown },
): CapabilityPackageDraft | null {
  return updateCapabilityPackageDraft(idRaw, (current) => {
    const events = Array.isArray(current.events) ? current.events.slice(-49) : [];
    events.push({
      kind: String(event.kind || 'event').trim() || 'event',
      ok: event.ok === true,
      message: String(event.message || '').trim(),
      at: new Date().toISOString(),
      ...(event.detail === undefined ? {} : { detail: event.detail }),
    });
    return { ...current, events };
  });
}

export function createCapabilityPackageDraft(
  input: CapabilityPackageDraftInput,
): { ok: true; draft: CapabilityPackageDraft } | { ok: false; error: string; messages: string[] } {
  const type = input.type || 'software_connection';
  if (type !== 'software_connection' && type !== 'tool' && type !== 'workflow') {
    return { ok: false, error: 'unsupported_capability_type', messages: ['P1 当前只允许创建软件连接或工具能力包草稿。'] };
  }
  try {
    const now = new Date().toISOString();
    const pkg =
      type === 'tool'
        ? toolManifestToCapabilityPackage({
            id: input.id,
            name: input.name,
            description: input.description,
            tags: input.tags,
            semver: input.semver,
            manifest: input.manifest,
          })
        : type === 'workflow'
          ? workflowDraftToCapabilityPackage({
              id: input.id,
              name: input.name,
              description: input.description,
              tags: input.tags,
              semver: input.semver,
              manifest: input.manifest,
            })
          : softwareConnectionDraftToCapabilityPackage({
              id: input.id,
              name: input.name,
              appName: input.appName,
              description: input.description,
              tags: input.tags,
              templateHint: input.templateHint,
              manifest: input.manifest,
            });
    const draft: CapabilityPackageDraft = {
      ...pkg,
      draftStatus: 'created',
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      ...(type === 'software_connection'
        ? {
            events: [
              {
                kind: 'connection_strategy_draft_created',
                ok: true,
                message: 'Connection strategy draft created from collected facts.',
                at: now,
                detail: buildConnectionStrategyDraft(pkg),
              },
            ],
          }
        : {}),
    };
    writeDraft(draft);
    return { ok: true, draft };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: 'capability_draft_create_failed', messages: [message] };
  }
}
