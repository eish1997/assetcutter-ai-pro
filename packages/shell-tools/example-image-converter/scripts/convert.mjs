#!/usr/bin/env node
/**
 * 示例：读取 TOOL_PARAM_* 环境变量，枚举目录内图片并输出进度。
 * 首版不捆绑 sharp；仅演示 params 注入与日志协议。P1+ 可替换为真实转换。
 */
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif']);

function envParam(name) {
  return process.env[name]?.trim() || '';
}

const sourceDir = envParam('TOOL_PARAM_SOURCE_DIR');
const format = envParam('TOOL_PARAM_FORMAT') || 'webp';

if (!sourceDir) {
  console.error('缺少 TOOL_PARAM_SOURCE_DIR');
  process.exit(1);
}

console.log(`[image-format-converter] 源目录: ${sourceDir}`);
console.log(`[image-format-converter] 目标格式: ${format}`);
console.log('[image-format-converter] 注意：示例包仅枚举文件；真实转换将在后续版本接入。');

let entries;
try {
  entries = await readdir(sourceDir, { withFileTypes: true });
} catch (e) {
  console.error(`无法读取目录: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

const images = entries.filter((e) => e.isFile() && IMAGE_EXT.has(extname(e.name).toLowerCase()));
console.log(`找到 ${images.length} 个图片文件`);

for (const ent of images) {
  const full = join(sourceDir, ent.name);
  console.log(`  · ${ent.name} → ${format} (dry-run) ${full}`);
}

console.log('[image-format-converter] 完成（dry-run）');
