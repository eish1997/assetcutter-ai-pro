import { useSyncExternalStore } from 'react';
import { getAiJobsSnapshot, subscribeAiJobs } from '../services/aiJobsStore';

export function useAiJobs() {
  return useSyncExternalStore(subscribeAiJobs, getAiJobsSnapshot, getAiJobsSnapshot);
}

