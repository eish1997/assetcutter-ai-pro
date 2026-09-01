import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type ShelfSkill = {
  description: string;
  id: string;
  name: string;
  path: string;
  prompt: string;
};

export function defaultSkillShelfDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return path.join(sb, 'skills');
  return path.resolve('.assetcutter/skills');
}

export function normalizeShelfSkillId(raw: string): string {
  const id = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!id || id === '.' || id === '..' || id.includes('..')) return '';
  return id;
}

function fallbackSkillId(name: string): string {
  const hex = Buffer.from(String(name || 'skill'), 'utf8').toString('hex').slice(0, 16);
  return `skill-${hex || String(Date.now())}`;
}

function assertInsideRoot(root: string, target: string): boolean {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  const rel = path.relative(rootPath, targetPath);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function removedDir(root: string): string {
  return path.join(root, '.removed');
}

export function shelfSkillRemovedPath(skillsDir: string, id: string): string {
  return path.join(removedDir(skillsDir), id);
}

export function isShelfSkillRemoved(idRaw: string, skillsDir = defaultSkillShelfDir()): boolean {
  const id = normalizeShelfSkillId(idRaw);
  if (!id) return false;
  return existsSync(shelfSkillRemovedPath(skillsDir, id));
}

function clearShelfSkillTombstone(root: string, id: string): void {
  const marker = shelfSkillRemovedPath(root, id);
  if (!existsSync(marker)) return;
  try {
    rmSync(marker, { force: true });
  } catch {
    /* ignore */
  }
}

export function writeShelfSkillTombstone(idRaw: string, skillsDir = defaultSkillShelfDir()): { error: string; ok: false } | { ok: true } {
  const root = String(skillsDir || '').trim();
  const id = normalizeShelfSkillId(idRaw);
  if (!root) return { ok: false, error: 'skills_root_missing' };
  if (!id) return { ok: false, error: 'invalid_skill_id' };
  const marker = shelfSkillRemovedPath(root, id);
  if (!assertInsideRoot(root, marker)) return { ok: false, error: 'invalid_skill_path' };
  mkdirSync(removedDir(root), { recursive: true });
  writeFileSync(marker, `${new Date().toISOString()}\n`, 'utf8');
  return { ok: true };
}

export function deleteShelfSkill(
  idRaw: string,
  skillsDir = defaultSkillShelfDir(),
): { ok: true; id: string } | { error: string; ok: false } {
  const root = String(skillsDir || '').trim();
  const id = normalizeShelfSkillId(idRaw);
  if (!root) return { ok: false, error: 'skills_root_missing' };
  if (!id) return { ok: false, error: 'invalid_skill_id' };
  const dir = path.join(root, id);
  if (!assertInsideRoot(root, dir)) return { ok: false, error: 'invalid_skill_path' };
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  const marked = writeShelfSkillTombstone(id, root);
  if (!marked.ok) return marked;
  return { ok: true, id };
}

export function parseShelfSkillMarkdown(raw: string, fallbackId: string, filePath: string): ShelfSkill | null {
  const text = String(raw || '');
  let body = text;
  const meta: Record<string, string> = {};
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w+):\s*(.+)$/);
      if (m) meta[m[1]] = m[2].trim();
    }
    body = fm[2].trim();
  }
  const firstLine = body.split('\n').find((line) => line.trim()) || '';
  const title = firstLine.replace(/^#\s*/, '').trim();
  const id = normalizeShelfSkillId(meta.id || fallbackId);
  if (!id) return null;
  const prompt = body.trim();
  if (!prompt) return null;
  return {
    id,
    name: String(meta.name || title || fallbackId).trim() || id,
    description: String(meta.description || prompt.slice(0, 240)).trim(),
    prompt,
    path: filePath,
  };
}

export const EXAMPLE_UNREAL_CONNECTION_SKILL_ID = 'example-unreal-connection';

const EXAMPLE_UNREAL_CONNECTION_PROMPT = [
  '# 示例：Unreal 连接',
  '',
  'whenToUse：这是技能墙上的示例卡。用户点执行，或说「按示例查一下 Unreal」。',
  '',
  '1. `connection_list`，找 hostId=`unreal` 或名称含 Unreal 的地点。已有就用返回的 draftId，不要再 `connection_create`。',
  '2. 没有 → `connection_create`，hostId=`unreal`，name=`Unreal`。不要另猜 exe / 端口。',
  '3. `connection_probe` 那个 draftId。',
  '4. 把探活结果告诉用户。禁止 `replay_run`。禁止假装已做 fog holdout。',
].join('\n');

export function ensureExampleShelfSkills(skillsDir = defaultSkillShelfDir()): void {
  const root = String(skillsDir || '').trim();
  if (!root) return;
  if (isShelfSkillRemoved(EXAMPLE_UNREAL_CONNECTION_SKILL_ID, root)) return;
  const mdPath = path.join(root, EXAMPLE_UNREAL_CONNECTION_SKILL_ID, 'SKILL.md');
  if (existsSync(mdPath)) return;
  saveShelfSkill({
    id: EXAMPLE_UNREAL_CONNECTION_SKILL_ID,
    name: '示例：Unreal 连接',
    description: '地图里查 Unreal 地点并探活。没有自动执行器。',
    prompt: EXAMPLE_UNREAL_CONNECTION_PROMPT,
    skillsDir: root,
  });
}

export function listShelfSkills(skillsDir = defaultSkillShelfDir()): ShelfSkill[] {
  const root = String(skillsDir || '').trim();
  if (!root || !existsSync(root)) return [];
  const out: ShelfSkill[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(root, entry.name);
    if (!assertInsideRoot(root, dir)) continue;
    const mdPath = path.join(dir, 'SKILL.md');
    if (!existsSync(mdPath)) continue;
    try {
      const skill = parseShelfSkillMarkdown(readFileSync(mdPath, 'utf8'), entry.name, dir);
      if (skill) out.push(skill);
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function saveShelfSkill(input: {
  description?: string;
  id?: string;
  name: string;
  prompt: string;
  skillsDir?: string;
}): { ok: true; skill: ShelfSkill } | { error: string; ok: false } {
  const root = String(input.skillsDir || defaultSkillShelfDir()).trim();
  if (!root) return { ok: false, error: 'skills_root_missing' };
  const prompt = String(input.prompt || '').trim();
  if (!prompt) return { ok: false, error: 'prompt_required' };
  const name = String(input.name || '').trim() || '技能';
  const id = normalizeShelfSkillId(input.id || name) || fallbackSkillId(name);
  const dir = path.join(root, id);
  if (!assertInsideRoot(root, dir)) return { ok: false, error: 'invalid_skill_path' };
  mkdirSync(dir, { recursive: true });
  clearShelfSkillTombstone(root, id);
  const description = String(input.description || prompt.slice(0, 240)).trim();
  const mdPath = path.join(dir, 'SKILL.md');
  const body = `---\nid: ${id}\nname: ${name}\ndescription: ${description.replace(/\n/g, ' ')}\n---\n\n${prompt}\n`;
  writeFileSync(mdPath, body, 'utf8');
  return {
    ok: true,
    skill: {
      id,
      name,
      description,
      prompt,
      path: dir,
    },
  };
}

export function buildTraceSkillPrompt(title: string, steps: string): string {
  return [
    `# ${title}`,
    '',
    'whenToUse：用户点这张技能卡，或说按这套再做一遍。',
    '',
    '按下列步骤办事。本机没有对应自动执行器时禁止调用 replay_run。',
    '',
    steps,
  ].join('\n');
}
