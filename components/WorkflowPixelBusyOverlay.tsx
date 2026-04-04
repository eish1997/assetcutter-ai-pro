import React, { useEffect, useRef } from 'react';

/**
 * 工作流卡片「执行 / 排队」遮罩：与 [React Bits Pixel Card](https://reactbits.dev/components/pixel-card)
 * 同源实现（Canvas 栅格 + 自中心波次出现 + shimmer），逻辑移植自
 * [DavidHDev/react-bits PixelCard](https://github.com/DavidHDev/react-bits/tree/main/src/content/Components/PixelCard)。
 *  busy 状态自动等价于官方示例的 hover（持续 appear 动画）。
 */

function getEffectiveSpeed(value: number, reducedMotion: boolean): number {
  const min = 0;
  const max = 100;
  const throttle = 0.001;
  const parsed = Math.floor(value);
  if (parsed <= min || reducedMotion) return min;
  if (parsed >= max) return max * throttle;
  return parsed * throttle;
}

class Pixel {
  private readonly width: number;
  private readonly height: number;
  private readonly ctx: CanvasRenderingContext2D;
  readonly x: number;
  readonly y: number;
  private readonly color: string;
  private readonly speed: number;
  private size = 0;
  private readonly sizeStep: number;
  private readonly minSize = 0.5;
  private readonly maxSizeInteger = 2;
  private readonly maxSize: number;
  private readonly delay: number;
  private counter = 0;
  private readonly counterStep: number;
  isIdle = false;
  private isReverse = false;
  private isShimmer = false;

  constructor(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    speed: number,
    delay: number
  ) {
    this.width = canvas.width;
    this.height = canvas.height;
    this.ctx = context;
    this.x = x;
    this.y = y;
    this.color = color;
    this.speed = this.getRandomValue(0.1, 0.9) * speed;
    this.sizeStep = Math.random() * 0.4;
    this.maxSize = this.getRandomValue(this.minSize, this.maxSizeInteger);
    this.delay = delay;
    this.counterStep = Math.random() * 4 + (this.width + this.height) * 0.01;
  }

  private getRandomValue(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }

  draw(): void {
    const centerOffset = this.maxSizeInteger * 0.5 - this.size * 0.5;
    this.ctx.fillStyle = this.color;
    this.ctx.fillRect(this.x + centerOffset, this.y + centerOffset, this.size, this.size);
  }

  appear(): void {
    this.isIdle = false;
    if (this.counter <= this.delay) {
      this.counter += this.counterStep;
      return;
    }
    if (this.size >= this.maxSize) {
      this.isShimmer = true;
    }
    if (this.isShimmer) {
      this.shimmer();
    } else {
      this.size += this.sizeStep;
    }
    this.draw();
  }

  disappear(): void {
    this.isShimmer = false;
    this.counter = 0;
    if (this.size <= 0) {
      this.isIdle = true;
      return;
    }
    this.size -= 0.1;
    this.draw();
  }

  private shimmer(): void {
    if (this.size >= this.maxSize) {
      this.isReverse = true;
    } else if (this.size <= this.minSize) {
      this.isReverse = false;
    }
    if (this.isReverse) {
      this.size -= this.speed;
    } else {
      this.size += this.speed;
    }
  }
}

/** 与官方 default 变体一致 */
const DEFAULT_COLORS = '#f8fafc,#f1f5f9,#cbd5e1';

const WorkflowPixelBusyOverlay: React.FC<{
  executing: boolean;
  className?: string;
}> = ({ executing, className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelsRef = useRef<Pixel[]>([]);
  const animationRef = useRef<number | null>(null);
  const timePreviousRef = useRef(performance.now());
  const reducedMotionRef = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    const gap = 5;
    const speed = executing ? 35 : 22;
    const colors = DEFAULT_COLORS;
    const reducedMotion = reducedMotionRef.current;

    const initPixels = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      const rect = container.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      if (width < 1 || height < 1) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const colorsArray = colors.split(',');
      const effectiveSpeed = getEffectiveSpeed(speed, reducedMotion);
      const pxs: Pixel[] = [];
      for (let x = 0; x < width; x += gap) {
        for (let y = 0; y < height; y += gap) {
          const color = colorsArray[Math.floor(Math.random() * colorsArray.length)]!.trim();
          const dx = x - width / 2;
          const dy = y - height / 2;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const delay = reducedMotion ? 0 : distance;
          pxs.push(new Pixel(canvas, ctx, x, y, color, effectiveSpeed, delay));
        }
      }
      pixelsRef.current = pxs;
    };

    const doAnimate = (fnName: 'appear' | 'disappear') => {
      animationRef.current = requestAnimationFrame(() => doAnimate(fnName));
      const timeNow = performance.now();
      const timePassed = timeNow - timePreviousRef.current;
      const timeInterval = 1000 / 60;
      if (timePassed < timeInterval) return;
      timePreviousRef.current = timeNow - (timePassed % timeInterval);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let allIdle = true;
      const pxs = pixelsRef.current;
      for (let i = 0; i < pxs.length; i++) {
        const pixel = pxs[i]!;
        pixel[fnName]();
        if (!pixel.isIdle) allIdle = false;
      }
      if (allIdle && fnName === 'disappear') {
        if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };

    const startAppear = () => {
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      initPixels();
      if (pixelsRef.current.length === 0) return;
      timePreviousRef.current = performance.now();
      animationRef.current = requestAnimationFrame(() => doAnimate('appear'));
    };

    startAppear();

    const observer = new ResizeObserver(() => {
      startAppear();
    });
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };
  }, [executing]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 z-10 overflow-hidden rounded-[inherit] border border-white/[0.06] bg-[#09090b] pointer-events-none isolate ${className}`.trim()}
      aria-hidden
    >
      <canvas ref={canvasRef} className="absolute inset-0 z-0 block h-full w-full" />
      {/* 与官方 .pixel-card:hover::before 一致：叠在像素层之上，中心径向压暗 */}
      <div
        className="pointer-events-none absolute inset-0 z-[1] m-auto aspect-square opacity-100"
        style={{
          background: 'radial-gradient(circle, #09090b, transparent 85%)',
        }}
      />
      <div className="pointer-events-none absolute inset-0 z-[2] grid place-items-center px-3">
        <span
          className={`text-center text-[11px] font-bold tracking-wide ${
            executing ? 'text-zinc-500' : 'text-zinc-600'
          }`}
          style={{ textShadow: '0 0 24px rgba(0,0,0,0.85)' }}
        >
          {executing ? '执行中' : '排队中'}
        </span>
      </div>
    </div>
  );
};

export default WorkflowPixelBusyOverlay;
