import { companionFetchJson } from './fetch';

/** 与 `GET /v1/host-plugins/bundles` 单条结构对齐（字段随伴侣版本可能增减） */
export type CompanionInstalledHostBundleV1 = {
  dirName: string;
  bundlePath?: string;
  kind?: string;
  semver: string;
  label?: string;
  sha256?: string;
  bytes?: number;
  sourceUrlHost?: string;
  installedAt?: string;
  bundleFormat?: 'zip' | 'bin';
  extractedRelativeDir?: string;
  runSpec?: unknown | null;
};

export async function listCompanionHostPluginBundles(baseUrl: string) {
  return companionFetchJson<{ bundles: CompanionInstalledHostBundleV1[] }>(baseUrl, '/v1/host-plugins/bundles', {
    method: 'GET',
  });
}
