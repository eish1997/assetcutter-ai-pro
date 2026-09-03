import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  WORKSHOP_BROWSER_LIBRARY_LABEL,
  WORKSHOP_BROWSER_LIBRARY_ROOT,
  WORKSHOP_RECYCLE_LIBRARY_LABEL,
  WORKSHOP_RECYCLE_LIBRARY_ROOT,
} from '../services/workshopFileTree';
import {
  WORKSHOP_NAV_HISTORY_CAP,
  countWorkshopCanvasKinds,
  emptyWorkshopNavHistory,
  filterWorkshopCanvasByKind,
  normalizeWorkshopNavLoc,
  pushWorkshopNav,
  sameWorkshopNavLoc,
  workshopBreadcrumbSegments,
  workshopCanvasKindMatches,
  workshopCanvasKindOf,
  workshopNavBack,
  workshopNavCanBack,
  workshopNavCanForward,
  workshopNavCanUp,
  workshopNavCurrent,
  workshopNavForward,
  workshopNavRootLabel,
  workshopNavUpLoc,
  defaultWorkshopCanvasListPrefs,
  filterWorkshopCanvasByName,
  isolateWorkshopCanvasKind,
  parseWorkshopCanvasListPrefs,
  sortWorkshopCanvasItems,
  toggleWorkshopCanvasKind,
  DEFAULT_WORKSHOP_CANVAS_KINDS,
} from '../services/workshopCanvasNav';

describe('workshopCanvasNav', () => {
  it('normalizes loc and treats empty groupId as null', () => {
    expect(
      normalizeWorkshopNavLoc({ root: ' C:/lib ', rel: '\\a\\b\\', groupId: '  ' }),
    ).toEqual({ root: 'C:/lib', rel: 'a/b', groupId: null });
    expect(sameWorkshopNavLoc({ root: 'a', rel: 'x/', groupId: '' }, { root: 'a', rel: 'x', groupId: null })).toBe(
      true,
    );
  });

  it('push truncates forward stack and caps length', () => {
    let hist = emptyWorkshopNavHistory({ root: 'r', rel: '', groupId: null });
    hist = pushWorkshopNav(hist, { root: 'r', rel: 'a', groupId: null });
    hist = pushWorkshopNav(hist, { root: 'r', rel: 'a/b', groupId: null });
    hist = workshopNavBack(hist);
    hist = pushWorkshopNav(hist, { root: 'r', rel: 'a/c', groupId: null });
    expect(hist.entries.map((e) => e.rel)).toEqual(['', 'a', 'a/c']);
    expect(hist.index).toBe(2);
    expect(workshopNavCanForward(hist)).toBe(false);

    for (let i = 0; i < WORKSHOP_NAV_HISTORY_CAP + 8; i += 1) {
      hist = pushWorkshopNav(hist, { root: 'r', rel: `p/${i}`, groupId: null });
    }
    expect(hist.entries.length).toBe(WORKSHOP_NAV_HISTORY_CAP);
    expect(hist.index).toBe(WORKSHOP_NAV_HISTORY_CAP - 1);
  });

  it('does not push the same location twice', () => {
    let hist = emptyWorkshopNavHistory({ root: 'r', rel: 'a', groupId: null });
    hist = pushWorkshopNav(hist, { root: 'r', rel: 'a', groupId: null });
    expect(hist.entries).toHaveLength(1);
  });

  it('back and forward walk the stack', () => {
    let hist = emptyWorkshopNavHistory({ root: 'r', rel: '', groupId: null });
    hist = pushWorkshopNav(hist, { root: 'r', rel: 'a', groupId: null });
    expect(workshopNavCanBack(hist)).toBe(true);
    hist = workshopNavBack(hist);
    expect(workshopNavCurrent(hist).rel).toBe('');
    expect(workshopNavCanForward(hist)).toBe(true);
    hist = workshopNavForward(hist);
    expect(workshopNavCurrent(hist).rel).toBe('a');
    hist = workshopNavBack(workshopNavBack(hist));
    expect(workshopNavCanBack(hist)).toBe(false);
  });

  it('up stays inside the hung root and exits browser groups', () => {
    expect(workshopNavCanUp({ root: 'r', rel: '', groupId: null })).toBe(false);
    expect(workshopNavUpLoc({ root: 'r', rel: '', groupId: null })).toBeNull();
    expect(workshopNavUpLoc({ root: 'r', rel: 'a/b', groupId: null })).toEqual({
      root: 'r',
      rel: 'a',
      groupId: null,
    });
    expect(workshopNavCanUp({ root: WORKSHOP_BROWSER_LIBRARY_ROOT, rel: '', groupId: 'g1' })).toBe(true);
    expect(
      workshopNavUpLoc({ root: WORKSHOP_BROWSER_LIBRARY_ROOT, rel: '', groupId: 'g1' }, 'parent'),
    ).toEqual({
      root: WORKSHOP_BROWSER_LIBRARY_ROOT,
      rel: '',
      groupId: 'parent',
    });
    expect(
      workshopNavUpLoc({ root: WORKSHOP_BROWSER_LIBRARY_ROOT, rel: '', groupId: 'g1' }, null),
    ).toEqual({
      root: WORKSHOP_BROWSER_LIBRARY_ROOT,
      rel: '',
      groupId: null,
    });
  });

  it('builds disk and browser breadcrumbs', () => {
    expect(
      workshopBreadcrumbSegments({
        loc: { root: 'D:/Library', rel: '3D/04_Textures', groupId: null },
        rootLabel: 'Library',
      }).map((c) => c.label),
    ).toEqual(['Library', '3D', '04_Textures']);
    expect(
      workshopBreadcrumbSegments({
        loc: { root: 'D:/Library', rel: '3D/04_Textures', groupId: null },
        rootLabel: 'Library',
      })[1].loc.rel,
    ).toBe('3D');

    const browser = workshopBreadcrumbSegments({
      loc: { root: WORKSHOP_BROWSER_LIBRARY_ROOT, rel: '', groupId: 'g2' },
      rootLabel: WORKSHOP_BROWSER_LIBRARY_LABEL,
      groupPath: [
        { id: 'g1', label: '角色' },
        { id: 'g2', label: '贴图' },
      ],
    });
    expect(browser.map((c) => c.label)).toEqual([WORKSHOP_BROWSER_LIBRARY_LABEL, '角色', '贴图']);
    expect(browser[0].loc.groupId).toBeNull();
    expect(browser[2].loc.groupId).toBe('g2');
  });

  it('labels pinned roots and hung folders', () => {
    expect(workshopNavRootLabel(WORKSHOP_BROWSER_LIBRARY_ROOT)).toBe(WORKSHOP_BROWSER_LIBRARY_LABEL);
    expect(workshopNavRootLabel(WORKSHOP_RECYCLE_LIBRARY_ROOT)).toBe(WORKSHOP_RECYCLE_LIBRARY_LABEL);
    expect(workshopNavRootLabel('C:/refs', [{ root: 'C:/refs', label: 'Pictures' }])).toBe('Pictures');
    expect(workshopNavRootLabel('D:/Library/3D')).toBe('3D');
  });

  it('counts and filters kinds, hiding folders without matching contents', () => {
    const rows = [
      { isGroup: true, assetKind: 'group', containedKinds: ['image'] },
      { isGroup: true, containedKinds: ['text'] },
      { isGroup: true, containedKinds: [] },
      { isGroup: true },
      { assetKind: 'image' },
      { assetKind: 'image' },
      { assetKind: 'model3d' },
      { assetKind: 'text' },
      { assetKind: 'file' },
      { assetKind: 'video' },
    ];
    expect(countWorkshopCanvasKinds(rows)).toEqual({
      image: 2,
      model3d: 1,
      video: 1,
      text: 1,
      file: 1,
    });
    expect(workshopCanvasKindOf({ isGroup: true })).toBe('folder');
    expect(workshopCanvasKindOf({ assetKind: 'video' })).toBe('video');
    expect(filterWorkshopCanvasByKind(rows, ['image']).map((r) => r.containedKinds || r.assetKind)).toEqual([
      ['image'],
      undefined,
      'image',
      'image',
    ]);
    expect(workshopCanvasKindMatches({ assetKind: 'text' }, ['image'])).toBe(false);
    expect(workshopCanvasKindMatches({ isGroup: true, containedKinds: ['image'] }, ['image'])).toBe(true);
    expect(workshopCanvasKindMatches({ isGroup: true, containedKinds: ['text'] }, ['image'])).toBe(false);
    expect(workshopCanvasKindMatches({ isGroup: true, containedKinds: [] }, ['image'])).toBe(false);
    expect(workshopCanvasKindMatches({ isGroup: true }, ['image'])).toBe(true);
    expect(filterWorkshopCanvasByKind(rows, DEFAULT_WORKSHOP_CANVAS_KINDS).map((r) => r.containedKinds || r.assetKind)).toEqual([
      ['image'],
      ['text'],
      undefined,
      'image',
      'image',
      'model3d',
      'text',
      'video',
    ]);
    expect(filterWorkshopCanvasByKind(rows, []).map((r) => r.containedKinds || r.assetKind)).toEqual([]);
    expect(filterWorkshopCanvasByKind(rows, ['file']).map((r) => r.containedKinds || r.assetKind)).toEqual([undefined, 'file']);
    expect(toggleWorkshopCanvasKind(['image', 'video'], 'video')).toEqual(['image']);
    expect(toggleWorkshopCanvasKind(['image'], 'file')).toEqual(['image', 'file']);
    expect(isolateWorkshopCanvasKind('text')).toEqual(['text']);
    expect(filterWorkshopCanvasByKind(rows, isolateWorkshopCanvasKind('video')).map((r) => r.containedKinds || r.assetKind)).toEqual([
      undefined,
      'video',
    ]);
  });

  it('pins the canvas nav bar above the asset scroll port', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'components/WorkflowSection.tsx'), 'utf8');
    const barAt = src.indexOf('<WorkshopCanvasNavBar');
    const scrollAt = src.indexOf('data-workflow-scroll-port="asset"');
    expect(barAt).toBeGreaterThan(0);
    expect(scrollAt).toBeGreaterThan(barAt);
    expect(src).toContain('filterWorkshopCanvasByKind');
    expect(src).toContain('fileSourceApi ? (');
    expect(src).toContain('onRevealCurrent');
    expect(src).toContain('toggleWorkshopCanvasKind');
  });

  it('sorts by name, time, size, folder-first, and type groups', () => {
    const rows = [
      { kind: 'loose', name: 'b.png', assetKind: 'image', size: 10, mtimeMs: 20, birthtimeMs: 5 },
      { kind: 'folder', name: 'z-dir', assetKind: 'file', size: 0, mtimeMs: 1, birthtimeMs: 1 },
      { kind: 'loose', name: 'a.glb', assetKind: 'model3d', size: 30, mtimeMs: 8, birthtimeMs: 40 },
    ];
    expect(sortWorkshopCanvasItems(rows, { ...defaultWorkshopCanvasListPrefs(), sortKey: 'name' }).map((r) => r.name)).toEqual([
      'a.glb',
      'b.png',
      'z-dir',
    ]);
    expect(
      sortWorkshopCanvasItems(rows, { ...defaultWorkshopCanvasListPrefs(), sortKey: 'name', sortDir: 'desc' }).map(
        (r) => r.name,
      ),
    ).toEqual(['z-dir', 'b.png', 'a.glb']);
    expect(
      sortWorkshopCanvasItems(rows, { ...defaultWorkshopCanvasListPrefs(), sortKey: 'created' }).map((r) => r.name),
    ).toEqual(['z-dir', 'b.png', 'a.glb']);
    expect(
      sortWorkshopCanvasItems(rows, { ...defaultWorkshopCanvasListPrefs(), sortKey: 'modified' }).map((r) => r.name),
    ).toEqual(['z-dir', 'a.glb', 'b.png']);
    expect(
      sortWorkshopCanvasItems(rows, { ...defaultWorkshopCanvasListPrefs(), sortKey: 'size', sortDir: 'desc' }).map(
        (r) => r.name,
      ),
    ).toEqual(['a.glb', 'b.png', 'z-dir']);
    expect(sortWorkshopCanvasItems(rows, defaultWorkshopCanvasListPrefs()).map((r) => r.name)).toEqual([
      'z-dir',
      'a.glb',
      'b.png',
    ]);
    expect(
      sortWorkshopCanvasItems(rows, { ...defaultWorkshopCanvasListPrefs(), sortKey: 'name', groupByType: true }).map(
        (r) => r.name,
      ),
    ).toEqual(['z-dir', 'b.png', 'a.glb']);
  });

  it('filters canvas items by name and parses list prefs', () => {
    const rows = [
      { kind: 'loose', name: 'Hero_01.png', title: '英雄' },
      { kind: 'folder', name: 'props', title: 'props' },
    ];
    expect(filterWorkshopCanvasByName(rows, 'hero').map((r) => r.name)).toEqual(['Hero_01.png']);
    expect(filterWorkshopCanvasByName(rows, 'PROPS').map((r) => r.name)).toEqual(['props']);
    expect(filterWorkshopCanvasByName(rows, '').length).toBe(2);
    expect(parseWorkshopCanvasListPrefs({ sortKey: 'size', sortDir: 'desc', flatten: true, groupByType: 1 })).toEqual({
      sortKey: 'size',
      sortDir: 'desc',
      flatten: true,
      hideFormatBadges: false,
      groupByType: false,
      kinds: DEFAULT_WORKSHOP_CANVAS_KINDS,
    });
    expect(parseWorkshopCanvasListPrefs({ hideFormatBadges: true }).hideFormatBadges).toBe(true);
    expect(parseWorkshopCanvasListPrefs({ sortKey: 'nope' }).sortKey).toBe('folder');
    expect(parseWorkshopCanvasListPrefs({ kinds: ['file', 'nope'] }).kinds).toEqual(['file']);
    expect(defaultWorkshopCanvasListPrefs().kinds).toEqual(['image', 'model3d', 'video', 'text']);
  });
});
