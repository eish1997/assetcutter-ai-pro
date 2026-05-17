import { requestJson } from './httpClient';
import { scriptHubApiUrl } from './authClient';
import type { ScriptHubUserPrefsV1 } from '../types/scriptHubPrefs';

export async function fetchScriptHubPrefs(): Promise<{ prefs: ScriptHubUserPrefsV1 }> {
  return requestJson(scriptHubApiUrl('/api/me/script-hub-prefs'));
}

export async function patchScriptHubPrefs(
  patch: Partial<Pick<ScriptHubUserPrefsV1, 'maya' | 'lastParamsByScriptId'>>,
): Promise<{ prefs: ScriptHubUserPrefsV1 }> {
  return requestJson(scriptHubApiUrl('/api/me/script-hub-prefs'), {
    method: 'PATCH',
    body: JSON.stringify({ prefs: patch }),
  });
}
