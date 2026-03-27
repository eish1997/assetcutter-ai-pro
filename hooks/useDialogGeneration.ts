import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import {
  DEFAULT_PROMPTS,
  dialogGenerateImage,
  dialogGenerateImageMulti,
  generateSessionTitle,
  getDialogTextResponse,
  getEditPrompt,
  normalizeApiErrorMessage,
  understandImageEditIntent,
} from '../services/geminiService';
import type {
  AppTask,
  DialogMessage,
  DialogMessageVersion,
  DialogSession,
  DialogTempItem,
  GenerationRecord,
  SystemConfig,
} from '../types';

type DialogInputImage = { id: string; data: string; fromTemp?: boolean };

type UseDialogGenerationParams = {
  dialogSessionIds: string[];
  dialogInputText: string;
  setDialogInputText: Dispatch<SetStateAction<string>>;
  dialogInputImages: DialogInputImage[];
  setDialogInputImages: Dispatch<SetStateAction<DialogInputImage[]>>;
  dialogMessages: DialogMessage[];
  setDialogMessages: (updater: SetStateAction<DialogMessage[]>) => void;
  dialogAutoGenerateImage: boolean;
  dialogModel: string;
  dialogAspectRatio: string;
  dialogImageSize: string;
  dialogActiveSessionIdResolved: string;
  activeSessionTitle?: string;
  config: SystemConfig;
  updateDialogSession: (sessionId: string, updater: (session: DialogSession) => DialogSession) => void;
  addToDialogTempLibrary: (item: Omit<DialogTempItem, 'id' | 'timestamp'>) => void;
  setDialogValidationError: Dispatch<SetStateAction<string | null>>;
  setDialogVersionIndex: Dispatch<SetStateAction<Record<string, number>>>;
  setDialogEditingMessageId: Dispatch<SetStateAction<string | null>>;
  addTask: (type: AppTask['type'], label: string) => string;
  updateTask: (id: string, patch: Partial<AppTask>) => void;
  addGlobalLog: (source: string, level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  addGenerationRecord: (record: Omit<GenerationRecord, 'id'>) => GenerationRecord;
};

function createDialogMessageId() {
  return Math.random().toString(36).substr(2, 9);
}

export function getDialogMessageImages(message: DialogMessage): string[] {
  if (message.inputImages && message.inputImages.length > 0) return message.inputImages;
  if (message.imageBase64) return [message.imageBase64];
  return [];
}

export function getDialogUnderstandImageInput(sourceImages: string[]): string | string[] | null {
  if (sourceImages.length > 1) return sourceImages;
  return sourceImages[0] ?? null;
}

export function buildDialogContents(messages: DialogMessage[], text: string, sourceImages: string[]) {
  const contents: Array<{
    role: 'user' | 'model';
    parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
  }> = [];

  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (message.role === 'user') {
      for (const image of getDialogMessageImages(message)) {
        const data = image.split(',')[1] || image;
        parts.push({ inlineData: { mimeType: 'image/jpeg', data } });
      }
    }
    parts.push({ text: message.text });
    contents.push({ role, parts });
  }

  const lastUserParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text }];
  for (let i = sourceImages.length - 1; i >= 0; i--) {
    const data = sourceImages[i].split(',')[1] || sourceImages[i];
    lastUserParts.unshift({ inlineData: { mimeType: 'image/jpeg', data } });
  }
  contents.push({ role: 'user', parts: lastUserParts });
  return contents;
}

function getImageDimensions(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = base64;
  });
}

export function useDialogGeneration({
  dialogSessionIds,
  dialogInputText,
  setDialogInputText,
  dialogInputImages,
  setDialogInputImages,
  dialogMessages,
  setDialogMessages,
  dialogAutoGenerateImage,
  dialogModel,
  dialogAspectRatio,
  dialogImageSize,
  dialogActiveSessionIdResolved,
  activeSessionTitle,
  config,
  updateDialogSession,
  addToDialogTempLibrary,
  setDialogValidationError,
  setDialogVersionIndex,
  setDialogEditingMessageId,
  addTask,
  updateTask,
  addGlobalLog,
  addGenerationRecord,
}: UseDialogGenerationParams) {
  const [dialogSendingSessionIds, setDialogSendingSessionIds] = useState<string[]>([]);
  const [dialogRegeneratingId, setDialogRegeneratingId] = useState<string | null>(null);
  const [dialogGeneratingFromUnderstoodId, setDialogGeneratingFromUnderstoodId] = useState<string | null>(null);
  const dialogCancelledSessionsRef = useRef<Record<string, boolean>>({});
  const dialogAbortControllersRef = useRef<Record<string, AbortController | null>>({});
  const dialogSessionIdsRef = useRef<Set<string>>(new Set(dialogSessionIds));

  useEffect(() => {
    dialogSessionIdsRef.current = new Set(dialogSessionIds);
  }, [dialogSessionIds]);

  const isDialogSessionAlive = useCallback((sid: string) => dialogSessionIdsRef.current.has(sid), []);

  const isDialogCancelled = useCallback((sid: string) => {
    if (!isDialogSessionAlive(sid)) return true;
    return dialogCancelledSessionsRef.current[sid] === true;
  }, [isDialogSessionAlive]);

  const setDialogCancelled = useCallback((sid: string, cancelled: boolean) => {
    dialogCancelledSessionsRef.current[sid] = cancelled;
  }, []);

  const setDialogAbortController = useCallback((sid: string, controller: AbortController | null) => {
    dialogAbortControllersRef.current[sid] = controller;
  }, []);

  const resolveImageOptions = useCallback(() => {
    if (dialogAspectRatio === 'adaptive') {
      return { imageSize: dialogImageSize };
    }
    return { aspectRatio: dialogAspectRatio, imageSize: dialogImageSize };
  }, [dialogAspectRatio, dialogImageSize]);

  const appendAssistantMessage = useCallback((message: DialogMessage) => {
    setDialogMessages((prev) => [...prev, message]);
  }, [setDialogMessages]);

  const appendCancelMessage = useCallback(() => {
    appendAssistantMessage({
      id: createDialogMessageId(),
      role: 'assistant',
      text: '生成已取消。',
      timestamp: Date.now(),
    });
  }, [appendAssistantMessage]);

  const appendFailureMessage = useCallback((message: string) => {
    appendAssistantMessage({
      id: createDialogMessageId(),
      role: 'assistant',
      text: message,
      timestamp: Date.now(),
    });
  }, [appendAssistantMessage]);

  const probeImageSize = useCallback(async (resultImage: string) => {
    try {
      return await getImageDimensions(resultImage);
    } catch {
      return { width: undefined, height: undefined };
    }
  }, []);

  const finalizeGeneratedMessage = useCallback(async ({
    sid,
    assistantText,
    resultImage,
    understood,
    userPrompt,
    fullPromptTemplate,
    sourceMessageId,
    versionIndex = 0,
  }: {
    sid: string;
    assistantText: string;
    resultImage: string;
    understood: string;
    userPrompt: string;
    fullPromptTemplate: string;
    sourceMessageId?: string;
    versionIndex?: number;
  }) => {
    if (!isDialogSessionAlive(sid) || isDialogCancelled(sid)) return false;
    const { width, height } = await probeImageSize(resultImage);
    if (!isDialogSessionAlive(sid) || isDialogCancelled(sid)) return false;
    const assistantMsg: DialogMessage = {
      id: sourceMessageId ?? createDialogMessageId(),
      role: 'assistant',
      text: assistantText,
      timestamp: Date.now(),
      versions: [{ resultImageBase64: resultImage, understoodPrompt: understood, timestamp: Date.now(), width, height }],
    };
    const imageOptions = resolveImageOptions();
    const fullPrompt = getEditPrompt(understood, fullPromptTemplate);
    const genRecord = addGenerationRecord({
      source: 'dialog',
      timestamp: Date.now(),
      fullPrompt,
      instruction: understood,
      userPrompt,
      outputImageRef: { type: 'dialogRef', value: `${sid}:${assistantMsg.id}:${versionIndex}` },
      sessionId: sid,
      messageId: assistantMsg.id,
      versionIndex,
      model: dialogModel,
      options: imageOptions ? { aspectRatio: imageOptions.aspectRatio ?? '', imageSize: imageOptions.imageSize ?? '' } : undefined,
    });
    assistantMsg.versions![0].generationRecordId = genRecord.id;

    if (sourceMessageId) {
      const newVersion: DialogMessageVersion = {
        resultImageBase64: resultImage,
        understoodPrompt: understood,
        timestamp: assistantMsg.timestamp,
        width,
        height,
        generationRecordId: genRecord.id,
      };
      setDialogMessages((prev) => prev.map((message) => {
        if (message.id !== sourceMessageId) return message;
        const prevVersions = message.versions ?? (
          message.resultImageBase64
            ? [{ resultImageBase64: message.resultImageBase64, understoodPrompt: message.understoodPrompt, timestamp: message.timestamp }]
            : []
        );
        return { ...message, text: assistantText, versions: [...prevVersions, newVersion] };
      }));
      setDialogVersionIndex((prev) => ({ ...prev, [sourceMessageId]: versionIndex }));
    } else {
      appendAssistantMessage(assistantMsg);
    }

    if (isDialogSessionAlive(sid) && !isDialogCancelled(sid)) {
      addToDialogTempLibrary({
        data: resultImage,
        sourceSessionId: sid,
        sourceMessageId: assistantMsg.id,
        sourceType: 'generated',
        userPrompt,
        understoodPrompt: understood,
      });
    }
    return true;
  }, [addGenerationRecord, addToDialogTempLibrary, appendAssistantMessage, dialogModel, isDialogCancelled, isDialogSessionAlive, probeImageSize, resolveImageOptions, setDialogMessages, setDialogVersionIndex]);

  const handleDialogCancelGen = useCallback((sid = dialogActiveSessionIdResolved) => {
    if (!sid) return;
    setDialogCancelled(sid, true);
    const controller = dialogAbortControllersRef.current[sid];
    if (controller) {
      controller.abort();
      setDialogAbortController(sid, null);
    }
  }, [dialogActiveSessionIdResolved, setDialogAbortController, setDialogCancelled]);

  const startImageGeneration = useCallback(async ({
    sid,
    sourceImages,
    understood,
    promptTemplate,
  }: {
    sid: string;
    sourceImages: string[];
    understood: string;
    promptTemplate?: string;
  }) => {
    const genController = new AbortController();
    setDialogAbortController(sid, genController);
    try {
      if (sourceImages.length > 1) {
        return await dialogGenerateImageMulti(
          sourceImages,
          understood,
          dialogModel,
          resolveImageOptions(),
          genController.signal
        );
      }
      return await dialogGenerateImage(
        sourceImages[0] ?? null,
        understood,
        dialogModel,
        resolveImageOptions(),
        promptTemplate,
        genController.signal
      );
    } finally {
      setDialogAbortController(sid, null);
    }
  }, [dialogModel, resolveImageOptions, setDialogAbortController]);

  const updateGeneratedSessionTitle = useCallback((sid: string, text: string, firstImage?: string) => {
    if (activeSessionTitle) return;
    generateSessionTitle(text, config.modelText, undefined, firstImage).then((title) => {
      const trimmed = (title || '').trim().slice(0, 8);
      if (!trimmed) return;
      updateDialogSession(sid, (session) => ({
        ...session,
        title: session.title || trimmed,
      }));
    }).catch(() => {});
  }, [activeSessionTitle, config.modelText, updateDialogSession]);

  const handleDialogSend = useCallback(async () => {
    const text = dialogInputText.trim();
    setDialogValidationError(null);
    if (!text) return;
    if (dialogInputImages.length === 0) {
      setDialogValidationError(null);
    }

    const sid = dialogActiveSessionIdResolved;
    if (!sid || dialogSendingSessionIds.includes(sid)) return;

    setDialogSendingSessionIds((prev) => [...prev, sid]);
    const sourceImages = dialogInputImages.map((image) => image.data).filter(Boolean);
    const firstImage = sourceImages[0] ?? null;
    const userMsg: DialogMessage = {
      id: createDialogMessageId(),
      role: 'user',
      text,
      imageBase64: firstImage ?? undefined,
      inputImages: sourceImages.length > 0 ? sourceImages : undefined,
      timestamp: Date.now(),
    };
    setDialogMessages((prev) => [...prev, userMsg]);
    for (const image of dialogInputImages) {
      if (image.fromTemp) continue;
      addToDialogTempLibrary({
        data: image.data,
        sourceSessionId: sid,
        sourceMessageId: userMsg.id,
        sourceType: 'user_input',
        userPrompt: text,
      });
    }
    setDialogInputText('');
    setDialogInputImages([]);
    updateGeneratedSessionTitle(sid, text, firstImage ?? undefined);

    setDialogCancelled(sid, false);
    const taskId = addTask('DIALOG_GEN', '对话');
    try {
      updateTask(taskId, { status: 'RUNNING', progress: 20 });
      const { instruction: understood, shouldGenerateImage } = await understandImageEditIntent(
        getDialogUnderstandImageInput(sourceImages),
        text,
        config.modelText,
        config.prompts.dialog_understand
      );
      addGlobalLog('对话', 'info', '理解完成', shouldGenerateImage ? (firstImage ? '需要生图' : '需要生图') : (firstImage ? '仅描述/问答' : '仅文字对话'));

      if (isDialogCancelled(sid)) {
        updateTask(taskId, { status: 'FAILED', error: '已取消' });
        if (isDialogSessionAlive(sid)) appendCancelMessage();
        return;
      }

      if (!shouldGenerateImage) {
        updateTask(taskId, { status: 'RUNNING', progress: 40 });
        const reply = await getDialogTextResponse(buildDialogContents(dialogMessages, text, sourceImages), config.modelText);
        if (isDialogCancelled(sid)) {
          updateTask(taskId, { status: 'FAILED', error: '已取消' });
          if (isDialogSessionAlive(sid)) appendCancelMessage();
          return;
        }
        updateTask(taskId, { status: 'SUCCESS', progress: 100 });
        if (firstImage) {
          addGlobalLog('对话', 'info', '图文问答回复完成', undefined);
        }
        appendAssistantMessage({
          id: createDialogMessageId(),
          role: 'assistant',
          text: reply,
          timestamp: Date.now(),
        });
        return;
      }

      if (!dialogAutoGenerateImage) {
        updateTask(taskId, { status: 'SUCCESS', progress: 100 });
        appendAssistantMessage({
          id: createDialogMessageId(),
          role: 'assistant',
          text: `理解结果：${understood}`,
          understoodPrompt: understood,
          timestamp: Date.now(),
        });
        return;
      }

      updateTask(taskId, { progress: 50 });
      if (firstImage) {
        addGlobalLog('对话', 'info', '调用生图模型', dialogModel);
      }
      const resultImage = await startImageGeneration({
        sid,
        sourceImages,
        understood,
        promptTemplate: sourceImages.length === 1 && firstImage ? config.prompts.edit : undefined,
      });
      if (isDialogCancelled(sid)) {
        updateTask(taskId, { status: 'FAILED', error: '已取消' });
        if (isDialogSessionAlive(sid)) appendCancelMessage();
        return;
      }

      const finalized = await finalizeGeneratedMessage({
        sid,
        assistantText: firstImage ? '已根据你的需求生成图片。' : '已根据你的描述生成图片。',
        resultImage,
        understood,
        userPrompt: text,
        fullPromptTemplate: firstImage ? config.prompts.edit : DEFAULT_PROMPTS.dialog_text_to_image,
      });
      updateTask(taskId, finalized ? { status: 'SUCCESS', progress: 100 } : { status: 'FAILED', error: '会话已关闭' });
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError' || isDialogCancelled(sid);
      if (isAbort) {
        updateTask(taskId, { status: 'FAILED', error: '已取消' });
        if (isDialogSessionAlive(sid)) appendCancelMessage();
      } else if (!isDialogCancelled(sid)) {
        const errMsg = normalizeApiErrorMessage(err);
        updateTask(taskId, { status: 'FAILED', error: errMsg });
        if (isDialogSessionAlive(sid)) appendFailureMessage(`生成失败: ${errMsg}`);
      }
    } finally {
      setDialogSendingSessionIds((prev) => prev.filter((id) => id !== sid));
    }
  }, [
    addGlobalLog,
    addTask,
    addToDialogTempLibrary,
    appendAssistantMessage,
    appendCancelMessage,
    appendFailureMessage,
    config.modelText,
    config.prompts.dialog_understand,
    config.prompts.edit,
    dialogActiveSessionIdResolved,
    dialogAutoGenerateImage,
    dialogInputImages,
    dialogInputText,
    dialogMessages,
    dialogModel,
    dialogSendingSessionIds,
    finalizeGeneratedMessage,
    isDialogCancelled,
    isDialogSessionAlive,
    setDialogInputImages,
    setDialogInputText,
    setDialogMessages,
    setDialogValidationError,
    setDialogCancelled,
    startImageGeneration,
    updateGeneratedSessionTitle,
    updateTask,
  ]);

  const runDialogRegenerate = useCallback(async (userMsg: DialogMessage, instructionText: string, assistantMsgId: string) => {
    const sid = dialogActiveSessionIdResolved;
    setDialogCancelled(sid, false);
    setDialogRegeneratingId(assistantMsgId);
    const taskId = addTask('DIALOG_GEN', '对话');
    const sourceImages = getDialogMessageImages(userMsg);
    const sourceImage = sourceImages[0] ?? null;

    try {
      updateTask(taskId, { status: 'RUNNING', progress: 20 });
      const { instruction: understood } = await understandImageEditIntent(
        getDialogUnderstandImageInput(sourceImages),
        instructionText,
        config.modelText,
        config.prompts.dialog_understand
      );
      if (isDialogCancelled(sid)) {
        updateTask(taskId, { status: 'FAILED', error: '已取消' });
        setDialogMessages((prev) => prev.map((message) => message.id === assistantMsgId ? { ...message, text: '已取消。' } : message));
        return;
      }

      updateTask(taskId, { progress: 50 });
      const resultImage = await startImageGeneration({
        sid,
        sourceImages,
        understood,
        promptTemplate: sourceImages.length === 1 && sourceImage ? config.prompts.edit : undefined,
      });
      if (isDialogCancelled(sid)) {
        updateTask(taskId, { status: 'FAILED', error: '已取消' });
        setDialogMessages((prev) => prev.map((message) => message.id === assistantMsgId ? { ...message, text: '已取消。' } : message));
        return;
      }

      const currentMsg = dialogMessages.find((message) => message.id === assistantMsgId);
      const prevVersionsForIndex = currentMsg?.versions ?? (
        currentMsg?.resultImageBase64
          ? [{ resultImageBase64: currentMsg.resultImageBase64, understoodPrompt: currentMsg.understoodPrompt, timestamp: currentMsg.timestamp }]
          : []
      );
      const newVersionIndex = prevVersionsForIndex.length;
      const finalized = await finalizeGeneratedMessage({
        sid,
        assistantText: '已根据你的需求生成图片。',
        resultImage,
        understood,
        userPrompt: instructionText,
        fullPromptTemplate: sourceImage ? config.prompts.edit : DEFAULT_PROMPTS.dialog_text_to_image,
        sourceMessageId: assistantMsgId,
        versionIndex: newVersionIndex,
      });
      updateTask(taskId, finalized ? { status: 'SUCCESS', progress: 100 } : { status: 'FAILED', error: '会话已关闭' });
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError' || isDialogCancelled(sid);
      if (isAbort) {
        updateTask(taskId, { status: 'FAILED', error: '已取消' });
        setDialogMessages((prev) => prev.map((message) => message.id === assistantMsgId ? { ...message, text: '已取消。' } : message));
      } else if (!isDialogCancelled(sid)) {
        const errMsg = normalizeApiErrorMessage(err);
        updateTask(taskId, { status: 'FAILED', error: errMsg });
        setDialogMessages((prev) => prev.map((message) =>
          message.id === assistantMsgId ? { ...message, text: `重新生成失败: ${errMsg}` } : message
        ));
      }
    } finally {
      setDialogRegeneratingId(null);
      setDialogEditingMessageId(null);
    }
  }, [
    addTask,
    config.modelText,
    config.prompts.dialog_understand,
    config.prompts.edit,
    dialogActiveSessionIdResolved,
    dialogMessages,
    finalizeGeneratedMessage,
    isDialogCancelled,
    setDialogEditingMessageId,
    setDialogMessages,
    setDialogCancelled,
    startImageGeneration,
    updateTask,
  ]);

  const handleDialogGenerateFromUnderstood = useCallback(async (assistantMsgId: string) => {
    const idx = dialogMessages.findIndex((message) => message.id === assistantMsgId);
    if (idx <= 0) return;

    const assistantMsg = dialogMessages[idx];
    const userMsg = dialogMessages[idx - 1];
    if (assistantMsg.role !== 'assistant' || !assistantMsg.understoodPrompt || userMsg.role !== 'user') {
      return;
    }
    const sourceImages = getDialogMessageImages(userMsg);

    const sid = dialogActiveSessionIdResolved;
    setDialogCancelled(sid, false);
    setDialogGeneratingFromUnderstoodId(assistantMsgId);
    const taskId = addTask('DIALOG_GEN', '对话');
    try {
      updateTask(taskId, { status: 'RUNNING', progress: 50 });
      const resultImage = await startImageGeneration({
        sid,
        sourceImages,
        understood: assistantMsg.understoodPrompt,
        promptTemplate: sourceImages.length === 1 && userMsg.imageBase64 ? config.prompts.edit : undefined,
      });
      if (isDialogCancelled(sid)) {
        updateTask(taskId, { status: 'FAILED', error: '已取消' });
        setDialogMessages((prev) => prev.map((message) => message.id === assistantMsgId ? { ...message, text: '已取消。' } : message));
        return;
      }
      const finalized = await finalizeGeneratedMessage({
        sid,
        assistantText: sourceImages.length > 0 ? '已根据你的需求生成图片。' : '已根据你的描述生成图片。',
        resultImage,
        understood: assistantMsg.understoodPrompt,
        userPrompt: userMsg.text,
        fullPromptTemplate: sourceImages.length > 0 ? config.prompts.edit : DEFAULT_PROMPTS.dialog_text_to_image,
        sourceMessageId: assistantMsgId,
        versionIndex: 0,
      });
      updateTask(taskId, finalized ? { status: 'SUCCESS', progress: 100 } : { status: 'FAILED', error: '会话已关闭' });
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError' || isDialogCancelled(sid);
      if (isAbort) {
        updateTask(taskId, { status: 'FAILED', error: '已取消' });
        setDialogMessages((prev) => prev.map((message) => message.id === assistantMsgId ? { ...message, text: '已取消。' } : message));
      } else {
        const errMsg = normalizeApiErrorMessage(err);
        updateTask(taskId, { status: 'FAILED', error: errMsg });
        setDialogMessages((prev) => prev.map((message) => message.id === assistantMsgId ? { ...message, text: `生成失败: ${errMsg}` } : message));
      }
    } finally {
      setDialogGeneratingFromUnderstoodId(null);
    }
  }, [
    addTask,
    config.prompts.edit,
    dialogActiveSessionIdResolved,
    dialogMessages,
    finalizeGeneratedMessage,
    isDialogCancelled,
    setDialogMessages,
    setDialogCancelled,
    startImageGeneration,
    updateTask,
  ]);

  const handleDialogRegenerate = useCallback((assistantMsgId: string) => {
    const idx = dialogMessages.findIndex((message) => message.id === assistantMsgId);
    if (idx <= 0) return;
    const userMsg = dialogMessages[idx - 1];
    if (userMsg.role !== 'user') return;
    void runDialogRegenerate(userMsg, userMsg.text, assistantMsgId);
  }, [dialogMessages, runDialogRegenerate]);

  const handleDialogEditThenRegenerate = useCallback((assistantMsgId: string, editedText: string) => {
    const trimmed = editedText.trim();
    if (!trimmed) return;
    const idx = dialogMessages.findIndex((message) => message.id === assistantMsgId);
    if (idx <= 0) return;
    const userMsg = dialogMessages[idx - 1];
    if (userMsg.role !== 'user' || getDialogMessageImages(userMsg).length === 0) return;
    void runDialogRegenerate(userMsg, trimmed, assistantMsgId);
  }, [dialogMessages, runDialogRegenerate]);

  return {
    dialogSendingSessionIds,
    dialogRegeneratingId,
    dialogGeneratingFromUnderstoodId,
    handleDialogSend,
    handleDialogCancelGen,
    handleDialogGenerateFromUnderstood,
    handleDialogRegenerate,
    handleDialogEditThenRegenerate,
  };
}
