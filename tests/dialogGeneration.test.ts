import { describe, expect, it } from 'vitest';

import type { DialogMessage } from '../types';
import { buildDialogContents, getDialogMessageImages, getDialogUnderstandImageInput } from '../hooks/useDialogGeneration';
import { applyDetectedBoxesToDialogMessage } from '../hooks/useDialogPostProcessing';

describe('dialog generation helpers', () => {
  it('优先返回用户消息中的多图输入列表', () => {
    const message: DialogMessage = {
      id: 'm1',
      role: 'user',
      text: '融合两张图',
      imageBase64: 'data:image/png;base64,legacy',
      inputImages: ['data:image/png;base64,a', 'data:image/png;base64,b'],
      timestamp: Date.now(),
    };

    expect(getDialogMessageImages(message)).toEqual([
      'data:image/png;base64,a',
      'data:image/png;base64,b',
    ]);
  });

  it('构造对话内容时会把多张参考图都带入最后一条用户消息', () => {
    const contents = buildDialogContents([], '请融合两张图', [
      'data:image/png;base64,a',
      'data:image/png;base64,b',
    ]);

    expect(contents).toHaveLength(1);
    expect(contents[0].role).toBe('user');
    expect(contents[0].parts).toEqual([
      { inlineData: { mimeType: 'image/jpeg', data: 'a' } },
      { inlineData: { mimeType: 'image/jpeg', data: 'b' } },
      { text: '请融合两张图' },
    ]);
  });

  it('理解阶段在多图时会传完整图片列表而不是首图', () => {
    expect(getDialogUnderstandImageInput([])).toBeNull();
    expect(getDialogUnderstandImageInput(['data:image/png;base64,a'])).toBe('data:image/png;base64,a');
    expect(getDialogUnderstandImageInput([
      'data:image/png;base64,a',
      'data:image/png;base64,b',
    ])).toEqual([
      'data:image/png;base64,a',
      'data:image/png;base64,b',
    ]);
  });

  it('目标检测结果会写回发起检测时锁定的版本下标', () => {
    const message: DialogMessage = {
      id: 'm1',
      role: 'assistant',
      text: '结果',
      timestamp: Date.now(),
      versions: [
        { resultImageBase64: 'data:image/png;base64,old', timestamp: 1 },
        { resultImageBase64: 'data:image/png;base64,new', timestamp: 2 },
      ],
    };
    const boxes = [{ id: 'b1', label: '主体', xmin: 10, ymin: 20, xmax: 30, ymax: 40 }];

    const next = applyDetectedBoxesToDialogMessage(message, 0, boxes);

    expect(next.versions?.[0].detectedBoxes).toEqual(boxes);
    expect(next.versions?.[1].detectedBoxes).toBeUndefined();
  });
});
