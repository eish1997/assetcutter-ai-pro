import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentCliStore } from '../server/agent-cli-store.js';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('agent-cli store (Soul API)', () => {
  it('creates project, run asset, and audit without MCP', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-agent-cli-'));
    dirs.push(root);
    const store = createAgentCliStore({ root });
    const project = store.createProject({ userId: 'u1', username: 'alice', name: '测试' });
    expect(project.id.startsWith('agp_')).toBe(true);
    const job = store.createJob({
      userId: 'u1',
      username: 'alice',
      projectId: project.id,
      prompt: '一只猫',
      presetId: 'text-to-image',
    });
    const asset = store.createAsset({
      userId: 'u1',
      username: 'alice',
      projectId: project.id,
      kind: 'image',
      name: 'cat',
      prompt: '一只猫',
      url: 'data:image/svg+xml;base64,YQ==',
      meta: { jobId: job.id },
    });
    store.updateJob(job.id, { status: 'succeeded', assetId: asset.id });
    const listed = store.listPlatformAssets({ userId: 'u1' });
    expect(listed.some((a) => a.id === asset.id && a.source === 'agent-cli')).toBe(true);
    const audit = store.listAudit({ userId: 'u1' });
    expect(audit.some((e) => e.action === 'project.create')).toBe(true);
    expect(audit.some((e) => e.action === 'asset.create')).toBe(true);
  });

  it('issues and resolves PAT; device login one-time token', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-agent-cli-'));
    dirs.push(root);
    const store = createAgentCliStore({ root });
    const device = store.startDeviceLogin({ siteUrl: 'http://localhost:3000' });
    const approved = store.approveDevice({
      userCode: device.userCode,
      userId: 'u2',
      username: 'bob',
    });
    expect(approved.ok).toBe(true);
    const poll1 = store.pollDevice(device.deviceCode);
    expect(poll1.status).toBe('approved');
    expect(String(poll1.token).startsWith('acpat_')).toBe(true);
    const pat = store.resolvePat(poll1.token!);
    expect(pat?.userId).toBe('u2');
    const poll2 = store.pollDevice(device.deviceCode);
    expect(poll2.status).toBe('approved');
    expect(poll2.token).toBeFalsy();
  });
});
