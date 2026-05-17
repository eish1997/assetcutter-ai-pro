import { readLocalString, scopedStorageKey, writeLocalJson } from '../../../services/clientPersist';
import { DEFAULT_SCRIPT_HUB_PREFS, type ScriptHubUserPrefsV1 } from '../types/scriptHubPrefs';

const LOCAL_BASE = 'ac_script_hub_user_prefs_v1';

export function scriptHubPrefsLocalKey(userId: string): string {
  return scopedStorageKey(LOCAL_BASE, userId);
}

export function readScriptHubPrefsLocal(userId: string): ScriptHubUserPrefsV1 | null {
  const raw = readLocalString(scriptHubPrefsLocalKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ScriptHubUserPrefsV1;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeScriptHubPrefsLocal(userId: string, prefs: ScriptHubUserPrefsV1): void {
  writeLocalJson(scriptHubPrefsLocalKey(userId), prefs);
}

export function readScriptHubPrefsLocalOrDefault(userId: string): ScriptHubUserPrefsV1 {
  return readScriptHubPrefsLocal(userId) ?? { ...DEFAULT_SCRIPT_HUB_PREFS };
}
