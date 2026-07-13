import { createPlannedWorker } from './types.js';

export const videoWorker = createPlannedWorker({
  id: 'video-worker',
  modalities: ['video'],
  capabilities: ['video.generate'],
});
