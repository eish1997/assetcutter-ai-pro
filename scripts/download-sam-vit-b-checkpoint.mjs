#!/usr/bin/env node
/**
 * 下载 Meta Segment Anything ViT-B 检查点到 SamLocal/checkpoints/（约 375MB）。
 * 用法：node scripts/download-sam-vit-b-checkpoint.mjs [--force] [--sam-local-root=DIR]
 */
import { createWriteStream } from 'fs';
import { mkdir, stat, unlink, rename } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';

const SAM_VIT_B_URL = 'https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth';
const CHECKPOINT_FILENAME = 'sam_vit_b_01ec64.pth';
/** 官方文件约 375MB；低于此视为不完整或损坏，允许重下 */
const MIN_VALID_BYTES = 350 * 1024 * 1024;

function parseArgs(argv) {
  let force = false;
  let samLocalRoot = null;
  for (const a of argv) {
    if (a === '--force') force = true;
    else if (a.startsWith('--sam-local-root=')) samLocalRoot = a.slice('--sam-local-root='.length);
  }
  return { force, samLocalRoot };
}

function progressReporter() {
  const step = 25 * 1024 * 1024;
  let next = step;
  let received = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      while (received >= next) {
        process.stdout.write(`…已接收约 ${Math.round(next / 1024 / 1024)} MiB\r`);
        next += step;
      }
      cb(null, chunk);
    },
    flush(cb) {
      process.stdout.write(`\n`);
      cb();
    },
  });
}

export async function downloadSamVitBCheckpoint(options) {
  const { force = false, samLocalRoot: rootOpt } = options;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, '..');
  const samLocalRoot = rootOpt ? path.resolve(rootOpt) : path.join(repoRoot, 'SamLocal');
  const checkpointsDir = path.join(samLocalRoot, 'checkpoints');
  const dest = path.join(checkpointsDir, CHECKPOINT_FILENAME);

  await mkdir(checkpointsDir, { recursive: true });

  try {
    const st = await stat(dest);
    if (!force && st.size >= MIN_VALID_BYTES) {
      console.log(
        `[sam-checkpoint] 已存在且大小合理（${Math.round(st.size / 1024 / 1024)} MiB），跳过下载。使用 --force 可强制重下。`,
      );
      return { skipped: true, dest, bytes: st.size };
    }
    await unlink(dest);
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
  }

  console.log(`[sam-checkpoint] 下载 ${SAM_VIT_B_URL}`);
  console.log(`[sam-checkpoint] 目标 ${dest}`);

  const res = await fetch(SAM_VIT_B_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const body = res.body;
  if (!body) throw new Error('响应无 body');

  const tmp = `${dest}.partial`;
  try {
    await unlink(tmp);
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
  }

  const webStream = Readable.fromWeb(body);
  try {
    await pipeline(webStream, progressReporter(), createWriteStream(tmp));
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }

  const finalSt = await stat(tmp);
  if (finalSt.size < MIN_VALID_BYTES) {
    await unlink(tmp).catch(() => {});
    throw new Error(
      `下载文件过小（${finalSt.size} 字节），可能网络中断。请检查网络后加 --force 重试。`,
    );
  }

  await rename(tmp, dest);
  console.log(`[sam-checkpoint] 完成 ${Math.round(finalSt.size / 1024 / 1024)} MiB → ${dest}`);
  return { skipped: false, dest, bytes: finalSt.size };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const { force, samLocalRoot } = parseArgs(process.argv.slice(2));
  downloadSamVitBCheckpoint({ force, samLocalRoot })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[sam-checkpoint]', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
