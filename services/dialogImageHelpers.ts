import type { DialogMessage, DialogMessageVersion } from '../types';

/** 与对话 UI / 生图逻辑一致：优先 versions，否则兼容旧版单图字段 */
export function dialogVersionsForMessage(message: DialogMessage): DialogMessageVersion[] {
  if (message.versions && message.versions.length > 0) return message.versions;
  if (message.resultImageBase64 || message.resultImageObjectKey) {
    return [
      {
        resultImageBase64: message.resultImageBase64,
        resultImageObjectKey: message.resultImageObjectKey,
        understoodPrompt: message.understoodPrompt,
        timestamp: message.timestamp,
      },
    ];
  }
  return [];
}

export function getDialogVersionImageDataUrl(v: DialogMessageVersion | null | undefined): string | undefined {
  return v?.resultImageBase64;
}

/** 是否可展示图片区域（已有像素数据或可从 R2 拉取） */
export function dialogVersionHasRenderableImage(v: DialogMessageVersion | null | undefined): boolean {
  return !!(v?.resultImageBase64 || v?.resultImageObjectKey);
}
