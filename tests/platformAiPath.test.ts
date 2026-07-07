import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../services/settingsStore', () => ({
  getUserApiKey: vi.fn(() => null),
  getTencentCreds: vi.fn(() => ({ secretId: '', secretKey: '' })),
}));

vi.mock('../services/modelRegistry/pickBinding', () => ({
  pickBinding: vi.fn(() => ({ channel: 'vertex-proxy', registryId: 'test' })),
}));

import { getUserApiKey, getTencentCreds } from '../services/settingsStore';
import { pickBinding } from '../services/modelRegistry/pickBinding';
import {
  hasTencentSessionCredentials,
  isPlatformMeteredGeminiPath,
  isPlatformMeteredJobKind,
} from '../services/platformAiPath';

describe('platformAiPath', () => {
  beforeEach(() => {
    vi.mocked(getUserApiKey).mockReturnValue(null);
    vi.mocked(getTencentCreds).mockReturnValue({ secretId: '', secretKey: '' });
    vi.mocked(pickBinding).mockReturnValue({ channel: 'vertex-proxy', registryId: 'test' });
  });

  it('vertex-proxy channel is platform metered', () => {
    expect(isPlatformMeteredGeminiPath('gemini-2.5-flash-image', 'image')).toBe(true);
  });

  it('gemini-aistudio with user key is BYOK', () => {
    vi.mocked(pickBinding).mockReturnValue({ channel: 'gemini-aistudio', registryId: 'test' });
    expect(isPlatformMeteredGeminiPath('gemini-2.5-flash-image', 'image')).toBe(false);
  });

  it('tencent session creds skip workflow_generate_3d gate', () => {
    vi.mocked(getTencentCreds).mockReturnValue({ secretId: 'id', secretKey: 'key' });
    expect(hasTencentSessionCredentials()).toBe(true);
    expect(isPlatformMeteredJobKind('workflow_generate_3d')).toBe(false);
  });

  it('tripo 3d still metered without tencent creds', () => {
    expect(isPlatformMeteredJobKind('workflow_generate_3d')).toBe(true);
  });
});
