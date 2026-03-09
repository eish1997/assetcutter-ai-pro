import { useCallback, useEffect, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type RefObject, type SetStateAction } from 'react';

import { detectObjectsInImage } from '../services/geminiService';
import type { AppTask, BoundingBox, DialogMessage, DialogMessageVersion, DialogTempItem, LibraryItem } from '../types';

type DialogInputImage = { id: string; data: string };
type CropPoint = { x: number; y: number };
type DialogCropState = { messageId: string; imageBase64: string } | null;

type UseDialogPostProcessingParams = {
  dialogMessages: DialogMessage[];
  setDialogMessages: (updater: SetStateAction<DialogMessage[]>) => void;
  dialogActiveSessionIdResolved: string;
  activeSessionTitle?: string;
  modelText: string;
  addTask: (type: AppTask['type'], label: string) => string;
  updateTask: (id: string, patch: Partial<AppTask>) => void;
  addToDialogTempLibrary: (item: Omit<DialogTempItem, 'id' | 'timestamp'>) => void;
  addToLibrary: (items: Partial<LibraryItem>[]) => LibraryItem[];
  setDialogInputImages: Dispatch<SetStateAction<DialogInputImage[]>>;
  dialogEndRef: RefObject<HTMLDivElement | null>;
  dialogBoxLabels: string[];
};

function createLegacyVersion(message: DialogMessage): DialogMessageVersion[] {
  return message.resultImageBase64
    ? [{ resultImageBase64: message.resultImageBase64, understoodPrompt: message.understoodPrompt, timestamp: message.timestamp }]
    : [];
}

function probeImageDimensions(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = base64;
  });
}

function cropImageByBox(imageBase64: string, box: BoundingBox, paddingRatio = 0.08): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = imageBase64;
    img.onload = () => {
      const boxW = (box.xmax - box.xmin) / 1000;
      const boxH = (box.ymax - box.ymin) / 1000;
      const pad = Math.min(paddingRatio, 0.2);
      const sX = Math.max(0, (box.xmin / 1000) * img.width - img.width * boxW * pad);
      const sY = Math.max(0, (box.ymin / 1000) * img.height - img.height * boxH * pad);
      const sW = Math.min(img.width - sX, ((box.xmax - box.xmin) / 1000) * img.width + 2 * img.width * boxW * pad);
      const sH = Math.min(img.height - sY, ((box.ymax - box.ymin) / 1000) * img.height + 2 * img.height * boxH * pad);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, sW);
      canvas.height = Math.max(1, sH);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('No canvas context'));
        return;
      }
      ctx.drawImage(img, sX, sY, sW, sH, 0, 0, sW, sH);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Image load failed'));
  });
}

export function applyDetectedBoxesToDialogMessage(
  message: DialogMessage,
  versionIndex: number,
  boxes: BoundingBox[]
): DialogMessage {
  const versions = message.versions && message.versions.length > 0 ? [...message.versions] : createLegacyVersion(message);
  if (!versions[versionIndex]) return message;
  versions[versionIndex] = { ...versions[versionIndex], detectedBoxes: boxes };
  return { ...message, versions };
}

export function useDialogPostProcessing({
  dialogMessages,
  setDialogMessages,
  dialogActiveSessionIdResolved,
  activeSessionTitle,
  modelText,
  addTask,
  updateTask,
  addToDialogTempLibrary,
  addToLibrary,
  setDialogInputImages,
  dialogEndRef,
  dialogBoxLabels,
}: UseDialogPostProcessingParams) {
  const [dialogVersionIndex, setDialogVersionIndex] = useState<Record<string, number>>({});
  const [dialogDetectMessageId, setDialogDetectMessageId] = useState<string | null>(null);
  const [dialogDetectingId, setDialogDetectingId] = useState<string | null>(null);
  const [dialogCropState, setDialogCropState] = useState<DialogCropState>(null);
  const [dialogCropStart, setDialogCropStart] = useState<CropPoint | null>(null);
  const [dialogCropCurrent, setDialogCropCurrent] = useState<CropPoint | null>(null);
  const [dialogCropSelecting, setDialogCropSelecting] = useState(false);
  const dialogCropImgRef = useRef<HTMLImageElement>(null);

  const getDialogVersions = useCallback((message: DialogMessage) => (
    message.versions && message.versions.length > 0 ? message.versions : createLegacyVersion(message)
  ), []);

  const getDisplayVersion = useCallback((message: DialogMessage): DialogMessageVersion | null => {
    const versions = getDialogVersions(message);
    if (versions.length > 0) {
      const idx = dialogVersionIndex[message.id] ?? versions.length - 1;
      const clamped = Math.max(0, Math.min(idx, versions.length - 1));
      return versions[clamped];
    }
    return null;
  }, [dialogVersionIndex, getDialogVersions]);

  const getDialogVersionPosition = useCallback((message: DialogMessage) => {
    const versions = getDialogVersions(message);
    if (versions.length === 0) return 0;
    return dialogVersionIndex[message.id] ?? versions.length - 1;
  }, [dialogVersionIndex, getDialogVersions]);

  const showPreviousDialogVersion = useCallback((message: DialogMessage) => {
    const versions = getDialogVersions(message);
    setDialogVersionIndex((prev) => ({
      ...prev,
      [message.id]: Math.max(0, (prev[message.id] ?? versions.length - 1) - 1),
    }));
  }, [getDialogVersions]);

  const showNextDialogVersion = useCallback((message: DialogMessage) => {
    const versions = getDialogVersions(message);
    setDialogVersionIndex((prev) => ({
      ...prev,
      [message.id]: Math.min(versions.length - 1, (prev[message.id] ?? versions.length - 1) + 1),
    }));
  }, [getDialogVersions]);

  const clearDialogCropSelection = useCallback(() => {
    setDialogCropStart(null);
    setDialogCropCurrent(null);
    setDialogCropSelecting(false);
  }, []);

  useEffect(() => {
    if (!dialogCropState) return;
    clearDialogCropSelection();
  }, [clearDialogCropSelection, dialogCropState]);

  useEffect(() => {
    if (!dialogCropSelecting) return;
    const onMove = (event: MouseEvent) => setDialogCropCurrent({ x: event.clientX, y: event.clientY });
    const onUp = () => setDialogCropSelecting(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dialogCropSelecting]);

  const openDialogCrop = useCallback((messageId: string, imageBase64: string) => {
    setDialogCropState({ messageId, imageBase64 });
  }, []);

  const handleDialogCropMouseDown = useCallback((event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    setDialogCropStart({ x: event.clientX, y: event.clientY });
    setDialogCropCurrent({ x: event.clientX, y: event.clientY });
    setDialogCropSelecting(true);
  }, []);

  const handleDialogCropCancel = useCallback(() => {
    setDialogCropState(null);
    clearDialogCropSelection();
  }, [clearDialogCropSelection]);

  const handleDialogCropConfirm = useCallback(async (croppedBase64: string) => {
    if (!dialogCropState) return;
    const { messageId } = dialogCropState;
    const msg = dialogMessages.find((message) => message.id === messageId);
    if (!msg) {
      handleDialogCropCancel();
      return;
    }

    const displayVersion = getDisplayVersion(msg);
    try {
      const { width, height } = await probeImageDimensions(croppedBase64);
      const newVersion: DialogMessageVersion = {
        resultImageBase64: croppedBase64,
        understoodPrompt: displayVersion?.understoodPrompt ?? '裁切',
        timestamp: Date.now(),
        width,
        height,
      };
      setDialogMessages((prev) => prev.map((message) => {
        if (message.id !== messageId) return message;
        const versions = getDialogVersions(message);
        return { ...message, versions: [...versions, newVersion] };
      }));
      const prevLen = getDialogVersions(msg).length;
      setDialogVersionIndex((prev) => ({ ...prev, [messageId]: prevLen }));
      addToDialogTempLibrary({
        data: croppedBase64,
        sourceSessionId: dialogActiveSessionIdResolved,
        sourceMessageId: messageId,
        sourceType: 'generated',
        understoodPrompt: displayVersion?.understoodPrompt ?? '裁切',
      });
    } finally {
      handleDialogCropCancel();
    }
  }, [addToDialogTempLibrary, dialogActiveSessionIdResolved, dialogCropState, dialogMessages, getDialogVersions, getDisplayVersion, handleDialogCropCancel, setDialogMessages]);

  const handleDialogCropExecute = useCallback(() => {
    if (!dialogCropState || !dialogCropImgRef.current) return;
    const start = dialogCropStart;
    const current = dialogCropCurrent;
    if (!start || !current) {
      alert('请先在图片上拖拽选择裁切区域。');
      return;
    }

    const img = dialogCropImgRef.current;
    const rect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const x = Math.max(0, (Math.min(start.x, current.x) - rect.left) * scaleX);
    const y = Math.max(0, (Math.min(start.y, current.y) - rect.top) * scaleY);
    const w = Math.min(img.naturalWidth - x, Math.abs(current.x - start.x) * scaleX);
    const h = Math.min(img.naturalHeight - y, Math.abs(current.y - start.y) * scaleY);
    if (w < 5 || h < 5) {
      alert('请选择一个稍大的有效区域。');
      return;
    }

    const sourceImg = new Image();
    sourceImg.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(sourceImg, x, y, w, h, 0, 0, w, h);
      void handleDialogCropConfirm(canvas.toDataURL('image/png'));
    };
    sourceImg.src = dialogCropState.imageBase64;
  }, [dialogCropCurrent, dialogCropStart, dialogCropState, handleDialogCropConfirm]);

  const handleDialogSaveToLibrary = useCallback((message: DialogMessage) => {
    const displayVersion = getDisplayVersion(message);
    if (!displayVersion?.resultImageBase64) return;
    addToLibrary([{
      data: displayVersion.resultImageBase64,
      type: 'STRIP',
      category: 'PREVIEW_STRIP',
      label: `对话_${message.id.slice(0, 4)}`,
      sourceId: 'app',
    }]);
  }, [addToLibrary, getDisplayVersion]);

  const handleDialogUseAsInput = useCallback((message: DialogMessage) => {
    const displayVersion = getDisplayVersion(message);
    if (!displayVersion?.resultImageBase64) return;
    setDialogInputImages([{ id: Math.random().toString(36).slice(2, 11), data: displayVersion.resultImageBase64 }]);
    dialogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [dialogEndRef, getDisplayVersion, setDialogInputImages]);

  const handleDialogDetectObjects = useCallback(async (message: DialogMessage, forceReDetect = false) => {
    const displayVersion = getDisplayVersion(message);
    if (!displayVersion?.resultImageBase64) return;
    const targetVersionIndex = getDialogVersionPosition(message);
    if (!forceReDetect && displayVersion.detectedBoxes && displayVersion.detectedBoxes.length > 0) {
      setDialogDetectMessageId(message.id);
      return;
    }

    setDialogDetectingId(message.id);
    const taskId = addTask('DIALOG_GEN', '识别图中物体');
    try {
      updateTask(taskId, { status: 'RUNNING', progress: 50 });
      const boxes = await detectObjectsInImage(displayVersion.resultImageBase64, modelText);
      setDialogMessages((prev) => prev.map((entry) => {
        if (entry.id !== message.id) return entry;
        return applyDetectedBoxesToDialogMessage(entry, targetVersionIndex, boxes);
      }));
      setDialogDetectMessageId(message.id);
      updateTask(taskId, { status: 'SUCCESS', progress: 100 });
    } catch (err: any) {
      updateTask(taskId, { status: 'FAILED', error: err.message });
    } finally {
      setDialogDetectingId(null);
    }
  }, [addTask, getDialogVersionPosition, getDisplayVersion, modelText, setDialogMessages, updateTask]);

  const handleDialogDetectClose = useCallback(() => setDialogDetectMessageId(null), []);

  const handleDialogDownloadCropByIndex = useCallback(async (message: DialogMessage, index: number) => {
    const displayVersion = getDisplayVersion(message);
    if (!displayVersion?.resultImageBase64 || !displayVersion.detectedBoxes?.[index]) return;
    try {
      const dataUrl = await cropImageByBox(displayVersion.resultImageBase64, displayVersion.detectedBoxes[index]);
      const anchor = document.createElement('a');
      anchor.href = dataUrl;
      const label = dialogBoxLabels[index] ?? `${index + 1}`;
      const title = (activeSessionTitle || '对话').replace(/[/\\?*:|"]/g, '_');
      const d = new Date(message.timestamp);
      const timeStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}`;
      anchor.download = `${title}_${label}_${timeStr}.png`;
      anchor.click();
    } catch {
      /* ignore crop export failure */
    }
  }, [activeSessionTitle, dialogBoxLabels, getDisplayVersion]);

  const handleDialogDownloadAllCrops = useCallback(async (message: DialogMessage) => {
    const displayVersion = getDisplayVersion(message);
    if (!displayVersion?.resultImageBase64 || !displayVersion.detectedBoxes?.length) return;
    for (let i = 0; i < displayVersion.detectedBoxes.length; i++) {
      await handleDialogDownloadCropByIndex(message, i);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }, [getDisplayVersion, handleDialogDownloadCropByIndex]);

  const handleDialogTempAddCropByIndex = useCallback(async (message: DialogMessage, index: number) => {
    const displayVersion = getDisplayVersion(message);
    if (!displayVersion?.resultImageBase64 || !displayVersion.detectedBoxes?.[index]) return;
    try {
      const dataUrl = await cropImageByBox(displayVersion.resultImageBase64, displayVersion.detectedBoxes[index]);
      const label = dialogBoxLabels[index] ?? `${index + 1}`;
      addToDialogTempLibrary({
        data: dataUrl,
        sourceSessionId: dialogActiveSessionIdResolved,
        sourceMessageId: message.id,
        sourceType: 'object_crop',
        label,
      });
    } catch {
      /* ignore temp crop failure */
    }
  }, [addToDialogTempLibrary, dialogActiveSessionIdResolved, dialogBoxLabels, getDisplayVersion]);

  const handleDialogTempAddAllCrops = useCallback(async (message: DialogMessage) => {
    const displayVersion = getDisplayVersion(message);
    if (!displayVersion?.resultImageBase64 || !displayVersion.detectedBoxes?.length) return;
    for (let i = 0; i < displayVersion.detectedBoxes.length; i++) {
      await handleDialogTempAddCropByIndex(message, i);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, [getDisplayVersion, handleDialogTempAddCropByIndex]);

  return {
    dialogVersionIndex,
    setDialogVersionIndex,
    dialogDetectMessageId,
    dialogDetectingId,
    dialogCropState,
    dialogCropStart,
    dialogCropCurrent,
    dialogCropImgRef,
    getDisplayVersion,
    getDialogVersions,
    getDialogVersionPosition,
    showPreviousDialogVersion,
    showNextDialogVersion,
    openDialogCrop,
    handleDialogCropMouseDown,
    handleDialogCropExecute,
    handleDialogCropCancel,
    handleDialogSaveToLibrary,
    handleDialogUseAsInput,
    handleDialogDetectObjects,
    handleDialogDetectClose,
    handleDialogDownloadCropByIndex,
    handleDialogDownloadAllCrops,
    handleDialogTempAddCropByIndex,
    handleDialogTempAddAllCrops,
  };
}
