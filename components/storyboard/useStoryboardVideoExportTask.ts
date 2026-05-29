import { useSyncExternalStore } from 'react';
import {
  getStoryboardVideoExportSnapshot,
  subscribeStoryboardVideoExport,
  type StoryboardVideoExportTaskState,
} from '../../services/storyboardVideoExportTaskStore';

export function useStoryboardVideoExportTask(): StoryboardVideoExportTaskState | null {
  return useSyncExternalStore(
    subscribeStoryboardVideoExport,
    getStoryboardVideoExportSnapshot,
    () => null
  );
}
