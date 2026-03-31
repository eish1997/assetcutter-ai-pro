import type { CustomAppModule } from '../types';
import { r2ApiUrl } from './apiBase';
import { requestJson } from './httpClient';

export async function publishPresetToUserR2Catalog(params: { preset: CustomAppModule }): Promise<{ catalogObjectKey: string; packObjectKey: string }> {
  const { preset } = params;
  return requestJson<{ ok: boolean; catalogObjectKey: string; packObjectKey: string }>(r2ApiUrl('/capability-store/publish'), {
    method: 'POST',
    body: JSON.stringify({ preset }),
  });
}
