import { disabledGeneration } from './generation';
export const createVideoGenerationTask = disabledGeneration;
export const storeGeneratedVideo = disabledGeneration;
export const waitForVideoGenerationTask = disabledGeneration;
export function isVideoTaskFailed(_error: unknown): boolean {
  return false;
}
