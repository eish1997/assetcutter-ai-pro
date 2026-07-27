import { describe, expect, it } from 'vitest';

import { humanMessageForCompanionClientFailure } from '../services/companionNetworkErrors';

describe('humanMessageForCompanionClientFailure', () => {
  it('maps browser-level fetch failed to actionable companion hint', () => {
    expect(humanMessageForCompanionClientFailure(undefined, 'fetch failed')).toContain('无法连接本地伴侣');
    expect(humanMessageForCompanionClientFailure(undefined, 'Failed to fetch')).toContain('无法连接本地伴侣');
  });

  it('does not mislabel companion outbound import failure as offline', () => {
    expect(humanMessageForCompanionClientFailure('STORAGE_IMPORT_FAILED', 'fetch failed')).toContain(
      '伴侣拉取远程文件失败'
    );
    expect(humanMessageForCompanionClientFailure('STORAGE_IMPORT_FAILED', 'fetch failed')).not.toContain(
      '无法连接本地伴侣'
    );
    expect(humanMessageForCompanionClientFailure(undefined, 'upstream_http_403')).toContain('伴侣拉取远程文件失败');
  });

  it('maps bearer and origin codes', () => {
    expect(humanMessageForCompanionClientFailure('AUTH_TOKEN_REQUIRED', 'bearer_required')).toContain('通信密码');
    expect(humanMessageForCompanionClientFailure('AUTH_ORIGIN_DENIED', 'origin_not_allowed')).toContain('网站来源');
  });
});
