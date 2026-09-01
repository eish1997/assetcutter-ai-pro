'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('node:url');

const DSH_INJECT_ENV = 'ASSETCUTTER_DSH_INJECT';
const DSH_TOOLS_ENV = 'ASSETCUTTER_DSH_TOOLS';
const DEFAULT_TOOLS_ORIGIN = 'http://127.0.0.1:3081';
const FINGER_FILE = 'workspace-finger.txt';
const HANDOFF_FILE = 'handoff.txt';
const COMPOSER_SUGGESTED_FILE = 'composer-suggested.txt';
const FINGER_PLUGIN = 'workspace-finger-plugin.mjs';
const TOOLS_PLUGIN = 'workspace-tools-plugin.mjs';
const PICKER_PLUGIN = 'directory-picker-plugin.mjs';
const PATCH_FILE = 'cordis.yml';
const REPLAY_SKILL_FILE = 'replay-compile-skill.txt';
const MAP_SKILL_FILE = 'map-add-place-skill.txt';
const TOOLS_SKILL_FILE = 'tools-shelf-skill.txt';
const BLANK_ROOM_SKILL_FILE = 'blank-room-skill.txt';
const HOST_REUSE_LINE = '出楼先看 connectedHosts / connection_list，不要在店里拉专线。';

function formatWorkspaceFingerForDsh(finger) {
  const f = finger && typeof finger === 'object' ? finger : {};
  const hosts = Array.isArray(f.connectedHosts) ? f.connectedHosts : [];
  const hostLine = hosts.length
    ? hosts.map((h) => (h && (h.title || h.id)) || '').filter(Boolean).join(', ')
    : '未连接';
  const readyCount = hosts.filter((h) => h && h.ready).length;
  const pendingFile = f.selectedRelPath || f.selectedAssetId || '';
  return [
    `selectedAssetId=${f.selectedAssetId || ''}`,
    `selectedRoot=${f.selectedRoot || ''}`,
    `selectedRelPath=${f.selectedRelPath || ''}`,
    `selectedFileId=${f.selectedFileId || ''}`,
    `selectedDisplayKey=${f.selectedDisplayKey || ''}`,
    `previewOpen=${f.previewOpen ? '1' : '0'}`,
    `previewAssetId=${f.previewAssetId || ''}`,
    `surface=${f.surface || 'other'}`,
    `connectedHosts=${hostLine}`,
    `pendingFile=${pendingFile}`,
    `hostReadyCount=${readyCount}`,
  ].join('\n');
}

function previewInjectText(value) {
  const t = String(value || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 80) return t;
  return `${t.slice(0, 80)}…`;
}

function formatWorkspaceDocumentForDsh(snapshot, opts = {}) {
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const finger = snap.finger && typeof snap.finger === 'object' ? snap.finger : {};
  const assets = snap.assets && typeof snap.assets === 'object' ? snap.assets : {};
  const compartments = snap.compartments && typeof snap.compartments === 'object' ? snap.compartments : {};
  const ids = Array.isArray(snap.assetIds) && snap.assetIds.length ? snap.assetIds : Object.keys(assets);
  const shown = ids.slice(0, 40);
  const extra = ids.length - shown.length;
  const workshopN = Array.isArray(compartments.workshop && compartments.workshop.assetIds)
    ? compartments.workshop.assetIds.length
    : ids.length;
  const workflowN = Array.isArray(compartments.workflow && compartments.workflow.assetIds)
    ? compartments.workflow.assetIds.length
    : 0;
  const toolsN = Array.isArray(compartments.tools && compartments.tools.assetIds)
    ? compartments.tools.assetIds.length
    : 0;
  const roomN = compartments.rooms && typeof compartments.rooms === 'object' ? Object.keys(compartments.rooms).length : 0;
  if (opts.workshopFolderSource) {
    const root = String(finger.selectedRoot || '').trim();
    const rel = String(finger.selectedRelPath || '').trim();
    const folderLine = root ? (rel ? `${root}/${rel}` : root) : '（未打开文件夹）';
    return [
      '这是本地壳正在编辑的同一份稿。作坊隔间=本机文件夹真源，不是项目卡列表。',
      '读稿用 workspace_read_document；改 finger 用 workspace_dispatch set_finger；生图落盘走文件夹 IPC。',
      HOST_REUSE_LINE,
      formatWorkspaceFingerForDsh(finger),
      `workshop=folder:${folderLine}`,
      `cardCount=0`,
      `compartments=workshop:folder workflow:${workflowN} tools:${toolsN} rooms:${roomN}`,
    ].join('\n');
  }
  const lines = [
    '这是本地壳正在编辑的同一份稿。读稿用 workspace_read_document，改稿用 workspace_dispatch。不要发明网页按钮工具。',
    HOST_REUSE_LINE,
    `projectId=${snap.projectId || ''}`,
    formatWorkspaceFingerForDsh(finger),
    `cardCount=${ids.length}`,
    `compartments=workshop:${workshopN} workflow:${workflowN} tools:${toolsN} rooms:${roomN}`,
  ];
  for (const id of shown) {
    const a = assets[id] || { id };
    const text = a.textBody || (a.textResults ? Object.values(a.textResults)[0] : '') || '';
    const hasFile = Boolean(a.originalCompanionKey || (a.resultsCompanionKeys && Object.keys(a.resultsCompanionKeys).length));
    lines.push(
      `- id=${id} kind=${a.assetKind || ''} display=${a.displayKey || ''} title=${previewInjectText(a.textTitle || '')} text=${previewInjectText(text)} file=${hasFile ? '1' : '0'}`,
    );
  }
  if (extra > 0) lines.push(`…另有 ${extra} 张卡未列出`);
  return lines.join('\n');
}

function pluginFileUrl(filePath) {
  return pathToFileURL(path.resolve(filePath)).href;
}

function resolveDshPluginDir(opts = {}) {
  if (opts.pluginDir) return path.resolve(String(opts.pluginDir));
  if (opts.packaged && opts.resourcesPath) {
    return path.join(String(opts.resourcesPath), 'dsh-plugins');
  }
  return path.join(__dirname, 'dsh-plugins');
}

function dshPluginEnv(opts = {}) {
  const injectDir = String(opts.injectDir || '').trim();
  const toolsOrigin = String(opts.toolsOrigin || DEFAULT_TOOLS_ORIGIN).trim() || DEFAULT_TOOLS_ORIGIN;
  const env = { [DSH_TOOLS_ENV]: toolsOrigin };
  if (injectDir) env[DSH_INJECT_ENV] = injectDir;
  return env;
}

function unlinkIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

function resolveDshSkillSource(relName, opts = {}) {
  if (opts.skillSource && path.basename(String(opts.skillSource)) === relName) {
    return path.resolve(String(opts.skillSource));
  }
  if (opts.packaged && opts.resourcesPath) {
    return path.join(String(opts.resourcesPath), 'dsh-skills', relName);
  }
  return path.join(__dirname, 'dsh-skills', relName);
}

function copyDshSkillFile(opts, relSource, destFile) {
  const dir = String(opts.dir || '').trim();
  if (!dir) throw new Error('dsh inject dir required');
  fs.mkdirSync(dir, { recursive: true });
  const src = resolveDshSkillSource(relSource, opts);
  const dest = path.join(dir, destFile);
  if (!fs.existsSync(src)) {
    return { dest, copied: false };
  }
  fs.copyFileSync(src, dest);
  return { dest, copied: true, src };
}

function writeReplayCompileSkill(opts = {}) {
  return copyDshSkillFile(opts, 'replay-compile.md', REPLAY_SKILL_FILE);
}

function writeMapAddPlaceSkill(opts = {}) {
  return copyDshSkillFile(opts, 'map-add-place.md', MAP_SKILL_FILE);
}

function writeToolsShelfSkill(opts = {}) {
  return copyDshSkillFile(opts, 'tools-shelf.md', TOOLS_SKILL_FILE);
}

function writeBlankRoomSkill(opts = {}) {
  return copyDshSkillFile(opts, 'blank-room.md', BLANK_ROOM_SKILL_FILE);
}

function writeDshSkills(opts = {}) {
  return {
    replay: writeReplayCompileSkill(opts),
    mapAddPlace: writeMapAddPlaceSkill(opts),
    toolsShelf: writeToolsShelfSkill(opts),
    blankRoom: writeBlankRoomSkill(opts),
  };
}

function writeDshPatchFile(opts = {}) {
  const dir = String(opts.dir || '').trim();
  if (!dir) throw new Error('dsh inject dir required');
  const pluginDir = resolveDshPluginDir(opts);
  const fingerPlugin = path.join(pluginDir, FINGER_PLUGIN);
  const toolsPlugin = path.join(pluginDir, TOOLS_PLUGIN);
  const pickerPlugin = path.join(pluginDir, PICKER_PLUGIN);
  if (!fs.existsSync(fingerPlugin)) throw new Error(`dsh plugin missing: ${fingerPlugin}`);
  if (!fs.existsSync(toolsPlugin)) throw new Error(`dsh plugin missing: ${toolsPlugin}`);
  if (!fs.existsSync(pickerPlugin)) throw new Error(`dsh plugin missing: ${pickerPlugin}`);
  fs.mkdirSync(dir, { recursive: true });
  unlinkIfExists(path.join(dir, FINGER_PLUGIN));
  unlinkIfExists(path.join(dir, TOOLS_PLUGIN));
  unlinkIfExists(path.join(dir, PICKER_PLUGIN));
  writeDshSkills(opts);
  const yaml =
    `- id: directory-picker\n` +
    `  disabled: true\n` +
    `- insert:\n` +
    `    - id: assetcutter-directory-picker\n` +
    `      name: '${pluginFileUrl(pickerPlugin)}'\n` +
    `    - id: directory-picker-native-ui\n` +
    `      name: '@deepseek-ai/dsh-client-ui-directory-picker-native'\n` +
    `    - id: assetcutter-workspace-finger\n` +
    `      name: '${pluginFileUrl(fingerPlugin)}'\n` +
    `    - id: assetcutter-workspace-tools\n` +
    `      name: '${pluginFileUrl(toolsPlugin)}'\n`;
  const patchPath = path.join(dir, PATCH_FILE);
  fs.writeFileSync(patchPath, yaml, 'utf8');
  return {
    dir,
    pluginDir,
    patchPath,
    fingerPluginPath: fingerPlugin,
    toolsPluginPath: toolsPlugin,
    pickerPluginPath: pickerPlugin,
  };
}

function writeDshContextInject(opts = {}) {
  const dir = String(opts.dir || '').trim();
  if (!dir) throw new Error('dsh inject dir required');
  fs.mkdirSync(dir, { recursive: true });
  const text =
    opts.text != null
      ? String(opts.text)
      : opts.snapshot
        ? formatWorkspaceDocumentForDsh(opts.snapshot)
        : formatWorkspaceDocumentForDsh({ finger: opts.finger || {}, assets: {}, assetIds: [], projectId: '' });
  const fingerPath = path.join(dir, FINGER_FILE);
  fs.writeFileSync(fingerPath, `${text}\n`, 'utf8');
  return {
    dir,
    text,
    fingerPath,
  };
}

function handoffHeadingFor(domain, kind) {
  const d = String(domain || '').trim();
  const k = String(kind || '').trim();
  if (d === 'replay' || k === 'replay_run' || k === 'replay_compile' || k.startsWith('replay_')) {
    return '当前技能（handoff）：';
  }
  if (d === 'tools' || k.startsWith('tool')) {
    return '当前工具货架（handoff）：';
  }
  if (d === 'room' || k === 'blank_room' || k.startsWith('blank_room') || k.startsWith('room_')) {
    return '当前空房（handoff）：';
  }
  return '当前地图办事上下文（handoff）：';
}

function formatHandoffForDsh(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const domain = String(p.domain || p.kind || 'connection').trim() || 'connection';
  const kind = String(p.kind || '').trim();
  const replayId = String(p.replayId || '').trim();
  const label = String(p.label || '').trim();
  const capabilityPackageId = String(p.capabilityPackageId || '').trim();
  const roomId = String(p.roomId || (String(p.surface || '').indexOf('room-') === 0 ? p.surface : '') || '').trim();
  const defaultSurface =
    kind === 'replay_run' || domain === 'replay'
      ? 'workflow'
      : domain === 'tools'
        ? 'tools'
        : domain === 'room' || kind === 'blank_room'
          ? roomId || String(p.surface || '').trim()
          : 'connections';
  const surface = String(p.surface || defaultSurface).trim() || defaultSurface || 'connections';
  const contextPrompt = String(p.contextPrompt || '').trim();
  const suggestedMessage = String(p.suggestedMessage || p.suggested || '').trim();
  const slots = Array.isArray(p.slots) ? p.slots.map(String).filter(Boolean) : [];
  let lastDefaults = '';
  if (p.lastDefaults && typeof p.lastDefaults === 'object' && !Array.isArray(p.lastDefaults)) {
    lastDefaults = JSON.stringify(p.lastDefaults);
  } else if (roomId) {
    lastDefaults = JSON.stringify({ roomId, title: label || roomId });
  }
  const lines = [
    `handoffDomain=${domain}`,
    kind ? `kind=${kind}` : '',
    replayId ? `replayId=${replayId}` : '',
    roomId ? `roomId=${roomId}` : '',
    capabilityPackageId ? `capabilityPackageId=${capabilityPackageId}` : '',
    label ? `label=${label}` : '',
    slots.length ? `slots=${slots.join(',')}` : '',
    lastDefaults ? `lastDefaults=${lastDefaults}` : '',
    `surface=${surface}`,
    '---context---',
    contextPrompt || '（无附加上下文）',
  ].filter(Boolean);
  if (suggestedMessage) {
    lines.push('---suggested---', suggestedMessage);
  }
  return lines.join('\n');
}

function writeDshHandoff(opts = {}) {
  const dir = String(opts.dir || '').trim();
  if (!dir) throw new Error('dsh inject dir required');
  fs.mkdirSync(dir, { recursive: true });
  const text = formatHandoffForDsh(opts.payload || opts);
  const handoffPath = path.join(dir, HANDOFF_FILE);
  fs.writeFileSync(handoffPath, `${text}\n`, 'utf8');
  return { dir, text, handoffPath };
}

function clearDshHandoff(opts = {}) {
  const dir = String(opts.dir || '').trim();
  if (!dir) return { cleared: false };
  unlinkIfExists(path.join(dir, HANDOFF_FILE));
  return { cleared: true };
}

function writeComposerSuggested(opts = {}) {
  const dir = String(opts.dir || '').trim();
  if (!dir) throw new Error('dsh inject dir required');
  const text = String(opts.text != null ? opts.text : opts.composerText || '').trim();
  fs.mkdirSync(dir, { recursive: true });
  const suggestedPath = path.join(dir, COMPOSER_SUGGESTED_FILE);
  if (!text) {
    unlinkIfExists(suggestedPath);
    return { dir, text: '', suggestedPath, cleared: true };
  }
  fs.writeFileSync(suggestedPath, `${text}\n`, 'utf8');
  return { dir, text, suggestedPath, cleared: false };
}

function clearComposerSuggested(opts = {}) {
  const dir = String(opts.dir || '').trim();
  if (!dir) return { cleared: false };
  unlinkIfExists(path.join(dir, COMPOSER_SUGGESTED_FILE));
  return { cleared: true };
}

module.exports = {
  DSH_INJECT_ENV,
  DSH_TOOLS_ENV,
  DEFAULT_TOOLS_ORIGIN,
  HANDOFF_FILE,
  COMPOSER_SUGGESTED_FILE,
  FINGER_FILE,
  PICKER_PLUGIN,
  REPLAY_SKILL_FILE,
  MAP_SKILL_FILE,
  TOOLS_SKILL_FILE,
  BLANK_ROOM_SKILL_FILE,
  formatWorkspaceFingerForDsh,
  formatWorkspaceDocumentForDsh,
  formatHandoffForDsh,
  handoffHeadingFor,
  resolveDshPluginDir,
  dshPluginEnv,
  writeDshPatchFile,
  writeReplayCompileSkill,
  writeMapAddPlaceSkill,
  writeToolsShelfSkill,
  writeBlankRoomSkill,
  writeDshSkills,
  writeDshContextInject,
  writeDshHandoff,
  clearDshHandoff,
  writeComposerSuggested,
  clearComposerSuggested,
};
