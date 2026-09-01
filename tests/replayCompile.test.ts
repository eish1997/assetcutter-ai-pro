import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publishShelfSkillToCloud } from '../local-companion/src/workflows/skillCloud.ts';
import {
  deleteShelfSkill,
  EXAMPLE_UNREAL_CONNECTION_SKILL_ID,
} from '../local-companion/src/workflows/skillShelf.ts';
import {
  compileReplayFromTrace,
  compileReplayRequest,
  compileReplayWithFixture,
  listReplayWallWorkflows,
  MANUAL_TRACE_WORKFLOW_ID,
  MAYA_EXPORT_FBX_WORKFLOW_ID,
  REPLAY_FIXTURE_FAILED,
  REPLAY_NO_EXECUTOR,
  REPLAY_NO_TRACE,
} from '../local-companion/src/workflows/replayCompile.ts';

describe('replay compile', () => {
  it('rejects an empty trace', () => {
    const result = compileReplayFromTrace([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(REPLAY_NO_TRACE);
      expect(result.code).toBe(REPLAY_NO_TRACE);
    }
  });

  it('rejects a trace with no registered executor', () => {
    const result = compileReplayFromTrace([{ tool: 'workspace_dispatch', args: { type: 'set_finger' } }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(REPLAY_NO_EXECUTOR);
      expect(result.code).toBe(REPLAY_NO_EXECUTOR);
    }
  });

  it('binds Maya/FBX traces to the registered export skill and promotes after fixture pass', async () => {
    const compiled = compileReplayFromTrace([
      { tool: 'host_invoke_primitive', args: { primitiveId: 'host.import_file', draftId: 'maya' } },
    ]);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.workflowId).toBe(MAYA_EXPORT_FBX_WORKFLOW_ID);

    const passed = await compileReplayWithFixture({
      traces: [{ tool: 'workspace_dispatch', args: { type: 'send_to_current_host', hostId: 'maya' } }],
      runFixture: async () => true,
      createDraft: (workflowId) => ({ id: 'draft_' + workflowId, status: 'available' }),
    });
    expect(passed.ok).toBe(true);
    if (passed.ok) {
      expect(passed.status).toBe('available');
      expect(passed.workflowId).toBe(MAYA_EXPORT_FBX_WORKFLOW_ID);
    }

    const failed = await compileReplayWithFixture({
      traces: [{ tool: 'host_invoke_primitive', args: { primitiveId: 'host.import_file' } }],
      runFixture: async () => false,
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toBe(REPLAY_FIXTURE_FAILED);
      expect(failed.code).toBe(REPLAY_FIXTURE_FAILED);
    }
  });

  it('binds Unreal / fog holdout traces as a manual wall card instead of refusing', async () => {
    const compiled = compileReplayFromTrace([
      { tool: 'connection_create', args: { hostId: 'unreal', name: 'Unreal' } },
      { tool: 'connection_probe', args: { hostId: 'unreal' } },
    ]);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.workflowId).toBe(MANUAL_TRACE_WORKFLOW_ID);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-wall-'));
    const storePath = path.join(dir, 'workflow-objects.json');
    const skillsDir = path.join(dir, 'skills');
    const passed = await compileReplayRequest(
      [{ tool: 'connection_probe', args: { draftId: 'unreal', note: 'fog holdout' } }],
      { storePath, skillsDir },
    );
    expect(passed.ok).toBe(true);
    if (passed.ok) {
      expect(passed.workflowId).toBe(MANUAL_TRACE_WORKFLOW_ID);
      expect(passed.draft).toMatchObject({ name: 'Unreal fog holdout' });
    }
    const wall = listReplayWallWorkflows(storePath, skillsDir);
    expect(wall.some((row) => row.replayKind === 'skill' && row.name === 'Unreal fog holdout')).toBe(true);
    expect(wall.some((row) => row.id === MAYA_EXPORT_FBX_WORKFLOW_ID)).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, 'unreal-fog-holdout', 'SKILL.md'))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('seeds an example Unreal connection skill onto the shelf', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-shelf-'));
    const skillsDir = path.join(dir, 'skills');
    const wall = listReplayWallWorkflows(undefined, skillsDir);
    expect(wall.some((row) => row.id === 'example-unreal-connection' && row.replayKind === 'skill')).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, 'example-unreal-connection', 'SKILL.md'))).toBe(true);
    fs.writeFileSync(path.join(skillsDir, 'example-unreal-connection', 'SKILL.md'), '# kept\n\nuser edited\n', 'utf8');
    listReplayWallWorkflows(undefined, skillsDir);
    expect(fs.readFileSync(path.join(skillsDir, 'example-unreal-connection', 'SKILL.md'), 'utf8')).toContain('user edited');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does not reseed a deleted example skill', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-shelf-removed-'));
    const skillsDir = path.join(dir, 'skills');
    listReplayWallWorkflows(undefined, skillsDir);
    expect(fs.existsSync(path.join(skillsDir, EXAMPLE_UNREAL_CONNECTION_SKILL_ID, 'SKILL.md'))).toBe(true);
    const deleted = deleteShelfSkill(EXAMPLE_UNREAL_CONNECTION_SKILL_ID, skillsDir);
    expect(deleted.ok).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, EXAMPLE_UNREAL_CONNECTION_SKILL_ID, 'SKILL.md'))).toBe(false);
    expect(fs.existsSync(path.join(skillsDir, '.removed', EXAMPLE_UNREAL_CONNECTION_SKILL_ID))).toBe(true);
    const wall = listReplayWallWorkflows(undefined, skillsDir);
    expect(wall.some((row) => row.id === EXAMPLE_UNREAL_CONNECTION_SKILL_ID && row.hasLocal)).toBe(false);
    expect(fs.existsSync(path.join(skillsDir, EXAMPLE_UNREAL_CONNECTION_SKILL_ID, 'SKILL.md'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('marks a published shelf skill as hasCloud', () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-shelf-cloud-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const skillsDir = path.join(root, 'skills');
      const before = listReplayWallWorkflows(undefined, skillsDir).find((row) => row.id === EXAMPLE_UNREAL_CONNECTION_SKILL_ID);
      expect(before).toMatchObject({ origin: 'example', hasLocal: true, hasCloud: false, removable: true, publishable: true });
      const maya = listReplayWallWorkflows(undefined, skillsDir).find((row) => row.id === MAYA_EXPORT_FBX_WORKFLOW_ID);
      expect(maya).toMatchObject({ origin: 'executor', removable: false, publishable: false });
      const published = publishShelfSkillToCloud(EXAMPLE_UNREAL_CONNECTION_SKILL_ID, {
        skillsDir,
        isAdmin: true,
        actorRole: 'admin',
        semver: '1.0.0',
        versionNote: 'Skill wall cloud test',
      });
      expect(published.ok).toBe(true);
      const after = listReplayWallWorkflows(undefined, skillsDir).find((row) => row.id === EXAMPLE_UNREAL_CONNECTION_SKILL_ID);
      expect(after).toMatchObject({ hasLocal: true, hasCloud: true, publishable: true });
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
