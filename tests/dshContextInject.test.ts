import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  formatHandoffForDsh,
  handoffHeadingFor,
  writeReplayCompileSkill,
  writeMapAddPlaceSkill,
  writeToolsShelfSkill,
  writeBlankRoomSkill,
  writeDshSkills,
  writeDshPatchFile,
  formatWorkspaceDocumentForDsh,
  REPLAY_SKILL_FILE,
  MAP_SKILL_FILE,
  TOOLS_SKILL_FILE,
  BLANK_ROOM_SKILL_FILE,
} = require('../companion-desktop/dsh-context-inject.cjs') as {
  formatHandoffForDsh: (payload: Record<string, unknown>) => string;
  handoffHeadingFor: (domain: string, kind?: string) => string;
  writeReplayCompileSkill: (opts: { dir: string }) => { copied: boolean };
  writeMapAddPlaceSkill: (opts: { dir: string }) => { copied: boolean };
  writeToolsShelfSkill: (opts: { dir: string }) => { copied: boolean };
  writeBlankRoomSkill: (opts: { dir: string }) => { copied: boolean };
  writeDshSkills: (opts: { dir: string }) => { blankRoom: { copied: boolean } };
  writeDshPatchFile: (opts: { dir: string; pluginDir?: string }) => { patchPath: string };
  formatWorkspaceDocumentForDsh: (snap: Record<string, unknown>) => string;
  REPLAY_SKILL_FILE: string;
  MAP_SKILL_FILE: string;
  TOOLS_SKILL_FILE: string;
  BLANK_ROOM_SKILL_FILE: string;
};

describe('dsh context inject handoff', () => {
  it('formats connection handoff blocks', () => {
    const text = formatHandoffForDsh({
      domain: 'connection',
      label: 'Maya',
      capabilityPackageId: 'maya-draft',
      contextPrompt: 'probe failed',
      suggestedMessage: 'continue probe',
    });
    expect(text).toContain('handoffDomain=connection');
    expect(text).toContain('capabilityPackageId=maya-draft');
    expect(text).toContain('---context---');
    expect(text).toContain('probe failed');
    expect(text).toContain('---suggested---');
    expect(text).toContain('continue probe');
  });

  it('formats replay_run handoff with replayId', () => {
    const text = formatHandoffForDsh({
      domain: 'replay',
      kind: 'replay_run',
      replayId: 'workflow.maya.export_selection_fbx',
      label: '导出当前 Maya 选择为 FBX',
      surface: 'workflow',
      slots: ['output_dir', 'file_name'],
      contextPrompt: '当前复现单',
      suggestedMessage: '请按这张复现单跑',
    });
    expect(text).toContain('kind=replay_run');
    expect(text).toContain('replayId=workflow.maya.export_selection_fbx');
    expect(text).toContain('slots=output_dir,file_name');
    expect(text).toContain('surface=workflow');
  });

  it('writes lastDefaults and titles rooms without calling every connection 通讯室', () => {
    const text = formatHandoffForDsh({
      domain: 'tools',
      kind: 'tool_install',
      lastDefaults: { toolId: 'image-format-converter' },
    });
    expect(text).toContain('handoffDomain=tools');
    expect(text).toContain('lastDefaults={"toolId":"image-format-converter"}');
    expect(handoffHeadingFor('tools', 'tool_install')).toContain('工具');
    expect(handoffHeadingFor('tools', 'tool_install')).not.toContain('通讯室');
    expect(handoffHeadingFor('connection', '')).toContain('地图');
    expect(handoffHeadingFor('connection', '')).not.toContain('通讯室');
    expect(handoffHeadingFor('replay', 'replay_run')).toContain('技能');
    const roomHeading = handoffHeadingFor('room', 'blank_room');
    expect(roomHeading).toContain('空房');
    expect(roomHeading).not.toContain('地图');
    expect(roomHeading).not.toContain('通讯室');
    const roomHandoff = formatHandoffForDsh({
      domain: 'room',
      kind: 'blank_room',
      surface: 'room-x1x2x3-abc123',
      roomId: 'room-x1x2x3-abc123',
      label: '空房 1',
    });
    expect(roomHandoff).toContain('roomId=room-x1x2x3-abc123');
    expect(roomHandoff).toContain('surface=room-x1x2x3-abc123');
    expect(roomHandoff).toContain('handoffDomain=room');
    const plugin = fs.readFileSync(
      path.resolve(process.cwd(), 'companion-desktop/dsh-plugins/workspace-finger-plugin.mjs'),
      'utf8',
    );
    expect(plugin).toContain('当前工具货架（handoff）：');
    expect(plugin).toContain('当前地图办事上下文（handoff）：');
    expect(plugin).not.toContain('当前通讯室/连接办事上下文');
  });

  it('injects the compile skill text and finger plugin context name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-inject-'));
    const copied = writeReplayCompileSkill({ dir });
    expect(copied.copied).toBe(true);
    const text = fs.readFileSync(path.join(dir, REPLAY_SKILL_FILE), 'utf8');
    expect(text).toContain('整理成技能');
    expect(text).toContain('replay_compile');
    const plugin = fs.readFileSync(
      path.resolve(process.cwd(), 'companion-desktop/dsh-plugins/workspace-finger-plugin.mjs'),
      'utf8',
    );
    expect(plugin).toContain('assetcutter-replay-compile-skill');
    expect(plugin).toContain('当前技能（handoff）：');
  });

  it('injects the map add-place skill text and finger plugin context name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-inject-'));
    const copied = writeMapAddPlaceSkill({ dir });
    expect(copied.copied).toBe(true);
    const text = fs.readFileSync(path.join(dir, MAP_SKILL_FILE), 'utf8');
    expect(text).toContain('添加地点');
    expect(text).toContain('connection_create');
    const plugin = fs.readFileSync(
      path.resolve(process.cwd(), 'companion-desktop/dsh-plugins/workspace-finger-plugin.mjs'),
      'utf8',
    );
    expect(plugin).toContain('assetcutter-map-add-place-skill');
    expect(text).toContain('connection_list');
    expect(text).toContain('不要再 `connection_create`');
  });

  it('injects the tools shelf skill and host-reuse line', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-inject-'));
    const copied = writeToolsShelfSkill({ dir });
    expect(copied.copied).toBe(true);
    const text = fs.readFileSync(path.join(dir, TOOLS_SKILL_FILE), 'utf8');
    expect(text).toContain('shell_tool_list');
    expect(text).toContain('shell_tool_install');
    const plugin = fs.readFileSync(
      path.resolve(process.cwd(), 'companion-desktop/dsh-plugins/workspace-finger-plugin.mjs'),
      'utf8',
    );
    expect(plugin).toContain('assetcutter-tools-shelf-skill');
    expect(formatWorkspaceDocumentForDsh({ finger: {}, assets: {}, assetIds: [], projectId: '' })).toContain(
      'connection_list',
    );
  });

  it('injects the blank-room skill', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-inject-'));
    const copied = writeBlankRoomSkill({ dir });
    expect(copied.copied).toBe(true);
    const skills = writeDshSkills({ dir });
    expect(skills.blankRoom.copied).toBe(true);
    const text = fs.readFileSync(path.join(dir, BLANK_ROOM_SKILL_FILE), 'utf8');
    expect(text).toContain('空房');
    expect(text).toContain('exit_plan_mode');
    expect(text).toContain('禁止假装');
    const plugin = fs.readFileSync(
      path.resolve(process.cwd(), 'companion-desktop/dsh-plugins/workspace-finger-plugin.mjs'),
      'utf8',
    );
    expect(plugin).toContain('assetcutter-blank-room-skill');
    expect(plugin).toContain('当前空房（handoff）：');
  });

  it('pins the shell Electron folder dialog instead of dsh win32 worker', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-patch-'));
    const pluginDir = path.resolve(process.cwd(), 'companion-desktop/dsh-plugins');
    const patch = writeDshPatchFile({ dir, pluginDir });
    const yaml = fs.readFileSync(patch.patchPath, 'utf8');
    expect(yaml).toMatch(/id:\s*directory-picker[\s\S]*disabled:\s*true/);
    expect(yaml).toContain('assetcutter-directory-picker');
    expect(yaml).toContain('directory-picker-plugin.mjs');
    expect(yaml).toContain('@deepseek-ai/dsh-client-ui-directory-picker-native');
    const plugin = fs.readFileSync(path.join(pluginDir, 'directory-picker-plugin.mjs'), 'utf8');
    expect(plugin).toContain('/workspace/pick-directory');
    expect(plugin).not.toContain('required: false');
  });

  it('wires main to format workspace inject text', () => {
    const main = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    expect(main).toContain('formatWorkspaceDocumentForDsh');
    expect(main).toMatch(/formatWorkspaceDocumentForDsh,\s*\n\s*dshPluginEnv/);
  });
});
