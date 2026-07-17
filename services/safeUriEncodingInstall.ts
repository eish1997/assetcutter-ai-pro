import { safeEncodeURIComponent } from './svgDataUrl';

const PATCH_FLAG = '__assetcutterSafeEncodeURIComponentInstalled';

type PatchedGlobal = typeof globalThis & {
  [PATCH_FLAG]?: boolean;
};

export function installSafeEncodeURIComponent(): void {
  const g = globalThis as PatchedGlobal;
  if (g[PATCH_FLAG]) return;
  const nativeEncode = globalThis.encodeURIComponent;
  if (typeof nativeEncode !== 'function') return;
  g[PATCH_FLAG] = true;
  globalThis.encodeURIComponent = ((value: string | number | boolean) => {
    try {
      return nativeEncode(value);
    } catch (error) {
      if (error instanceof URIError) {
        return safeEncodeURIComponent(String(value ?? ''));
      }
      throw error;
    }
  }) as typeof encodeURIComponent;
}

