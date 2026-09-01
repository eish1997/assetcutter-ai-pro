import { describe, expect, it } from 'vitest';
import {
  displayVersionLabel,
  mergeConnectionLocalVersionManifest,
  placeSummaryFromVersionRows,
  versionRouteViewFor,
  type LocalSoftwareVersion,
} from '../local-companion/src/capabilities/connectionLocalVersions';
import { buildConnectionCardView } from '../local-companion/src/capabilities/softwareConnectionState';

function version(partial: Partial<LocalSoftwareVersion> & { id: string }): LocalSoftwareVersion {
  return {
    label: partial.label || partial.id,
    softwareVersion: partial.softwareVersion || '',
    source: partial.source || 'manual',
    status: partial.status || 'detected',
    ...partial,
  };
}

describe('displayVersionLabel', () => {
  it('extracts Maya year from executable path when softwareVersion is empty', () => {
    expect(
      displayVersionLabel({
        id: 'maya',
        label: 'bin',
        softwareVersion: '',
        executablePath: 'D:/Autodesk/Maya2022/bin/maya.exe',
        source: 'manual',
        status: 'launchable',
      }),
    ).toBe('2022');
  });

  it('does not show bin or Win64 as version label', () => {
    expect(
      displayVersionLabel({
        id: 'ue',
        label: 'Win64',
        softwareVersion: '',
        executablePath: 'C:/UE/Engine/Binaries/Win64/UnrealEditor.exe',
        source: 'manual',
        status: 'detected',
      }),
    ).not.toBe('bin');
    expect(
      displayVersionLabel({
        id: 'ue',
        label: 'Win64',
        softwareVersion: '',
        executablePath: 'C:/UE/Engine/Binaries/Win64/UnrealEditor.exe',
        source: 'manual',
        status: 'detected',
      }),
    ).not.toBe('Win64');
  });
});

describe('versionRouteViewFor', () => {
  it('maps verified to open pill', () => {
    const row = versionRouteViewFor(
      version({
        id: 'ue-54',
        softwareVersion: '5.4',
        executablePath: 'C:/UE/5.4/Engine/Binaries/Win64/UnrealEditor.exe',
        status: 'verified',
      }),
      { isCurrent: true },
    );
    expect(row.routeTone).toBe('open');
    expect(row.routeLabel).toBe('已开通');
    expect(row.isCurrent).toBe(true);
    expect(row.label).toBe('5.4');
  });

  it('maps launchable to pending 未验证', () => {
    const row = versionRouteViewFor(
      version({ id: 'ue-53', softwareVersion: '5.3', status: 'launchable' }),
    );
    expect(row.routeTone).toBe('pending');
    expect(row.routeLabel).toBe('未验证');
  });

  it('maps failed to repair', () => {
    const row = versionRouteViewFor(version({ id: 'x', status: 'failed' }));
    expect(row.routeTone).toBe('repair');
    expect(row.routeLabel).toBe('需修复');
  });

  it('probe success merge marks version row open', () => {
    const manifest = mergeConnectionLocalVersionManifest(
      {
        appName: 'Unreal',
        localVersions: [
          {
            id: 'ue-54',
            label: 'UE 5.4',
            softwareVersion: '5.4',
            executablePath: 'C:/UE/5.4/Engine/Binaries/Win64/UnrealEditor.exe',
            source: 'manual',
            status: 'launchable',
          },
        ],
        currentLocalVersionId: 'ue-54',
      },
      {
        id: 'ue-54',
        label: 'UE 5.4',
        softwareVersion: '5.4',
        executablePath: 'C:/UE/5.4/Engine/Binaries/Win64/UnrealEditor.exe',
        source: 'manual',
        status: 'verified',
        lastProbeAt: '2026-08-26T12:00:00.000Z',
      },
    );
    const rows = (manifest.localVersions as LocalSoftwareVersion[]).map((item) =>
      versionRouteViewFor(item, { isCurrent: item.id === 'ue-54' }),
    );
    expect(rows[0]?.routeTone).toBe('open');
    expect(rows[0]?.routeLabel).toBe('已开通');
  });
});

describe('placeSummaryFromVersionRows', () => {
  it('aggregates version count and open routes', () => {
    const rows = [
      versionRouteViewFor(version({ id: 'a', softwareVersion: '5.3', status: 'verified' })),
      versionRouteViewFor(version({ id: 'b', softwareVersion: '5.4', status: 'launchable' })),
      versionRouteViewFor(version({ id: 'c', softwareVersion: '5.5', status: 'verified' })),
    ];
    const summary = placeSummaryFromVersionRows(rows);
    expect(summary.versionCount).toBe(3);
    expect(summary.openCount).toBe(2);
    expect(summary.summaryLabel).toBe('3 个版本 · 2 条已开通');
  });
});

describe('buildConnectionCardView version rows', () => {
  it('includes versionRows and placeSummary on card view', () => {
    const view = buildConnectionCardView({
      id: 'unreal-engine',
      type: 'software_connection',
      name: 'Unreal Engine',
      manifest: {
        localVersions: [
          { id: 'ue-53', label: 'UE 5.3', softwareVersion: '5.3', status: 'verified', source: 'manual' },
          { id: 'ue-54', label: 'UE 5.4', softwareVersion: '5.4', status: 'launchable', source: 'manual' },
        ],
        currentLocalVersionId: 'ue-54',
      },
    } as any);
    expect(view.versionRows).toHaveLength(2);
    expect(view.placeSummary.versionCount).toBe(2);
    expect(view.placeSummary.openCount).toBe(1);
    expect(view.versionRows.find((row) => row.id === 'ue-54')?.isCurrent).toBe(true);
  });
});
