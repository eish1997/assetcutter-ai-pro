import { describe, expect, it } from 'vitest';
import { connectedHostsFromDrafts } from '../services/workspaceFingerHosts';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { connectedHostsFromDrafts: fromCjs } = require('../companion-desktop/workspace-finger-hosts.cjs') as {
  connectedHostsFromDrafts: typeof connectedHostsFromDrafts;
};

describe('workspaceFingerHosts', () => {
  it('maps connected drafts to hosts and ignores the rest', () => {
    const hosts = connectedHostsFromDrafts(
      [
        { id: 'maya', name: 'Maya', connectionState: { maturity: 'connected' } },
        { id: 'drafty', name: 'WIP', connectionState: { maturity: 'draft' } },
        { id: 'ps', name: 'Photoshop', tags: ['已连接'] },
      ],
      { hasSelectedCard: true },
    );
    expect(hosts).toEqual([
      {
        id: 'maya',
        title: 'Maya',
        sendTitle: 'Maya',
        ready: true,
        canAcceptCurrentCard: true,
        canAcceptCurrentFile: true,
        maturity: 'connected',
        blockedReason: '',
        isDefault: true,
      },
      {
        id: 'ps',
        title: 'Photoshop',
        sendTitle: 'Photoshop',
        ready: true,
        canAcceptCurrentCard: true,
        canAcceptCurrentFile: true,
        maturity: '',
        blockedReason: '',
        isDefault: false,
      },
    ]);
  });

  it('expands multiple verified versions when current is unset', () => {
    const hosts = connectedHostsFromDrafts([
      {
        id: 'unreal-engine',
        name: 'Unreal Engine',
        connectionState: { maturity: 'connected' },
        connectionCardView: {
          name: 'Unreal Engine',
          localVersions: [
            { id: 'ue-53', softwareVersion: '5.3', status: 'verified' },
            { id: 'ue-54', softwareVersion: '5.4', status: 'verified' },
          ],
        },
      },
    ]);
    expect(hosts).toHaveLength(2);
    expect(hosts.map((h) => h.sendTitle)).toEqual(['Unreal Engine 5.3', 'Unreal Engine 5.4']);
    expect(hosts.map((h) => h.localVersionId)).toEqual(['ue-53', 'ue-54']);
  });

  it('uses current version in send title when set', () => {
    const hosts = connectedHostsFromDrafts([
      {
        id: 'unreal-engine',
        name: 'Unreal Engine',
        connectionState: { maturity: 'connected' },
        manifest: { currentLocalVersionId: 'ue-54' },
        connectionCardView: {
          name: 'Unreal Engine',
          currentLocalVersion: { id: 'ue-54', softwareVersion: '5.4', status: 'verified' },
          localVersions: [
            { id: 'ue-53', softwareVersion: '5.3', status: 'verified' },
            { id: 'ue-54', softwareVersion: '5.4', status: 'verified' },
          ],
        },
      },
    ]);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].sendTitle).toBe('Unreal Engine 5.4');
    expect(hosts[0].localVersionId).toBe('ue-54');
  });

  it('returns empty when nothing is connected', () => {
    expect(connectedHostsFromDrafts([])).toEqual([]);
    expect(fromCjs([{ id: 'x', name: 'X', maturity: 'draft' }])).toEqual([]);
  });

  it('marks canAcceptCurrentCard false when no card is selected', () => {
    const hosts = fromCjs(
      [{ id: 'maya', name: 'Maya', connectionState: { maturity: 'connected' } }],
      { hasSelectedCard: false },
    );
    expect(hosts[0].canAcceptCurrentCard).toBe(false);
    expect(hosts[0].canAcceptCurrentFile).toBe(false);
  });

  it('accepts file selection via selectedRelPath', () => {
    const hosts = fromCjs(
      [{ id: 'maya', name: 'Maya', connectionState: { maturity: 'connected' } }],
      { hasSelectedCard: false, selectedRelPath: 'maps/a.png' },
    );
    expect(hosts[0].canAcceptCurrentFile).toBe(true);
    expect(hosts[0].canAcceptCurrentCard).toBe(false);
  });

  it('accepts 已开通 label as connected', () => {
    const hosts = connectedHostsFromDrafts([
      { id: 'ps', name: 'Photoshop', connectionState: { label: '已开通' } },
    ]);
    expect(hosts.map((h) => h.id)).toEqual(['ps']);
  });
});
