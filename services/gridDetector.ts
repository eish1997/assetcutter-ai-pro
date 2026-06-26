/**
 * 宫格图片检测服务
 * 支持三种切割模式：
 * 1. uniform - 均匀分割（自定义行列数）
 * 2. auto - 自动检测（颜色跳变法 + 边缘检测 + 霍夫变换）
 * 3. vision - 视觉识别（调用 Gemini 视觉模型）
 */

import type { BoundingBox } from '../types';

/** 切割模式 */
export type CutMode = 'uniform' | 'auto' | 'vision';

/** 均匀分割配置 */
export interface UniformCutConfig {
  rows: number;
  cols: number;
}

/** 自动检测配置 */
export interface AutoCutConfig {
  /** 最小缝隙宽度（像素） */
  minGapWidth?: number;
  /** 最大缝隙宽度（像素） */
  maxGapWidth?: number;
  /** 缝隙颜色阈值（0-255，低于此值认为是黑色缝隙） */
  gapThreshold?: number;
}

/** 视觉识别配置 */
export interface VisionCutConfig {
  /** 自定义提示词 */
  customPrompt?: string;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
}

/** 切割配置联合类型 */
export type CutConfig = 
  | { mode: 'uniform'; config: UniformCutConfig }
  | { mode: 'auto'; config: AutoCutConfig }
  | { mode: 'vision'; config?: VisionCutConfig };

/** 默认配置 */
export const DEFAULT_UNIFORM_CONFIG: UniformCutConfig = { rows: 2, cols: 2 };
export const DEFAULT_AUTO_CONFIG: AutoCutConfig = {
  minGapWidth: 2,
  maxGapWidth: 50,
  gapThreshold: 128,
};

/**
 * 从图片数据 URL 加载 Image 对象
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * 均匀分割 - 按行列数等分图片
 */
export function detectUniformGrid(
  width: number,
  height: number,
  config: UniformCutConfig
): BoundingBox[] {
  const { rows, cols } = config;
  if (rows <= 0 || cols <= 0) return [];
  if (rows === 1 && cols === 1) {
    return [{ id: 'full', label: '整图', xmin: 0, ymin: 0, xmax: 1000, ymax: 1000 }];
  }

  const boxes: BoundingBox[] = [];
  const cellW = 1000 / cols;
  const cellH = 1000 / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const xmin = c * cellW;
      const ymin = r * cellH;
      boxes.push({
        id: `cell-${r}-${c}`,
        label: `${r + 1}行${c + 1}列`,
        xmin,
        ymin,
        xmax: (c + 1) * cellW,
        ymax: (r + 1) * cellH,
      });
    }
  }
  return boxes;
}

/**
 * 颜色跳变法检测宫格缝隙
 * 原理：分析每行/列像素和的跳变点，突变处即为分割线
 */
function detectGapByColorJump(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  config: AutoCutConfig
): { verticalLines: number[]; horizontalLines: number[] } {
  const { minGapWidth = 2, maxGapWidth = 50, gapThreshold = 128 } = config;

  // 灰度化并计算每行每列的像素和
  const rowSums = new Int32Array(height);
  const colSums = new Int32Array(width);

  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // 灰度化
      const gray = (pixels[idx] * 299 + pixels[idx + 1] * 587 + pixels[idx + 2] * 114) / 1000;
      // 统计暗色像素（缝隙通常是黑色）
      if (gray < gapThreshold) sum++;
    }
    rowSums[y] = sum;
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      const gray = (pixels[idx] * 299 + pixels[idx + 1] * 587 + pixels[idx + 2] * 114) / 1000;
      if (gray < gapThreshold) sum++;
    }
    colSums[x] = sum;
  }

  // 分析跳变点
  const verticalLines: number[] = [];
  const horizontalLines: number[] = [];

  // 检测垂直分割线（检查每列的暗色像素密度）
  let inGap = false;
  let gapStart = 0;
  for (let x = 0; x < width; x++) {
    const density = colSums[x] / height;
    const isGap = density > 0.5; // 超过50%暗色认为是缝隙

    if (isGap && !inGap) {
      inGap = true;
      gapStart = x;
    } else if (!isGap && inGap) {
      const gapWidth = x - gapStart;
      if (gapWidth >= minGapWidth && gapWidth <= maxGapWidth) {
        // 取缝隙中心
        verticalLines.push((gapStart + x) / 2);
      }
      inGap = false;
    }
  }

  // 检测水平分割线
  inGap = false;
  for (let y = 0; y < height; y++) {
    const density = rowSums[y] / width;
    const isGap = density > 0.5;

    if (isGap && !inGap) {
      inGap = true;
      gapStart = y;
    } else if (!isGap && inGap) {
      const gapWidth = y - gapStart;
      if (gapWidth >= minGapWidth && gapWidth <= maxGapWidth) {
        horizontalLines.push((gapStart + y) / 2);
      }
      inGap = false;
    }
  }

  return { verticalLines, horizontalLines };
}

/**
 * 边缘检测 + 霍夫变换检测直线
 */
function detectLinesByEdgeDetection(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): { verticalLines: number[]; horizontalLines: number[] } {
  // 简化版霍夫变换 - 找明显的水平和垂直线
  const verticalLines: number[] = [];
  const horizontalLines: number[] = [];

  // 转灰度
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    gray[i] = (pixels[idx] * 299 + pixels[idx + 1] * 587 + pixels[idx + 2] * 114) / 1000;
  }

  // Sobel 边缘检测
  const edges = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      // 简化梯度
      const gx = Math.abs(gray[idx + 1] - gray[idx - 1]);
      const gy = Math.abs(gray[idx + width] - gray[idx - width]);
      edges[idx] = Math.min(255, gx + gy);
    }
  }

  // 统计每列/行的边缘密度
  const colEdgeDensity = new Float32Array(width);
  const rowEdgeDensity = new Float32Array(height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      colEdgeDensity[x] += edges[idx];
      rowEdgeDensity[y] += edges[idx];
    }
  }

  // 平滑
  const smooth = (arr: Float32Array, window: number): Float32Array => {
    const result = new Float32Array(arr.length);
    const half = Math.floor(window / 2);
    for (let i = 0; i < arr.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
        sum += arr[j];
        count++;
      }
      result[i] = sum / count;
    }
    return result;
  };

  const smoothCol = smooth(colEdgeDensity, 5);
  const smoothRow = smooth(rowEdgeDensity, 5);

  // 找峰值（线所在位置）
  const findPeaks = (arr: Float32Array, minDist: number, threshold: number): number[] => {
    const peaks: number[] = [];
    let lastPeak = -minDist;
    const maxVal = Math.max(...arr);
    const thresh = threshold * maxVal;

    for (let i = 1; i < arr.length - 1; i++) {
      if (arr[i] > thresh && arr[i] > arr[i - 1] && arr[i] > arr[i + 1]) {
        if (i - lastPeak >= minDist) {
          peaks.push(i);
          lastPeak = i;
        }
      }
    }
    return peaks;
  };

  // 假设最小宫格间距为图片宽/高的 5%
  const minDist = Math.min(width, height) * 0.05;
  const vPeaks = findPeaks(smoothCol, minDist, 0.3);
  const hPeaks = findPeaks(smoothRow, minDist, 0.3);

  // 转换为归一化坐标
  verticalLines.push(...vPeaks.map(p => (p / width) * 1000));
  horizontalLines.push(...hPeaks.map(p => (p / height) * 1000));

  return { verticalLines, horizontalLines };
}

/**
 * 根据分割线生成边界框
 */
function boxesFromLines(
  verticalLines: number[],
  horizontalLines: number[],
  scale: number
): BoundingBox[] {
  // 添加边界
  const vLines = [0, ...verticalLines.map(l => l * scale), 1000].sort((a, b) => a - b);
  const hLines = [0, ...horizontalLines.map(l => l * scale), 1000].sort((a, b) => a - b);

  const boxes: BoundingBox[] = [];

  for (let r = 0; r < hLines.length - 1; r++) {
    for (let c = 0; c < vLines.length - 1; c++) {
      const xmin = vLines[c];
      const ymin = hLines[r];
      const xmax = vLines[c + 1];
      const ymax = hLines[r + 1];
      // 忽略太小的框
      if (xmax - xmin > 20 && ymax - ymin > 20) {
        boxes.push({
          id: `auto-${r}-${c}`,
          label: `区域${r * (vLines.length - 1) + c + 1}`,
          xmin,
          ymin,
          xmax,
          ymax,
        });
      }
    }
  }

  return boxes;
}

/**
 * 自动检测宫格
 */
export async function detectAutoGrid(src: string, config: AutoCutConfig = {}): Promise<BoundingBox[]> {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const scale = 1000 / canvas.width;

  // 方法1：颜色跳变法
  const { verticalLines: v1, horizontalLines: h1 } = detectGapByColorJump(
    pixels,
    canvas.width,
    canvas.height,
    config
  );

  // 方法2：边缘检测
  const { verticalLines: v2, horizontalLines: h2 } = detectLinesByEdgeDetection(
    pixels,
    canvas.width,
    canvas.height
  );

  // 合并两种方法的结果（去重）
  const mergeLines = (lines: number[], tolerance: number): number[] => {
    if (lines.length === 0) return [];
    const sorted = [...lines].sort((a, b) => a - b);
    const merged: number[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - merged[merged.length - 1] > tolerance) {
        merged.push(sorted[i]);
      }
    }
    return merged;
  };

  // 边缘检测返回 0–1000 归一化坐标，需转回像素再与颜色跳变结果合并
  const v2Px = v2.map((line) => (line / 1000) * canvas.width);
  const h2Px = h2.map((line) => (line / 1000) * canvas.height);

  // 合并垂直线（容差为图片宽度的1%）
  const tolerance = canvas.width * 0.01;
  const verticalLines = mergeLines([...v1, ...v2Px], tolerance);
  const horizontalLines = mergeLines([...h1, ...h2Px], tolerance);

  // 如果检测不到明显的分割线，尝试均匀分割
  if (verticalLines.length === 0 && horizontalLines.length === 0) {
    // 尝试找最可能的宫格布局
    const aspectRatio = canvas.width / canvas.height;

    // 常见宫格比例
    const candidates = [
      { rows: 2, cols: 2 },
      { rows: 3, cols: 3 },
      { rows: 2, cols: 3 },
      { rows: 3, cols: 2 },
      { rows: 1, cols: 3 },
      { rows: 3, cols: 1 },
      { rows: 2, cols: 1 },
      { rows: 1, cols: 2 },
    ];

    // 选择最接近原图比例的
    let best = candidates[0];
    let bestScore = Infinity;
    for (const c of candidates) {
      const gridRatio = (c.cols / c.rows);
      const score = Math.abs(gridRatio - aspectRatio);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return detectUniformGrid(canvas.width, canvas.height, best);
  }

  return boxesFromLines(verticalLines, horizontalLines, scale);
}

/** 已知列行时，将均匀分割线吸附到检测到的格线（忽略顶栏多余细线） */
export function snapGridBoundariesToDetectedLines(
  segments: number,
  detectedLinesNorm: number[]
): number[] {
  if (segments < 1) return [0, 1000];
  const step = 1000 / segments;
  const tol = Math.max(12, step * 0.08);
  const internals = detectedLinesNorm.filter((v) => v > 4 && v < 996);
  const boundaries = [0];
  for (let i = 1; i < segments; i += 1) {
    const ideal = step * i;
    const nearby = internals.filter((line) => Math.abs(line - ideal) <= tol);
    if (nearby.length) {
      boundaries.push(
        Math.round(nearby.reduce((best, line) =>
          Math.abs(line - ideal) < Math.abs(best - ideal) ? line : best
        ))
      );
    } else {
      boundaries.push(Math.round(ideal));
    }
  }
  boundaries.push(1000);
  return boundaries;
}

/** 按已知列行，从检测到的分割线生成切分框（比均匀网格更贴格线） */
function pickGridBoundariesNorm(detectedLinesNorm: number[], segments: number): number[] {
  return snapGridBoundariesToDetectedLines(segments, detectedLinesNorm);
}

export async function detectStoryboardGridBoxesForLayout(
  src: string,
  layout: { cols: number; rows: number },
  cellCount: number
): Promise<BoundingBox[]> {
  const cols = Math.max(1, Math.min(12, Math.round(layout.cols)));
  const rows = Math.max(1, Math.min(12, Math.round(layout.rows)));
  const count = Math.max(1, Math.min(cellCount, cols * rows));
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const scale = 1000 / canvas.width;

  const { verticalLines: v1, horizontalLines: h1 } = detectGapByColorJump(
    pixels,
    canvas.width,
    canvas.height,
    {}
  );
  const { verticalLines: v2, horizontalLines: h2 } = detectLinesByEdgeDetection(
    pixels,
    canvas.width,
    canvas.height
  );
  const mergeLines = (lines: number[], tolerance: number): number[] => {
    if (lines.length === 0) return [];
    const sorted = [...lines].sort((a, b) => a - b);
    const merged: number[] = [sorted[0]!];
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i]! - merged[merged.length - 1]! > tolerance) merged.push(sorted[i]!);
    }
    return merged;
  };
  const tolerance = canvas.width * 0.01;
  const v2Px = v2.map((line) => (line / 1000) * canvas.width);
  const h2Px = h2.map((line) => (line / 1000) * canvas.height);
  const verticalPx = mergeLines([...v1, ...v2Px], tolerance);
  const horizontalPx = mergeLines([...h1, ...h2Px], tolerance);
  const vNorm = verticalPx.map((line) => Math.round(line * scale));
  const hNorm = horizontalPx.map((line) => Math.round((line / canvas.height) * 1000));

  const vBoundaries = pickGridBoundariesNorm(vNorm, cols);
  const hBoundaries = pickGridBoundariesNorm(hNorm, rows);
  const margin = 3;
  const boxes: BoundingBox[] = [];
  let index = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (index >= count) break;
      boxes.push({
        id: `line-grid-${index}`,
        label: String(index + 1),
        xmin: Math.max(0, vBoundaries[c]! + margin),
        ymin: Math.max(0, hBoundaries[r]! + margin),
        xmax: Math.min(1000, vBoundaries[c + 1]! - margin),
        ymax: Math.min(1000, hBoundaries[r + 1]! - margin),
      });
      index += 1;
    }
  }
  return boxes;
}

/**
 * 检测宫格 - 根据配置选择方法
 */
export async function detectGrid(
  src: string,
  cutConfig: CutConfig,
  visionDetectFn?: (src: string, prompt?: string) => Promise<BoundingBox[]>
): Promise<BoundingBox[]> {
  switch (cutConfig.mode) {
    case 'uniform': {
      // 需要图片尺寸，先加载图片
      const img = await loadImage(src);
      return detectUniformGrid(img.naturalWidth, img.naturalHeight, cutConfig.config);
    }

    case 'auto':
      return detectAutoGrid(src, cutConfig.config);

    case 'vision':
      if (visionDetectFn) {
        return visionDetectFn(src, cutConfig.config?.customPrompt);
      }
      // 如果没有视觉检测函数，fallback 到自动检测
      return detectAutoGrid(src, DEFAULT_AUTO_CONFIG);

    default:
      return [{ id: 'full', label: '整图', xmin: 0, ymin: 0, xmax: 1000, ymax: 1000 }];
  }
}
