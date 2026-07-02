import React, { useEffect, useRef } from 'react';
import { useExecutionElapsedSeconds } from '../hooks/useExecutionElapsedSeconds';

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
  /** 能力集合等：底部略高的像素动画强度 */
  accentExecuting?: boolean;
  /** 第二行：执行阶段说明（如「拆分组件：生图中…」） */
  progressDetail?: string | null;
  /** 逐步预览：叠在暗色底下的参考图（object-contain） */
  backdropImageSrc?: string | null;
  /**
   * `compact`：能力集合等小节点用——更密的像素栅、不叠底图（与工作区大图观感一致）、
   * 主标题缩小；阶段说明不叠在栅格内（悬停遮罩可看 `title`），避免小卡片大字截断。
   */
  density?: 'default' | 'compact';
  /** 当前任务已运行秒数（仅 executing 时展示；与 executionStartedAt 二选一） */
  elapsedSeconds?: number | null;
  /** 任务开始时间戳；组件内本地 tick，避免父级每秒重绘 */
  executionStartedAt?: number | null;
  className?: string;
}> = ({
  executing,
  accentExecuting = false,
  progressDetail,
  backdropImageSrc,
  density = 'default',
  elapsedSeconds: elapsedSecondsProp = null,
  executionStartedAt = null,
  className = '',
}) => {
  const localElapsed = useExecutionElapsedSeconds(executionStartedAt, executing);
  const elapsedSeconds =
    executionStartedAt != null ? localElapsed : elapsedSecondsProp;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelsRef = useRef<Pixel[]>([]);
  const animationRef = useRef<number | null>(null);
  const timePreviousRef = useRef(0);
  const reducedMotionRef = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const isCompact = density === 'compact';

  useEffect(() => {
    const gap = isCompact ? 4 : 5;
    const speed =
      executing && accentExecuting
        ? isCompact
          ? 44
          : 50
        : executing
          ? isCompact
            ? 30
            : 35
          : accentExecuting
            ? isCompact
              ? 24
              : 28
            : isCompact
              ? 20
              : 22;
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
  }, [executing, accentExecuting, isCompact]);

  const detail = (progressDetail || '').trim();
  const showElapsed =
    executing && elapsedSeconds != null && Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0;
  const hasBackdrop = !!backdropImageSrc && backdropImageSrc.length > 0;
  /** 小节点上不叠预览图，避免与像素层糊成一团（对齐工作区「纯栅格+执行中」主视觉） */
  const useBackdrop = hasBackdrop && !isCompact;

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 z-10 overflow-hidden rounded-[inherit] border border-white/[0.06] ${
        useBackdrop ? 'bg-transparent' : 'bg-[#09090b]'
      } pointer-events-none isolate ${className}`.trim()}
      title={isCompact && detail ? detail : undefined}
      aria-hidden={!(isCompact && detail)}
    >
      {useBackdrop ? (
        <>
          <img
            src={backdropImageSrc!}
            alt=""
            className="absolute inset-0 z-0 h-full w-full object-contain opacity-[0.42]"
            draggable={false}
          />
          <div
            className="absolute inset-0 z-[0.5] bg-gradient-to-b from-[#09090b]/55 via-[#09090b]/72 to-[#09090b]/88"
            aria-hidden
          />
        </>
      ) : null}
      <canvas ref={canvasRef} className="absolute inset-0 z-[1] block h-full w-full" />
      {/* 与官方 .pixel-card:hover::before 一致：叠在像素层之上，中心径向压暗 */}
      <div
        className="pointer-events-none absolute inset-0 z-[2] m-auto aspect-square opacity-100"
        style={{
          background: isCompact
            ? 'radial-gradient(circle, rgba(9,9,11,0.94) 0%, rgba(9,9,11,0.55) 52%, transparent 78%)'
            : 'radial-gradient(circle, #09090b, transparent 85%)',
        }}
      />
      <div
        className={`pointer-events-none absolute inset-0 z-[3] flex flex-col items-center justify-center ${
          isCompact ? 'px-1.5 gap-0.5' : 'px-3 gap-1'
        } ${executing && accentExecuting && !isCompact ? 'motion-safe:animate-pulse' : ''}`}
      >
        <span
          className={`text-center font-bold tracking-wide ${
            isCompact
              ? executing
                ? 'text-[8px] font-black uppercase tracking-[0.14em] text-zinc-100'
                : 'text-[8px] font-semibold text-zinc-500'
              : executing
                ? 'text-[11px] text-zinc-300'
                : 'text-[11px] text-zinc-600'
          }`}
          style={{ textShadow: '0 0 24px rgba(0,0,0,0.85)' }}
        >
          {executing ? '执行中' : '排队中'}
        </span>
        {showElapsed ? (
          <span
            className={`text-center tabular-nums ${
              isCompact
                ? 'text-[7px] font-semibold text-zinc-400'
                : 'text-[10px] font-medium text-zinc-400/95'
            }`}
            style={{ textShadow: '0 0 12px rgba(0,0,0,0.9)' }}
          >
            已运行 {Math.max(0, Math.floor(elapsedSeconds!))} 秒
          </span>
        ) : null}
        {detail && !isCompact ? (
          <span
            className="text-center text-[9px] font-medium text-zinc-400/95 leading-snug max-w-[95%] line-clamp-3"
            style={{ textShadow: '0 0 12px rgba(0,0,0,0.9)' }}
          >
            {detail}
          </span>
        ) : null}
      </div>
      {executing && accentExecuting ? (
        <div
          className={`pointer-events-none absolute bottom-0 left-0 right-0 z-[4] overflow-hidden rounded-b-[inherit] bg-blue-500/15 ${
            isCompact ? 'h-[2px]' : 'h-[3px]'
          }`}
          aria-hidden
        >
          <div
            className="absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r from-transparent via-blue-400/90 to-transparent motion-reduce:animate-none"
            style={{ animation: 'workspaceSetRunBar 1.1s ease-in-out infinite' }}
          />
        </div>
      ) : null}
      <style>{`
        @keyframes workspaceSetRunBar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(340%); }
        }
      `}</style>
    </div>
  );
};

export default WorkflowPixelBusyOverlay;
