import { describe, expect, it } from 'vitest';
import {
  dispatchSendToHost,
  fingerHasCargo,
  listSendTargets,
  sendGateUiState,
} from '../services/fingerSendBridge';
import { publishWorkspaceConnectionDrafts } from '../services/workspaceFingerHosts';

describe('fingerSendBridge', () => {
  it('detects cargo on finger selection fields', () => {
    expect(fingerHasCargo(null)).toBe(false);
    expect(fingerHasCargo({ selectedRelPath: 'a.png' } as any)).toBe(true);
    expect(fingerHasCargo({ selectedAssetId: 'card-1' } as any)).toBe(true);
  });

  it('lists ready hosts with version send titles from finger', () => {
    publishWorkspaceConnectionDrafts([
      {
        id: 'photoshop',
        name: 'Photoshop',
        connectionState: { maturity: 'connected', label: '已开通' },
      },
    ]);
    const fromDrafts = listSendTargets({ selectedRelPath: 'x.png' } as any);
    expect(fromDrafts.map((h) => h.id)).toContain('photoshop');

    const fromFinger = listSendTargets({
      selectedRelPath: 'x.png',
      connectedHosts: [
        { id: 'maya', title: 'Maya', sendTitle: 'Maya 2025', localVersionId: 'maya-2025', ready: true },
      ],
    } as any);
    expect(fromFinger.map((h) => h.id)).toEqual(['maya']);
  });

  it('derives send gate UI states', () => {
    expect(sendGateUiState(null, [])).toBe('hidden');
    expect(sendGateUiState({ selectedRelPath: 'a.png' } as any, [])).toBe('idle_no_routes');
    expect(
      sendGateUiState({ selectedRelPath: 'a.png' } as any, [{ id: 'ps', title: 'PS', ready: true } as any]),
    ).toBe('ready_one');
    expect(
      sendGateUiState({ selectedRelPath: 'a.png' } as any, [
        { id: 'ps', title: 'PS', ready: true } as any,
        { id: 'maya', title: 'Maya', ready: true } as any,
      ]),
    ).toBe('ready_many');
  });

  it('dispatchSendToHost returns unwired without companion shell', async () => {
    const r = await dispatchSendToHost('photoshop');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('send_unwired');
  });
});
