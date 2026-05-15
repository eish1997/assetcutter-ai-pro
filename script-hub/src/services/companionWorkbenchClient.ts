/**
 * Script Hub 调本机伴侣：与主工作台同源实现（`companionFetchJson` + `getCompanionLocalBaseUrl`），
 * 浏览器直连 18765，不经 Vite `/v1` 代理，避免代理层与 Bearer / Origin 差异导致 `bearer_invalid`。
 */
import { getCompanionLocalBaseUrl } from '../../../services/companionLocalPrefs';

export function companionWorkbenchBase(): string {
  return getCompanionLocalBaseUrl();
}
