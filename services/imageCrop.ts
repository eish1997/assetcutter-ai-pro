import type { BoundingBox } from '../types';

/** 裁剪图片：根据框选裁剪出多张图；`overflowPx` 为每边向外扩展的像素（基于原图像素，不超出图幅） */
export function cropBoxes(
  inputImage: string,
  boxes: BoundingBox[],
  selectedIndexes: number[],
  overflowPx = 0
): Promise<string[]> {
  const results: string[] = [];
  const img = new Image();
  img.src = inputImage;
  const pad = Math.max(0, Math.min(512, Math.round(overflowPx)));
  return new Promise<string[]>((resolve) => {
    img.onload = () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const scaleX = nw / 1000;
      const scaleY = nh / 1000;
      for (const i of selectedIndexes) {
        if (i < 0 || i >= boxes.length) continue;
        const b = boxes[i];
        let x = Math.round(b.xmin * scaleX - pad);
        let y = Math.round(b.ymin * scaleY - pad);
        let w = Math.round((b.xmax - b.xmin) * scaleX + 2 * pad);
        let h = Math.round((b.ymax - b.ymin) * scaleY + 2 * pad);
        x = Math.max(0, x);
        y = Math.max(0, y);
        w = Math.min(nw - x, w);
        h = Math.min(nh - y, h);
        if (w < 1 || h < 1) continue;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        results.push(canvas.toDataURL('image/png'));
      }
      resolve(results);
    };
    img.onerror = () => resolve([]);
  });
}
