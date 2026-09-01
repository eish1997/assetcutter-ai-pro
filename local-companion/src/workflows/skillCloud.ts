import {
  createCapabilityPackageDraft,
  readCapabilityPackageDraft,
  updateCapabilityPackageDraft,
} from '../capabilities/capabilityPackageStore.js';
import {
  activeCapabilityCloudPackage,
  listActiveCapabilityCloudPackages,
  publishCapabilityDraftToCloud,
} from '../capabilities/capabilityCloudVersions.js';
import { EXAMPLE_UNREAL_CONNECTION_SKILL_ID, listShelfSkills, saveShelfSkill } from './skillShelf.js';

export function shelfSkillOrigin(id: string): 'example' | 'shelf' {
  return id === EXAMPLE_UNREAL_CONNECTION_SKILL_ID ? 'example' : 'shelf';
}

export function listCloudWorkflowPackages() {
  return listActiveCapabilityCloudPackages().filter((pkg) => pkg.type === 'workflow');
}

function skillPromptFromPackage(pkg: { description?: string; manifest?: Record<string, unknown> }): string {
  const manifest = pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
  return String(manifest.skillPrompt || pkg.description || '').trim();
}

export function upsertShelfSkillCapabilityDraft(input: {
  description: string;
  id: string;
  name: string;
  prompt: string;
}): { ok: true; id: string } | { error: string; message?: string; ok: false } {
  const id = String(input.id || '').trim();
  if (!id) return { ok: false, error: 'invalid_skill_id' };
  const manifest = { kind: 'skill', skillPrompt: input.prompt };
  const existing = readCapabilityPackageDraft(id);
  if (existing && existing.type !== 'workflow') {
    return { ok: false, error: 'capability_type_mismatch', message: 'Existing capability draft is not a workflow skill.' };
  }
  if (existing) {
    const updated = updateCapabilityPackageDraft(id, (draft) => ({
      ...draft,
      name: input.name,
      description: input.description,
      manifest: { ...draft.manifest, ...manifest, workflowId: id, status: 'draft' },
    }));
    if (!updated) return { ok: false, error: 'capability_draft_update_failed' };
    return { ok: true, id };
  }
  const created = createCapabilityPackageDraft({
    id,
    type: 'workflow',
    name: input.name,
    description: input.description,
    manifest,
    createdBy: 'skill-shelf',
  });
  if (!created.ok) {
    return { ok: false, error: created.error, message: created.messages.join(' ') };
  }
  return { ok: true, id: created.draft.id };
}

export function publishShelfSkillToCloud(
  idRaw: string,
  input: {
    actorRole?: string;
    isAdmin?: boolean;
    publishedBy?: string;
    semver?: string;
    skillsDir?: string;
    versionNote?: string;
  } = {},
) {
  const id = String(idRaw || '').trim();
  const skill = listShelfSkills(input.skillsDir).find((row) => row.id === id);
  if (!skill) return { ok: false as const, error: 'skill_not_found', message: 'Skill is not on the local shelf.' };
  const upserted = upsertShelfSkillCapabilityDraft({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    prompt: skill.prompt,
  });
  if (!upserted.ok) return upserted;
  return publishCapabilityDraftToCloud(upserted.id, {
    semver: input.semver,
    versionNote: input.versionNote,
    actorRole: input.actorRole,
    isAdmin: input.isAdmin,
    publishedBy: input.publishedBy,
  });
}

export function installCloudSkillToShelf(
  idRaw: string,
  skillsDir?: string,
): { ok: true; skill: { id: string; name: string } } | { error: string; message: string; ok: false } {
  const id = String(idRaw || '').trim();
  const pkg = activeCapabilityCloudPackage(id);
  if (!pkg || pkg.type !== 'workflow') {
    return { ok: false, error: 'cloud_skill_not_found', message: 'No active cloud workflow skill for this id.' };
  }
  const prompt = skillPromptFromPackage(pkg);
  if (!prompt) return { ok: false, error: 'skill_prompt_missing', message: 'Cloud skill has no prompt to install.' };
  const saved = saveShelfSkill({
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    prompt,
    skillsDir,
  });
  if (!saved.ok) return { ok: false, error: saved.error, message: 'Failed to write SKILL.md.' };
  return { ok: true, skill: { id: saved.skill.id, name: saved.skill.name } };
}
