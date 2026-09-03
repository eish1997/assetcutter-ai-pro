import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { workshopDisplayNeedsApply } from '../services/workshopCheckoutDebounce';
import {
  applyWorkshopFileState,
  isWorkshopBrowserLibraryRoot,
  isWorkshopRecycleRoot,
  parentRel,
  parseWorkshopFileAssetId,
  selectedRelFromAssetIds,
  workshopBrowserLibraryRoot,
  workshopFileAssetId,
  workshopMoveToParentDestRel,
  workshopRecycleLibraryRoot,
  workshopRootAllowsCreate,
  WORKSHOP_BROWSER_LIBRARY_LABEL,
  WORKSHOP_BROWSER_LIBRARY_ROOT,
  WORKSHOP_RECYCLE_LIBRARY_LABEL,
  WORKSHOP_RECYCLE_LIBRARY_ROOT,
  WORKSHOP_THUMB_IPC_PARALLEL,
} from '../services/workshopFileTree';
import {
  parseAcAssetDoc,
  utf8FromDataUrl,
  workshopCanvasItemsToWorkflowAssets,
  workshopHostFilePayload,
  workshopPackageCardId,
} from '../services/workshopAssetPackage';

describe('workshopFileTree', () => {
  it('fetches visible thumbs with a parallel pool, not one-by-one', () => {
    expect(WORKSHOP_THUMB_IPC_PARALLEL).toBeGreaterThanOrEqual(12);
  });

  it('parentRel walks posix paths', () => {
    expect(parentRel('')).toBe('');
    expect(parentRel('a')).toBe('');
    expect(parentRel('a/b')).toBe('a');
    expect(parentRel('a/b/c')).toBe('a/b');
    expect(parentRel('\\a\\b')).toBe('a');
  });

  it('workshopMoveToParentDestRel refuses the hung root', () => {
    expect(workshopMoveToParentDestRel('')).toBeNull();
    expect(workshopMoveToParentDestRel('组')).toBe('');
    expect(workshopMoveToParentDestRel('a/b')).toBe('a');
  });

  it('applyWorkshopFileState prefers roots list', () => {
    const next = applyWorkshopFileState({
      ok: true,
      roots: [{ root: 'C:/lib', label: 'lib' }],
    });
    expect(next.activeRoot).toBe('C:/lib');
    expect(next.roots).toHaveLength(1);
    expect(next.openRel).toBe('');
  });

  it('applyWorkshopFileState restores library open root', () => {
    const next = applyWorkshopFileState({
      ok: true,
      roots: [
        { root: 'C:/a', label: 'a' },
        { root: 'C:/b', label: 'b' },
      ],
      openRoot: 'C:/b',
      openRel: 'refs',
    });
    expect(next.activeRoot).toBe('C:/b');
    expect(next.openRel).toBe('refs');
  });

  it('folders UI module re-exports hasWorkbenchFileSourceApi for stale HMR imports', () => {
    const ui = fs.readFileSync(path.resolve(process.cwd(), 'components/workshop/WorkshopFileSource.tsx'), 'utf8');
    expect(ui).toMatch(/export function hasWorkbenchFileSourceApi/);
    expect(ui).not.toContain('WorkshopFileWall');
  });

  it('workbench file source keeps the original asset list and presets on the right', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'components/WorkflowSection.tsx'), 'utf8');
    expect(src).toContain('fileSourceApi && showFunctionSidebar ? renderWorkflowFunctionSidebar()');
    expect(src).toContain('WORKSHOP_FOLDERS_PANE_WIDTH_PX');
    expect(src).toContain('aria-hidden={Boolean(lightboxAssetId)}');
    expect(src).not.toContain('<WorkshopFileWall');
    expect(src).toContain('assetsOnly: true');
    expect(src).toContain('includeSubfolders: workshopListPrefs.flatten');
    expect(src).toContain('onRefresh');
    expect(src).toContain('指定库目录');
    expect(src).toContain('if (workshopDiskOpen) return workshopFileAssets');
    expect(src).toContain('WorkshopCanvasNavBar');
    expect(src).toContain('workshopFileAssets.find((x) => x.id === workflowAssetContextMenu.assetId)');
    expect(src).toContain('onRevealCurrent');
    expect(src).toContain('onIsolateKind');
    const nav = fs.readFileSync(path.resolve(process.cwd(), 'components/workshop/WorkshopCanvasNavBar.tsx'), 'utf8');
    expect(nav).toContain('打开当前文件夹');
    expect(nav).toContain('隐藏格式角标');
    expect(nav).not.toContain("label: '全部'");
    expect(nav).toContain('onIsolateKind');
    expect(src).toContain('moveRootAssetsToUpperLevel');
    expect(src).toContain('createWorkshopTextOnDisk');
    expect(src).toContain('groupWorkshopEntries');
    expect(src).toContain('trashWorkshopEntries');
    expect(src).toContain('WORKSHOP_BROWSER_LIBRARY_ROOT');
    expect(src).toContain('upgradeWorkshopLoose');
    expect(src).toContain('readWorkshopFile');
    expect(src).toContain('WorkflowJustifiedVirtualGrid');
    expect(src).not.toContain('useWorkflowJustifiedVirtualScroll');
    expect(src).not.toContain('originalById: { ...workshopThumbById');
  });

  it('pins a browser-library root that is not a disk path', () => {
    expect(WORKSHOP_BROWSER_LIBRARY_ROOT).toBe('ac-browser:');
    expect(isWorkshopBrowserLibraryRoot(WORKSHOP_BROWSER_LIBRARY_ROOT)).toBe(true);
    expect(isWorkshopBrowserLibraryRoot('C:/lib')).toBe(false);
    expect(workshopBrowserLibraryRoot()).toEqual({
      root: WORKSHOP_BROWSER_LIBRARY_ROOT,
      label: WORKSHOP_BROWSER_LIBRARY_LABEL,
    });
    const ui = fs.readFileSync(path.resolve(process.cwd(), 'components/workshop/WorkshopFileSource.tsx'), 'utf8');
    expect(ui).toContain('workshopBrowserLibraryRoot()');
    expect(ui).toContain('存在浏览器里的资产');
    expect(ui).toContain('WorkshopFolderContextMenu');
    expect(ui).not.toContain('props.onRemoveRoot(item.root)');
  });

  it('sidebar delete drop uses drag refs, not delayed React state', () => {
    const ui = fs.readFileSync(
      path.resolve(process.cwd(), 'components/workflow/WorkflowSidebarColumn.tsx'),
      'utf8',
    );
    expect(ui).toContain('function sidebarHasAssetDrag');
    const deleteBlock = ui.slice(ui.indexOf('title="将图片拖到此处从工作流中删除（组内同效）"') - 800);
    expect(deleteBlock).toContain('sidebarDropSources');
    expect(deleteBlock).not.toContain("getAttribute('data-drag-over') !== '1'");
  });

  it('pins a recycle root under the library, sibling to browser assets', () => {
    expect(WORKSHOP_RECYCLE_LIBRARY_ROOT).toBe('ac-recycle:');
    expect(isWorkshopRecycleRoot(WORKSHOP_RECYCLE_LIBRARY_ROOT)).toBe(true);
    expect(workshopRootAllowsCreate(WORKSHOP_RECYCLE_LIBRARY_ROOT)).toBe(false);
    expect(workshopRootAllowsCreate('C:/lib')).toBe(true);
    expect(workshopRecycleLibraryRoot()).toEqual({
      root: WORKSHOP_RECYCLE_LIBRARY_ROOT,
      label: WORKSHOP_RECYCLE_LIBRARY_LABEL,
    });
    const ui = fs.readFileSync(path.resolve(process.cwd(), 'components/workshop/WorkshopFileSource.tsx'), 'utf8');
    expect(ui).toContain('workshopRecycleLibraryRoot()');
    expect(ui).toContain('已删除的素材，7 天后从库里清除');
    const section = fs.readFileSync(path.resolve(process.cwd(), 'components/WorkflowSection.tsx'), 'utf8');
    expect(section).toContain('workspaceDir={workshopWorkspaceDir}');
  });

  it('projects canvas items onto transient cards (package one card, loose one card)', () => {
    const root = 'C:/lib';
    const looseId = workshopFileAssetId(root, 'a.png');
    expect(parseWorkshopFileAssetId(looseId)).toEqual({ root, rel: 'a.png' });
    const pkgId = workshopPackageCardId(root, 'a3f1c0e8');
    const cards = workshopCanvasItemsToWorkflowAssets(
      [
        {
          kind: 'loose',
          root,
          name: 'a.png',
          rel: 'a.png',
          assetKind: 'image',
          size: 2,
          mtimeMs: 3,
        },
        {
          kind: 'package',
          root,
          name: '1.jpg',
          rel: 'a3f1c0e8',
          assetKind: 'image',
          size: 0,
          mtimeMs: 9,
          assetId: 'a3f1c0e8',
          displayFileId: 'c91e04d2',
          displayRel: 'a3f1c0e8/c91e04d2.png',
          title: '1.jpg',
          resultOrder: ['c91e04d2'],
        },
        {
          kind: 'folder',
          root,
          name: '组',
          rel: '组',
          assetKind: 'file',
          size: 0,
          mtimeMs: 4,
          previewRels: ['组/a.png'],
        },
        {
          kind: 'loose',
          root,
          name: 'note.md',
          rel: 'note.md',
          assetKind: 'text',
          size: 8,
          mtimeMs: 5,
        },
      ],
      { originalById: { [looseId]: 'ac-workshop://v1/t/a.png', [pkgId]: 'ac-workshop://v1/t/1.jpg' } },
    );
    expect(cards).toHaveLength(4);
    expect(cards[0].id).toBe(looseId);
    expect(cards[0].assetKind).toBe('image');
    expect(cards[0].original).toContain('ac-workshop://');
    expect(cards[1].id).toBe(pkgId);
    expect(cards[1].displayKey).toBe('c91e04d2');
    expect(cards[2].isGroup).toBe(true);
    expect(cards[2].assetIds).toEqual([workshopFileAssetId(root, '组/a.png')]);
    expect(cards[3].assetKind).toBe('text');
    expect(cards[3].original).toBe('');
    const thumbOnly = workshopCanvasItemsToWorkflowAssets(
      [
        {
          kind: 'loose',
          root,
          name: 'a.png',
          rel: 'a.png',
          assetKind: 'image',
          size: 2,
          mtimeMs: 3,
        },
      ],
      {},
    );
    expect(thumbOnly[0].original).toBe('');
    const videoId = workshopFileAssetId(root, 'clip.mp4');
    const modelId = workshopFileAssetId(root, 'hero.glb');
    const mediaCards = workshopCanvasItemsToWorkflowAssets(
      [
        {
          kind: 'loose',
          root,
          name: 'clip.mp4',
          rel: 'clip.mp4',
          assetKind: 'video',
          size: 9,
          mtimeMs: 6,
        },
        {
          kind: 'loose',
          root,
          name: 'hero.glb',
          rel: 'hero.glb',
          assetKind: 'model3d',
          size: 10,
          mtimeMs: 7,
        },
        {
          kind: 'loose',
          root,
          name: 'prop.fbx',
          rel: 'prop.fbx',
          assetKind: 'model3d',
          size: 11,
          mtimeMs: 8,
        },
        {
          kind: 'loose',
          root,
          name: 'note.md',
          rel: 'note.md',
          assetKind: 'text',
          size: 8,
          mtimeMs: 5,
        },
      ],
      {
        originalById: { [videoId]: 'data:application/octet-stream;base64,xx' },
        mediaById: {
          [videoId]: { url: 'ac-workshop://v1/video-token/clip.mp4', kind: 'video' },
          [modelId]: { url: 'ac-workshop://v1/model-token/hero.glb', kind: 'model' },
          [workshopFileAssetId(root, 'prop.fbx')]: { url: 'ac-workshop://v1/fbx-token/prop.fbx', kind: 'model' },
        },
        textBodyById: { [workshopFileAssetId(root, 'note.md')]: '# hello' },
      },
    );
    expect(mediaCards[0].assetKind).toBe('video');
    expect(mediaCards[0].original).toBe('ac-workshop://v1/video-token/clip.mp4');
    expect(mediaCards[1].assetKind).toBe('model3d');
    expect(mediaCards[1].original).toBe('');
    expect(mediaCards[1].stepModelUrls).toEqual({ original: ['ac-workshop://v1/model-token/hero.glb'] });
    expect(mediaCards[1].stepModelFormats).toEqual({ original: ['glb'] });
    expect(mediaCards[2].stepModelFormats).toEqual({ original: ['fbx'] });
    expect(mediaCards[2].modelSourceName).toBe('prop.fbx');
    expect(mediaCards[3].textBody).toBe('# hello');
    const pkgVideoId = workshopPackageCardId(root, 'vidpkg');
    const pkgModelId = workshopPackageCardId(root, 'mdlpkg');
    const pkgMediaCards = workshopCanvasItemsToWorkflowAssets(
      [
        {
          kind: 'package',
          root,
          name: 'clip.mp4',
          rel: 'vidpkg',
          assetKind: 'video',
          size: 9,
          mtimeMs: 6,
          assetId: 'vidpkg',
          title: 'clip.mp4',
        },
        {
          kind: 'package',
          root,
          name: 'hero.glb',
          rel: 'mdlpkg',
          assetKind: 'model3d',
          size: 10,
          mtimeMs: 7,
          assetId: 'mdlpkg',
          title: 'hero.glb',
        },
      ],
      {
        mediaById: {
          [pkgVideoId]: { url: 'ac-workshop://v1/pkg-video/clip.mp4', kind: 'video' },
          [pkgModelId]: { url: 'ac-workshop://v1/pkg-model/hero.glb', kind: 'model' },
        },
      },
    );
    expect(pkgMediaCards[0].original).toBe('ac-workshop://v1/pkg-video/clip.mp4');
    expect(pkgMediaCards[1].original).toBe('');
    expect(pkgMediaCards[1].stepModelUrls).toEqual({ original: ['ac-workshop://v1/pkg-model/hero.glb'] });
    expect(pkgMediaCards[1].stepModelFormats).toEqual({ original: ['glb'] });
    expect(selectedRelFromAssetIds([looseId], root)).toBe('a.png');
    expect(
      selectedRelFromAssetIds([pkgId], root, [
        {
          kind: 'package',
          root,
          name: '1.jpg',
          rel: 'a3f1c0e8',
          assetKind: 'image',
          size: 0,
          mtimeMs: 9,
          assetId: 'a3f1c0e8',
          displayRel: 'a3f1c0e8/c91e04d2.png',
        },
      ]),
    ).toBe('a3f1c0e8/c91e04d2.png');
  });

  it('loose checkout with workspace versions exposes resultOrder and apply face', () => {
    const root = 'C:/lib';
    const looseId = workshopFileAssetId(root, 'a.png');
    const cards = workshopCanvasItemsToWorkflowAssets(
      [
        {
          kind: 'loose',
          root,
          name: 'a.png',
          rel: 'a.png',
          assetKind: 'image',
          size: 2,
          mtimeMs: 3,
          assetId: 'bf629595',
          resultOrder: ['c9ad9125'],
          checkoutFileId: 'orig1',
          faceFileId: 'orig1',
          files: {
            orig1: { name: 'a.png', role: 'original' },
            c9ad9125: { name: 'c9ad9125.png', role: 'result', step: 'step1' },
          },
        },
      ],
      { faceById: { [looseId]: 'c9ad9125' } },
    );
    expect(cards[0].resultOrder).toEqual(['c9ad9125']);
    expect(cards[0].displayKey).toBe('c9ad9125');
    expect(workshopDisplayNeedsApply(cards[0].displayKey, 'orig1')).toBe(true);
    const fromDoc = workshopCanvasItemsToWorkflowAssets(
      [
        {
          kind: 'loose',
          root,
          name: 'a.png',
          rel: 'a.png',
          assetKind: 'image',
          size: 2,
          mtimeMs: 3,
          assetId: 'bf629595',
          resultOrder: ['c9ad9125'],
          displayFileId: 'c9ad9125',
          checkoutFileId: 'orig1',
          faceFileId: 'orig1',
          files: {
            orig1: { name: 'a.png', role: 'original' },
            c9ad9125: { name: 'c9ad9125.png', role: 'result', step: 'step1' },
          },
        },
      ],
      {
        originalById: {
          [looseId]: 'data:image/jpeg;base64,RESULT',
          [`${looseId}::orig1`]: 'data:image/jpeg;base64,ORIG',
          [`${looseId}::c9ad9125`]: 'data:image/jpeg;base64,RESULT',
        },
      },
    );
    expect(fromDoc[0].displayKey).toBe('c9ad9125');
    expect(fromDoc[0].original).toBe('data:image/jpeg;base64,ORIG');
    expect(fromDoc[0].results.c9ad9125).toBe('data:image/jpeg;base64,RESULT');
    expect(workshopDisplayNeedsApply(fromDoc[0].displayKey, 'orig1')).toBe(true);
  });

  it('maps hydrated markdown onto loose and package text cards', () => {
    const root = 'F:/lib';
    const pkgId = workshopPackageCardId(root, 'mdpkg');
    const cards = workshopCanvasItemsToWorkflowAssets(
      [
        {
          kind: 'package',
          root,
          name: '文本.md',
          rel: 'mdpkg',
          assetKind: 'text',
          size: 8,
          mtimeMs: 1,
          assetId: 'mdpkg',
          title: '文本.md',
        },
      ],
      { textBodyById: { [pkgId]: '# 正文' } },
    );
    expect(cards[0]?.assetKind).toBe('text');
    expect(cards[0]?.textBody).toBe('# 正文');
    expect(utf8FromDataUrl(`data:text/plain;base64,${Buffer.from('# 你好', 'utf8').toString('base64')}`)).toBe(
      '# 你好',
    );
  });

  it('parseAcAssetDoc validates manifest shape', () => {
    const doc = parseAcAssetDoc({
      v: 1,
      id: 'a3f1c0e8',
      title: '1.jpg',
      displayFileId: 'c91e04d2',
      files: {
        '7b2c91aa': { name: '7b2c91aa.png', role: 'original' },
        c91e04d2: { name: 'c91e04d2.png', role: 'result', step: '重绘' },
      },
      resultOrder: ['c91e04d2'],
      tags: ['ref'],
    });
    expect(doc?.id).toBe('a3f1c0e8');
    expect(doc?.displayFileId).toBe('c91e04d2');
    expect(doc?.tags).toEqual(['ref']);
  });

  it('workshopHostFilePayload keeps fileId on loose cards', () => {
    const payload = workshopHostFilePayload(
      { kind: 'loose', root: 'C:/lib', rel: 'a.png' },
      { fileId: 'face1' },
    );
    expect(payload).toEqual({ root: 'C:/lib', rel: 'a.png', fileId: 'face1' });
  });
});
