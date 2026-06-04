/**
 * 分镜批量导入：经本地伴侣 PaddleOCR 从 PDF / 图片提取文本。
 */

import {
  runCompanionDocumentImport,
  runCompanionImageOcr,
  type CompanionOcrBlockV1,
} from './companionOcr';
import { companionOcrAssetKey } from './companionOcrKeys';
import { getCompanionLocalBaseUrl, normalizeCompanionBaseUrl } from './companionLocalPrefs';
import { probeCompanionPaddleOcrHealth } from './companionClient';

function blocksToPlainText(blocks: CompanionOcrBlockV1[]): string {
  return blocks
    .map((b) => String(b.text || '').trim())
    .filter(Boolean)
    .join('\n');
}

function isPdfFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type === 'application/pdf' || name.endsWith('.pdf');
}

export async function probeStoryboardCompanionOcrReady(
  companionBaseUrl?: string,
  companionProjectId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = normalizeCompanionBaseUrl((companionBaseUrl || getCompanionLocalBaseUrl()).trim());
  const pid = String(companionProjectId || '').trim();
  if (!base) return { ok: false, error: '未配置本地伴侣地址' };
  if (!pid) return { ok: false, error: '未选择工作区项目（伴侣 Volume 需要 projectId）' };
  const probe = await probeCompanionPaddleOcrHealth(base);
  if (probe.ok === false) {
    return { ok: false, error: probe.error || '无法连接本地伴侣' };
  }
  const body = probe.body as
    | { ok?: boolean; error?: string; paddleOcr?: { ok?: boolean; error?: string } }
    | undefined;
  if (body?.ok === true) return { ok: true };
  const err =
    body?.error ||
    body?.paddleOcr?.error ||
    'PaddleOCR 未就绪：请在桌面伴侣中一键安装 OCR，并确认本机引擎运行中';
  return { ok: false, error: err };
}

export async function importStoryboardTextFromCompanionFile(opts: {
  projectId: string;
  file: File;
  companionBaseUrl?: string;
}): Promise<
  | { ok: true; text: string; source: 'pdf' | 'image'; blockCount?: number }
  | { ok: false; error: string; code?: string }
> {
  const pid = String(opts.projectId || '').trim();
  if (!pid) return { ok: false, error: '未选择工作区项目', code: 'NO_PROJECT' };

  const base = normalizeCompanionBaseUrl((opts.companionBaseUrl || getCompanionLocalBaseUrl()).trim());
  const ready = await probeStoryboardCompanionOcrReady(base, pid);
  if (!ready.ok) return { ok: false, error: ready.error, code: 'PADDLEOCR_NOT_READY' };

  const stamp = Date.now();
  const safeName = opts.file.name.replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'upload';

  if (isPdfFile(opts.file)) {
    const res = await runCompanionDocumentImport({
      projectId: pid,
      fileBlob: opts.file,
      fileName: opts.file.name,
      fileKey: companionOcrAssetKey('pdf', stamp, safeName),
      outputKey: companionOcrAssetKey('result', stamp, 'json'),
      markdownOutputKey: companionOcrAssetKey('markdown', stamp, 'md'),
      companionBaseUrl: base,
    });
    if (res.ok === false) return res;
    const text = (res.markdown || '').trim();
    if (!text) {
      return { ok: false, error: 'PDF 解析完成但未提取到文本', code: 'EMPTY_OCR' };
    }
    return { ok: true, text, source: 'pdf' };
  }

  const res = await runCompanionImageOcr({
    projectId: pid,
    fileBlob: opts.file,
    fileName: opts.file.name,
    fileKey: companionOcrAssetKey('img', stamp, safeName),
    outputKey: companionOcrAssetKey('result', stamp, 'json'),
    companionBaseUrl: base,
  });
  if (res.ok === false) return res;
  const text = blocksToPlainText(res.blocks);
  if (!text) {
    return { ok: false, error: '图片 OCR 完成但未识别到文字', code: 'EMPTY_OCR' };
  }
  return { ok: true, text, source: 'image', blockCount: res.blocks.length };
}
