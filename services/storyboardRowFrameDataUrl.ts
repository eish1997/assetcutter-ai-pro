import type { StoryboardTableRow } from '../types';
import {
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  imageSrcToDataUrlForCompanion,
} from './workflowCompanionAssets';
import { resolveStoryboardRowFrameDisplaySrc } from './storyboardFrameImageUrl';

async function resolveRowFrameImage(
  frameImage: string,
  companionBaseUrl: string,
  companionProjectId: string
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  const trimmed = String(frameImage || '').trim();
  if (!trimmed) {
    return { ok: false, error: '当前镜头没有参考图' };
  }
  const normalized = await imageSrcToDataUrlForCompanion(trimmed);
  if (normalized) return { ok: true, dataUrl: normalized };
  if (!companionBaseUrl.trim() || !companionProjectId.trim()) {
    return { ok: false, error: '参考图无法解析，请重新上传或连接本机伴侣' };
  }
  return { ok: false, error: '参考图无法加载，请在本镜重新上传' };
}

export async function resolveStoryboardRowFrameDataUrl(
  row: StoryboardTableRow,
  companionBaseUrl: string,
  companionProjectId: string
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  const direct = String(row.frameImage || '').trim();
  if (direct) {
    return resolveRowFrameImage(direct, companionBaseUrl, companionProjectId);
  }

  const display = resolveStoryboardRowFrameDisplaySrc(row);
  if (display) {
    const normalized = await imageSrcToDataUrlForCompanion(display);
    if (normalized) return { ok: true, dataUrl: normalized };
  }

  const companionKey = String(row.frameImageCompanionKey || '').trim();
  if (companionKey) {
    const base = String(companionBaseUrl || '').trim();
    const pid = String(companionProjectId || '').trim();
    if (!base || !pid) {
      return { ok: false, error: '参考图在本地伴侣中，请连接本机伴侣后重试' };
    }
    const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, companionKey);
    if (got.ok === false) {
      return { ok: false, error: '参考图无法从伴侣加载，请重新上传' };
    }
    const resolved = await resolveRowFrameImage(got.objectUrl, base, pid);
    URL.revokeObjectURL(got.objectUrl);
    return resolved;
  }

  return { ok: false, error: '当前镜头没有参考图' };
}
