import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { CapabilitySet, CustomAppModule } from '../types';
import {
  WORKSHOP_PRESET_FOLDER_LABELS,
  WORKSHOP_PRESET_LIBRARY_ROOT,
} from '../services/workshopFileTree';
import {
  isWorkshopPresetLibraryAssetId,
  listWorkshopPresetLibraryAssets,
  parseWorkshopPresetAssetId,
  presetBelongsToWorkshopFolder,
  workshopPresetAssetId,
  workshopPresetFolderAssetId,
  workshopSetAssetId,
} from '../services/workshopPresetLibrary';

const presets: CustomAppModule[] = [
  { id: 'cut_image', label: '抠图', category: 'image_process', instruction: 'cut', order: 1 },
  { id: 'txt', label: '写文案', category: 'text_to_text', instruction: 'hello', order: 2 },
  { id: 'img', label: '生图', category: 'text_to_image', instruction: 'draw', order: 0, previewImage: 'data:image/png;base64,xx' },
];

const sets: CapabilitySet[] = [
  { id: 'flow-b', label: 'B 流程', nodes: [], edges: [] },
  { id: 'flow-a', label: 'A 流程', nodes: [{ id: 'n1', type: 'preset', position: { x: 0, y: 0 }, data: { label: 'n1' } }], edges: [] },
];

describe('workshopPresetLibrary', () => {
  it('keeps preset and set ids stable', () => {
    expect(workshopPresetAssetId('txt')).toBe('wspreset:txt');
    expect(workshopSetAssetId('flow-a')).toBe('wsset:flow-a');
    expect(workshopPresetFolderAssetId('basic')).toBe('wspreset-folder:basic');
    expect(parseWorkshopPresetAssetId('wspreset:txt')).toEqual({ kind: 'preset', id: 'txt' });
    expect(parseWorkshopPresetAssetId('wsset:flow-a')).toEqual({ kind: 'set', id: 'flow-a' });
    expect(parseWorkshopPresetAssetId('wspreset-folder:sets')).toEqual({ kind: 'folder', rel: 'sets' });
    expect(parseWorkshopPresetAssetId('wsfile:x')).toBeNull();
    expect(isWorkshopPresetLibraryAssetId('wspreset:txt')).toBe(true);
  });

  it('lists three folder cards at the preset root', () => {
    const cards = listWorkshopPresetLibraryAssets({
      root: WORKSHOP_PRESET_LIBRARY_ROOT,
      rel: '',
      presets,
      sets,
    });
    expect(cards.map((c) => c.id)).toEqual([
      'wspreset-folder:basic',
      'wspreset-folder:image_process',
      'wspreset-folder:sets',
    ]);
    expect(cards.every((c) => c.isGroup && c.containedKinds?.includes('prompt'))).toBe(true);
    expect(cards.map((c) => c.groupLabel)).toEqual([
      WORKSHOP_PRESET_FOLDER_LABELS.basic,
      WORKSHOP_PRESET_FOLDER_LABELS.image_process,
      WORKSHOP_PRESET_FOLDER_LABELS.sets,
    ]);
  });

  it('keeps image_process out of basic and projects prompt cards', () => {
    expect(presetBelongsToWorkshopFolder(presets[0]!, 'basic')).toBe(false);
    expect(presetBelongsToWorkshopFolder(presets[0]!, 'image_process')).toBe(true);
    expect(presetBelongsToWorkshopFolder(presets[1]!, 'basic')).toBe(true);

    const basic = listWorkshopPresetLibraryAssets({ rel: 'basic', presets, sets });
    expect(basic.map((c) => c.id)).toEqual(['wspreset:img', 'wspreset:txt']);
    expect(basic.every((c) => c.assetKind === 'prompt' && !c.isGroup)).toBe(true);
    expect(basic[0]?.original).toBe('data:image/png;base64,xx');
    expect(basic[1]?.textBody).toBe('hello');

    const proc = listWorkshopPresetLibraryAssets({ rel: 'image_process', presets, sets });
    expect(proc.map((c) => c.id)).toEqual(['wspreset:cut_image']);

    const setCards = listWorkshopPresetLibraryAssets({ rel: 'sets', presets, sets });
    expect(setCards.map((c) => c.id)).toEqual(['wsset:flow-a', 'wsset:flow-b']);
    expect(setCards[0]?.assetKind).toBe('prompt');
  });

  it('WorkflowSection lists preset projection without listWorkshopDir', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'components/WorkflowSection.tsx'), 'utf8');
    expect(src).toContain('isWorkshopPresetLibraryRoot');
    expect(src).toContain('listWorkshopPresetLibraryAssets');
    expect(src).toContain('if (workshopPresetOpen) return presetLibraryAssets');
    const listCalls = [...src.matchAll(/listWorkshopDir\(/g)];
    expect(listCalls.length).toBeGreaterThan(0);
    for (const match of listCalls) {
      const before = src.slice(Math.max(0, match.index! - 900), match.index);
      expect(before).toContain('isWorkshopPresetLibraryRoot(workshopActiveRoot)');
    }
  });

  it('preset wall stays on projection grid and names folder cards', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'components/WorkflowSection.tsx'), 'utf8');
    expect(src).toContain('const workshopBoardView = Boolean(fileSourceApi && !workshopPresetOpen && workshopListPrefs.viewMode === \'board\')');
    expect(src).toContain('{workshopBoardView ? (');
    expect(src).toContain('emptyMarqueeEnabled: !workshopBoardView');
    expect(src).toContain("remeasureKey: `${Math.round(workspacePane)}:${workshopBoardView ? 'board' : 'grid'}`");
    expect(src).toContain('a.groupLabel?.trim() || a.textTitle?.trim() || \'文件夹\'');
    const tree = fs.readFileSync(path.resolve(process.cwd(), 'components/workshop/WorkshopFileSource.tsx'), 'utf8');
    expect(tree).toContain('treeKey(WORKSHOP_PRESET_LIBRARY_ROOT, \'\')');
  });

  it('preset cards drag FROM_EDITOR and jumps no longer snap pane 1', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'components/WorkflowSection.tsx'), 'utf8');
    expect(src).toContain('e.dataTransfer.setData(DT_AC_CAPABILITY_FROM_EDITOR, dragId)');
    expect(src).toContain("topActionMode={workshopPresetOpen ? 'capabilityPreset' : 'asset'}");
    expect(src).not.toContain('topActionMode={activePaneNode === 1');
    expect(src).not.toContain('snapWorkspacePaneToNode(1)');
    expect(src).not.toContain('data-workflow-preset-column');
    expect(src).not.toContain('pending.length > 0 || executingQueue');
    expect(src).not.toContain('项等待执行');
    expect(src).not.toContain('data-workflow-topbar');
    const panes = fs.readFileSync(path.resolve(process.cwd(), 'hooks/useWorkflowWorkspacePanes.ts'), 'utf8');
    expect(panes).toContain('if (e.repeat) return');
    expect(panes).not.toContain('Digit1');
    expect(panes).not.toContain('Digit2');
  });

  it('compose send sits in the asset top row; asset ops share the kind-filter row, not the sidebar', () => {
    const section = fs.readFileSync(path.resolve(process.cwd(), 'components/WorkflowSection.tsx'), 'utf8');
    expect(section).toContain('data-quick-compose-top-row');
    expect(section).toContain('data-workflow-canvas-and-sidebar');
    expect(section).toContain('placement="topRow"');
    expect(section.indexOf('data-quick-compose-top-row')).toBeLessThan(section.indexOf('data-workflow-asset-list'));
    expect(section.indexOf('data-workflow-asset-list')).toBeLessThan(section.indexOf('renderWorkflowFunctionSidebar()'));
    expect(section).toContain('opsRow={');
    expect(section).not.toContain('segment="execute"');
    expect(section).toContain('segment="ops"');
    const bar = fs.readFileSync(path.resolve(process.cwd(), 'components/WorkspaceQuickComposeBar.tsx'), 'utf8');
    expect(bar).toContain('QuickComposeQueueStack');
    expect(bar).toContain("placement?: 'floating' | 'lightbox' | 'topRow'");
    expect(bar).toContain('popoutStack || !isTopRow');
    expect(bar).not.toContain('ProjectAgentDock');
    expect(bar).toContain('handleSendOrExecute');
    expect(bar).toContain('requestQuickComposePopoutWindow');
    const navSrc = fs.readFileSync(path.resolve(process.cwd(), 'components/workshop/WorkshopCanvasNavBar.tsx'), 'utf8');
    expect(navSrc.indexOf('筛选类型')).toBeGreaterThan(0);
    expect(navSrc.indexOf('筛选类型')).toBeLessThan(navSrc.indexOf('props.opsRow'));
    const sidebar = fs.readFileSync(path.resolve(process.cwd(), 'components/workflow/WorkflowSidebarColumn.tsx'), 'utf8');
    expect(sidebar).not.toContain('一键执行');
    expect(sidebar).toContain('data-capability-preset-action-drop');
  });
});
