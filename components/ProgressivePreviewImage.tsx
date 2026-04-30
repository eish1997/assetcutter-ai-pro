import React, { useEffect, useState, useCallback, forwardRef, useRef } from 'react';
import { workflowSafeImgSrc } from '../services/workflowImageDisplay';
import { SiteImage } from './SiteImage';
import {
  createPreviewMicroThumbnail,
  createPreviewThumbnail,
  shouldUsePreviewThumbnail,
  type PreviewThumbDecodePriority,
} from '../services/workflowImageThumb';

/**
 * 缩略图 / 微图 data URL 的 **仅内存 LRU**（`thumb:` / `micro:` 前缀键）。
 * - **不会**写入 R2/本地持久化；换设备或刷新后按原图重新生成。
 * - 跨设备一致的是工作区里的原图/结果（`objectKey` → 拉取后再走本组件生成微图/小图）。
 */
const MAX_PREVIEW_THUMB_CACHE_ENTRIES = 512;
const previewThumbCache = new Map<string, string>();

function cacheGet(key: string): string | undefined {
  const v = previewThumbCache.get(key);
  if (v === undefined) return undefined;
  previewThumbCache.delete(key);
  previewThumbCache.set(key, v);
  return v;
}

function cacheSet(key: string, value: string): void {
  if (previewThumbCache.has(key)) previewThumbCache.delete(key);
  previewThumbCache.set(key, value);
  while (previewThumbCache.size > MAX_PREVIEW_THUMB_CACHE_ENTRIES) {
    const first = previewThumbCache.keys().next().value as string | undefined;
    if (first !== undefined) previewThumbCache.delete(first);
  }
}

function thumbCacheKey(cacheKey: string): string {
  return `thumb:${cacheKey}`;
}

function microCacheKey(cacheKey: string): string {
  return `micro:${cacheKey}`;
}

/**
 * 渐进第一层「微图」边长：过小会在卡片上被 object-cover 拉大后**长时间**显得极糊（小图在解码队列里排队时尤其明显）。
 * 与「小图」保持合理比例，先屏仍明显轻于完整小图生成，但可读性接近以往单档缩略。
 */
function defaultMicroMaxEdge(thumbMaxEdge: number): number {
  return Math.min(256, Math.max(128, Math.round(thumbMaxEdge * 0.34)));
}

/** 与常见卡片图区域一致，避免纯黑「洞」感 */
const PLACEHOLDER_BG = 'bg-[#141416]';

/** 微图→小图叠化时长（ms），短到不易察觉为「加载」，仅柔化切换 */
const THUMB_REVEAL_MS = 160;

/** 小图 data URL 先离屏解码，再进 DOM，避免首帧 opacity=0 露出黑底 */
function preloadImageDataUrl(dataUrl: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (typeof img.decode === 'function') {
        void img.decode().then(() => resolve()).catch(() => resolve());
      } else {
        resolve();
      }
    };
    img.onerror = () => resolve();
    img.src = dataUrl;
  });
}

export type ProgressivePreviewImageProps = {
  /**
   * 用于生成缩略的源（通常为大图 data URL 或同源 URL）。
   * 当 `shouldUsePreviewThumbnail` 为真时：**列表内 `<img>` 只会显示微图/小图 data URL，不会把此字段绑到 `src`**；原图仅在父级灯箱/全屏预览里单独用 `<img src={原图}>` 加载。
   */
  fullSrc: string;
  /** 稳定缓存键 */
  cacheKey: string;
  /** 缩略图最长边（像素），网格可 512–640，条带/悬浮可 200–320 */
  thumbMaxEdge?: number;
  /** 第一层 WebP 微缩最长边；默认按 thumbMaxEdge 比例推算 */
  microMaxEdge?: number;
  /** 为真时不解码/不生成缩略，仅占位（配合视口解锁，让首屏先加载）。 */
  deferThumbnail?: boolean;
  /** 列表优先加载时用 high */
  imageFetchPriority?: 'high' | 'low' | 'auto';
  /** 传入全局缩略解码队列：视口内 high，屏外 low（先完成当前可见小图） */
  thumbDecodePriority?: 'high' | 'low';
  className?: string;
  imgClassName?: string;
  /** 作用于当前可见的顶层 `<img>`（微图或小图，以小图优先） */
  imgStyle?: React.CSSProperties;
  alt?: string;
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLImageElement>;
  onIntrinsicSize?: (naturalWidth: number, naturalHeight: number) => void;
  onClick?: React.MouseEventHandler<HTMLImageElement>;
  title?: string;
  /** 直链模式（非渐进缩略）下全部 URL 加载失败时渲染 */
  directLoadFallback?: React.ReactNode;
};

/**
 * 渐进预览：**先微图（WebP）→ 小图（JPEG）**，微图一直显示到小图解码完成再切换；**不会在列表里再加载/展示原图**（原图只应在独立预览里使用）。
 * 大 data URL 在画布中解码一次用于生成缩略，DOM 中不出现原图 `src`。
 * 极短 data URL / http(s) 外链走直链 img（外链受 CORS 限制无法安全缩略）。
 * 微图→小图：叠化时**不**把微图 opacity 置 0（否则与小图 transition 首帧叠成「双透明」露黑底）；无微图时先离屏解码再一次性显示小图。
 * 仅命中小图缓存而无微图时，仍后台生成微图写入缓存，供下次渐进。
 */
export const ProgressivePreviewImage = forwardRef<HTMLImageElement, ProgressivePreviewImageProps>(
  function ProgressivePreviewImage(
    {
      fullSrc,
      cacheKey,
      thumbMaxEdge = 512,
      microMaxEdge: microMaxEdgeProp,
      deferThumbnail = false,
      imageFetchPriority = 'auto',
      thumbDecodePriority = 'low',
      className,
      imgClassName,
      imgStyle,
      alt = '',
      draggable = false,
      onDragStart,
      onIntrinsicSize,
      onClick,
      title,
      directLoadFallback,
    },
    ref
  ) {
    const safe = workflowSafeImgSrc(fullSrc);
    const needThumb = shouldUsePreviewThumbnail(safe);
    const microEdge = microMaxEdgeProp ?? defaultMicroMaxEdge(thumbMaxEdge);
    const decodePri: PreviewThumbDecodePriority = thumbDecodePriority === 'high' ? 'high' : 'low';

    const [microSrc, setMicroSrc] = useState<string | null>(null);
    const [thumbSrc, setThumbSrc] = useState<string | null>(null);
    const [thumbReady, setThumbReady] = useState(false);
    /** 无微图时小图直接显现，不做叠化（避免「还在加载一层」的观感） */
    const thumbRevealSkipTransitionRef = useRef(false);
    const microPaintedRef = useRef(false);

    const assignVisibleRef = useCallback(
      (el: HTMLImageElement | null) => {
        if (typeof ref === 'function') ref(el);
        else if (ref) (ref as React.MutableRefObject<HTMLImageElement | null>).current = el;
      },
      [ref]
    );

    const revealThumbAfterDecode = useCallback((el: HTMLImageElement) => {
      const finish = () => setThumbReady(true);
      try {
        if (typeof el.decode === 'function') {
          void el.decode().then(finish).catch(finish);
        } else {
          finish();
        }
      } catch {
        finish();
      }
    }, []);

    /** 小图叠化完成后再卸微图，避免与微图同步闪切；无微图时仅标记跳过 transition */
    useEffect(() => {
      if (!thumbReady || !thumbSrc) return;
      if (!microSrc) return;
      const t = window.setTimeout(() => setMicroSrc(null), THUMB_REVEAL_MS + 24);
      return () => clearTimeout(t);
    }, [thumbReady, thumbSrc, microSrc]);

    useEffect(() => {
      if (deferThumbnail) {
        setMicroSrc(null);
        setThumbSrc(null);
        setThumbReady(false);
        return;
      }

      const s = workflowSafeImgSrc(fullSrc);
      if (!shouldUsePreviewThumbnail(s)) {
        setMicroSrc(null);
        setThumbSrc(safe);
        setThumbReady(true);
        thumbRevealSkipTransitionRef.current = true;
        return;
      }

      setMicroSrc(null);
      setThumbSrc(null);
      setThumbReady(false);
      thumbRevealSkipTransitionRef.current = false;
      microPaintedRef.current = false;

      const tKey = thumbCacheKey(cacheKey);
      const mKey = microCacheKey(cacheKey);
      const thumbHit = cacheGet(tKey) ?? cacheGet(cacheKey);
      const microHit = cacheGet(mKey);

      let cancelled = false;

      if (thumbHit) {
        if (microHit) {
          microPaintedRef.current = true;
          setMicroSrc(microHit);
          setThumbSrc(thumbHit);
          thumbRevealSkipTransitionRef.current = false;
          void preloadImageDataUrl(thumbHit).then(() => {
            if (cancelled) return;
            setThumbReady(true);
          });
        } else {
          void preloadImageDataUrl(thumbHit).then(() => {
            if (cancelled) return;
            thumbRevealSkipTransitionRef.current = true;
            setThumbSrc(thumbHit);
            setThumbReady(true);
          });
          // 仅有小图缓存时仍从原图生成微图并写入缓存，下次可先发微图再叠小图
          void createPreviewMicroThumbnail(s, microEdge, 0.62, 0.72, decodePri).then((m) => {
            if (cancelled) return;
            cacheSet(mKey, m);
          });
        }
        return () => {
          cancelled = true;
        };
      }

      if (microHit) {
        microPaintedRef.current = true;
        setMicroSrc(microHit);
      }

      const thumbDoneRef = { current: false };

      const runThumb = () => {
        void createPreviewThumbnail(s, thumbMaxEdge, 0.82, decodePri).then(async (t) => {
          if (cancelled) return;
          thumbDoneRef.current = true;
          cacheSet(tKey, t);
          thumbRevealSkipTransitionRef.current = !microPaintedRef.current;

          if (microPaintedRef.current) {
            setThumbSrc(t);
            // 叠化依赖 thumbReady；仅依赖 onLoad 在部分环境下可能滞后，离屏解码后显式就绪，避免一直卡在微图层
            await preloadImageDataUrl(t);
            if (cancelled) return;
            setThumbReady(true);
            return;
          }
          await preloadImageDataUrl(t);
          if (cancelled) return;
          setThumbSrc(t);
          setThumbReady(true);
        });
      };

      if (!microHit) {
        void createPreviewMicroThumbnail(s, microEdge, 0.62, 0.72, decodePri).then((m) => {
          if (cancelled) return;
          cacheSet(mKey, m);
          if (thumbDoneRef.current) return;
          microPaintedRef.current = true;
          setMicroSrc(m);
        });
      }

      runThumb();

      return () => {
        cancelled = true;
      };
    }, [deferThumbnail, fullSrc, cacheKey, thumbMaxEdge, microEdge, safe, decodePri]);

    const baseImg = imgClassName ?? '';
    const layerClass = `${baseImg} absolute inset-0 max-w-none max-h-none`;

    const microRefActive = !!(microSrc && !(thumbReady && thumbSrc));
    const thumbRefActive = !!(thumbSrc && (thumbReady || !microSrc));

    if (deferThumbnail) {
      return <div className={`${className ?? 'relative w-full h-full'} ${PLACEHOLDER_BG} overflow-hidden`} />;
    }

    // 极短 data URL 或非 data：无渐进必要；http(s) 走 SiteImage 多候选重试（与全站直链一致）
    if (!needThumb) {
      return (
        <div className={className ?? 'relative w-full h-full'}>
          <SiteImage
            ref={assignVisibleRef}
            src={fullSrc}
            alt={alt}
            draggable={draggable}
            onDragStart={onDragStart}
            loading={imageFetchPriority === 'high' ? 'eager' : 'lazy'}
            fetchPriority={imageFetchPriority}
            onIntrinsicSize={onIntrinsicSize}
            onClick={onClick}
            title={title}
            className={imgClassName}
            style={imgStyle}
            fallback={directLoadFallback}
          />
        </div>
      );
    }

    return (
      <div className={`${className ?? 'relative w-full h-full'} ${PLACEHOLDER_BG} overflow-hidden`}>
        {microSrc ? (
          <img
            ref={microRefActive ? assignVisibleRef : undefined}
            src={microSrc}
            alt={alt}
            draggable={draggable}
            onDragStart={onDragStart}
            loading="eager"
            fetchPriority={imageFetchPriority}
            decoding="async"
            onClick={onClick}
            title={title}
            onLoad={(e) => {
              const iw = e.currentTarget.naturalWidth;
              const ih = e.currentTarget.naturalHeight;
              if (iw > 0 && ih > 0) onIntrinsicSize?.(iw, ih);
            }}
            className={`${layerClass} z-[1] opacity-100 ${thumbReady && thumbSrc ? 'pointer-events-none' : ''}`}
            aria-hidden={!!(thumbReady && thumbSrc)}
          />
        ) : null}

        {thumbSrc ? (
          <img
            ref={thumbRefActive ? assignVisibleRef : undefined}
            src={thumbSrc}
            alt={alt}
            draggable={draggable}
            onDragStart={onDragStart}
            loading="eager"
            fetchPriority={imageFetchPriority}
            decoding="async"
            onClick={onClick}
            title={title}
            className={`${layerClass} z-[2] ${
              thumbReady ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
            } transition-opacity duration-[160ms] ease-out`}
            style={imgStyle}
            onLoad={(e) => {
              const el = e.currentTarget;
              const iw = el.naturalWidth;
              const ih = el.naturalHeight;
              if (iw > 0 && ih > 0) onIntrinsicSize?.(iw, ih);
              if (thumbReady) return;
              revealThumbAfterDecode(el);
            }}
          />
        ) : null}
      </div>
    );
  }
);

/** 工作区主网格：略大缩略边，与 ProgressivePreviewImage 同源逻辑 */
export const WorkflowGridImage = forwardRef<HTMLImageElement, Omit<ProgressivePreviewImageProps, 'thumbMaxEdge'> & { thumbMaxEdge?: number }>(
  function WorkflowGridImage({ thumbMaxEdge = 640, ...rest }, ref) {
    return <ProgressivePreviewImage ref={ref} {...rest} thumbMaxEdge={thumbMaxEdge} />;
  }
);
