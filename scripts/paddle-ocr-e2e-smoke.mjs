#!/usr/bin/env node
/**
 * Live smoke: companion health → PUT asset → paddle_ocr job → read JSON → non-empty text.
 * Requires local companion on :18765 and PaddleOCR on :18082.
 *
 * Token: COMPANION_SHARED_TOKEN env, or pairing-config.json in desktop-shell sandbox.
 * Optional: AC_OCR_TEST_IMAGE (png with visible text), AC_OCR_TEST_LANG (default en).
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const base = (process.env.COMPANION_BASE_URL || 'http://127.0.0.1:18765').replace(/\/+$/, '');

function readToken() {
  const env = process.env.COMPANION_SHARED_TOKEN?.trim();
  if (env) return env;
  const cfg = join(
    process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
    'AssetCutterCompanion',
    'sandbox',
    'desktop-shell',
    'pairing-config.json',
  );
  if (!existsSync(cfg)) return '';
  try {
    const j = JSON.parse(readFileSync(cfg, 'utf8'));
    return String(j.sharedToken || '').trim();
  } catch {
    return '';
  }
}

function authHeaders(extra = {}) {
  const token = readToken();
  const h = { ...extra };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function j(path, init = {}) {
  const r = await fetch(`${base}${path}`, {
    ...init,
    headers: authHeaders(init.headers || {}),
  });
  const t = await r.text();
  let d;
  try {
    d = t ? JSON.parse(t) : {};
  } catch {
    d = t;
  }
  if (!r.ok) throw new Error(`${r.status} ${path} ${JSON.stringify(d)}`);
  return d;
}

function resolveTestImage() {
  if (process.env.AC_OCR_TEST_IMAGE?.trim()) {
    return process.env.AC_OCR_TEST_IMAGE.trim();
  }
  const outPath = join(tmpdir(), `ac_e2e_hello_${Date.now()}.png`);
  const py =
    process.env.COMPANION_PADDLEOCR_PYTHON?.trim() ||
    process.env.COMPANION_REMBG_PYTHON?.trim() ||
    'python';
  const code =
    "from PIL import Image,ImageDraw; im=Image.new('RGB',(320,80),'white'); d=ImageDraw.Draw(im); d.text((20,25), 'HelloOCR', fill='black'); im.save(r'" +
    outPath.replace(/\\/g, '\\\\') +
    "')";
  const r = spawnSync(py, ['-c', code], { encoding: 'utf8' });
  if (r.status !== 0 || !existsSync(outPath)) {
    throw new Error(`failed to create test PNG via ${py}: ${r.stderr || r.stdout || r.status}`);
  }
  return outPath;
}

async function main() {
  const health = await j('/v1/health');
  if (!health.ok) throw new Error('companion health not ok');

  const ocrHealth = await fetch('http://127.0.0.1:18082/health');
  const ocrBody = await ocrHealth.json();
  if (!ocrHealth.ok || !ocrBody.ok) throw new Error('paddleocr health not ok');
  console.log('ocr serverBuild', ocrBody.serverBuild);

  const probe = await j('/v1/debug/paddleocr-health');
  if (probe.ok !== true) throw new Error(`paddle probe failed: ${JSON.stringify(probe)}`);

  const stamp = Date.now();
  const projectId = `e2e-ocr-${stamp}`;
  const fileKey = `ocr-img-${stamp}-hello.png`;
  const outputKey = `ocr-result-${stamp}-json`;
  const lang = process.env.AC_OCR_TEST_LANG?.trim() || 'en';

  const imgPath = resolveTestImage();
  const buf = readFileSync(imgPath);

  await j(`/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(fileKey)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: buf,
  });

  const jobRes = await j('/v1/compute/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      protocolVersion: 1,
      type: 'paddle_ocr',
      projectId,
      inputs: { fileKey, outputKey },
      params: { pipeline: 'pp_ocr_v5', lang },
    }),
  });

  const job = jobRes.job;
  if (!job || job.status !== 'completed') {
    throw new Error(`job not completed: ${JSON.stringify(jobRes)}`);
  }

  const blobRes = await fetch(
    `${base}/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(outputKey)}`,
    { headers: authHeaders() },
  );
  if (!blobRes.ok) throw new Error(`fetch output ${blobRes.status}`);
  const raw = JSON.parse(await blobRes.text());
  const blocks = raw.result?.blocks || [];
  const text = blocks.map((b) => String(b.text || '').trim()).filter(Boolean).join('\n');
  console.log('job completed', { blockCount: blocks.length, textPreview: text.slice(0, 120) });
  if (!text.trim()) {
    throw new Error('OCR job completed but extracted text is empty');
  }

  console.log('PADDLE_OCR_E2E_OK');
}

main().catch((e) => {
  console.error('PADDLE_OCR_E2E_FAIL', e.message);
  process.exit(1);
});
