import { useSyncExternalStore } from 'react';
import { getUserUiPrefs, subscribeUserUiPrefs } from '../services/userUiPrefs';

export function useUserUiPrefs() {
  return useSyncExternalStore(subscribeUserUiPrefs, getUserUiPrefs, getUserUiPrefs);
}
