import { createPlannedWorker } from './types.js';

export const musicWorker = createPlannedWorker({
  id: 'music-worker',
  modalities: ['music'],
  capabilities: ['music.generate'],
});
