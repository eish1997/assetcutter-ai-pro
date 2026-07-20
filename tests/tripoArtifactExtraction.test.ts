import { describe, expect, it } from 'vitest';

import { extractTripoTaskArtifacts } from '../server/ai-gateway/adapters/tripo-openapi-adapter.js';
import { extractTripoTaskArtifactUrls } from '../services/tripoService';
import { extractTripoModelAndPreviewUrls } from '../services/generate3d/tripoWorkflow';

describe('Tripo artifact extraction', () => {
  const tripoDonePayload = {
    status: 'success',
    data: {
      output: {
        model: {
          url: 'https://tripo-cdn.example.com/download/task_1?X-Amz-Signature=abc',
        },
        rendered_image: 'https://tripo-cdn.example.com/previews/task_1.png',
      },
    },
  };

  it('keeps signed model download URLs without file extensions', () => {
    expect(extractTripoTaskArtifactUrls(tripoDonePayload)).toEqual({
      modelUrls: ['https://tripo-cdn.example.com/download/task_1?X-Amz-Signature=abc'],
      previewUrl: 'https://tripo-cdn.example.com/previews/task_1.png',
    });
    expect(extractTripoTaskArtifacts(tripoDonePayload)).toEqual({
      modelUrls: ['https://tripo-cdn.example.com/download/task_1?X-Amz-Signature=abc'],
      previewUrl: 'https://tripo-cdn.example.com/previews/task_1.png',
    });
  });

  it('does not drop extensionless model URLs in workflow result extraction', () => {
    expect(
      extractTripoModelAndPreviewUrls({
        taskId: 'task_1',
        status: 'success',
        modelUrls: [],
        raw: tripoDonePayload,
      })
    ).toEqual({
      modelUrls: ['https://tripo-cdn.example.com/download/task_1?X-Amz-Signature=abc'],
      previewUrl: 'https://tripo-cdn.example.com/previews/task_1.png',
    });
  });

  it('does not treat preview images as model files', () => {
    const payload = {
      output: {
        preview_url: 'https://tripo-cdn.example.com/preview.png',
        model_url: 'https://tripo-cdn.example.com/model.glb',
      },
    };
    expect(extractTripoTaskArtifactUrls(payload)).toEqual({
      modelUrls: ['https://tripo-cdn.example.com/model.glb'],
      previewUrl: 'https://tripo-cdn.example.com/preview.png',
    });
  });
});
