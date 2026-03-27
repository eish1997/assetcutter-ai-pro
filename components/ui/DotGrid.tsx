import React, { useEffect, useRef } from 'react';

type DotGridProps = {
  dotSize?: number;
  gap?: number;
  baseColor?: string;
  activeColor?: string;
  proximity?: number;
  shockRadius?: number;
  shockStrength?: number;
  resistance?: number;
  returnDuration?: number;
  opacity?: number;
};

type DotNode = {
  ox: number;
  oy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const normalized = hex.replace('#', '');
  const safe = normalized.length === 3
    ? normalized.split('').map((c) => `${c}${c}`).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  const value = Number.parseInt(safe, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const n = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(a.r + (b.r - a.r) * n),
    g: Math.round(a.g + (b.g - a.g) * n),
    b: Math.round(a.b + (b.b - a.b) * n),
  };
}

const DotGrid: React.FC<DotGridProps> = ({
  dotSize = 1.1,
  gap = 22,
  baseColor = '#2f3f66',
  activeColor = '#508cff',
  proximity = 120,
  shockRadius = 250,
  shockStrength = 5,
  resistance = 750,
  returnDuration = 1.5,
  opacity = 0.9,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const baseRgb = hexToRgb(baseColor);
    const activeRgb = hexToRgb(activeColor);
    const dots: DotNode[] = [];
    const pointer = { x: 0, y: 0, active: false, speed: 0 };
    let rafId = 0;
    let previousTime = performance.now();
    let previousPointerX = 0;
    let previousPointerY = 0;

    const resize = () => {
      const rect = root.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${Math.floor(rect.width)}px`;
      canvas.style.height = `${Math.floor(rect.height)}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      dots.length = 0;
      const cols = Math.ceil(rect.width / gap) + 1;
      const rows = Math.ceil(rect.height / gap) + 1;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const ox = col * gap;
          const oy = row * gap;
          dots.push({ ox, oy, x: ox, y: oy, vx: 0, vy: 0 });
        }
      }
    };

    const setPointerFromClient = (clientX: number, clientY: number) => {
      const rect = root.getBoundingClientRect();
      pointer.x = clientX - rect.left;
      pointer.y = clientY - rect.top;
      pointer.active = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height;
      const dx = pointer.x - previousPointerX;
      const dy = pointer.y - previousPointerY;
      pointer.speed = Math.min(1.5, Math.hypot(dx, dy) / 18);
      previousPointerX = pointer.x;
      previousPointerY = pointer.y;
    };

    const onMouseMove = (ev: MouseEvent) => setPointerFromClient(ev.clientX, ev.clientY);
    const onMouseLeave = () => {
      pointer.active = false;
      pointer.speed = 0;
    };
    const onTouchMove = (ev: TouchEvent) => {
      const touch = ev.touches[0];
      if (!touch) return;
      setPointerFromClient(touch.clientX, touch.clientY);
    };

    const step = (time: number) => {
      const dt = Math.min(0.032, (time - previousTime) / 1000);
      previousTime = time;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const pull = 10 / Math.max(0.2, returnDuration);
      const damping = Math.max(0.78, 1 - 120 / Math.max(220, resistance));

      for (const dot of dots) {
        let ax = (dot.ox - dot.x) * pull;
        let ay = (dot.oy - dot.y) * pull;

        let activation = 0;
        if (pointer.active) {
          const dx = dot.x - pointer.x;
          const dy = dot.y - pointer.y;
          const distance = Math.max(0.0001, Math.hypot(dx, dy));
          if (distance < proximity) {
            const influence = 1 - distance / proximity;
            const impulse = shockStrength * (0.6 + pointer.speed * 0.8);
            ax += (dx / distance) * influence * impulse * 36;
            ay += (dy / distance) * influence * impulse * 36;
            activation = Math.max(activation, influence);
          }
        }

        dot.vx = (dot.vx + ax * dt) * damping;
        dot.vy = (dot.vy + ay * dt) * damping;
        dot.x += dot.vx;
        dot.y += dot.vy;

        const rgb = mixRgb(baseRgb, activeRgb, activation);
        ctx.fillStyle = `rgb(${rgb.r} ${rgb.g} ${rgb.b})`;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dotSize, 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = window.requestAnimationFrame(step);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root);
    resize();

    rafId = window.requestAnimationFrame(step);
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('mouseleave', onMouseLeave, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('resize', resize);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('resize', resize);
      resizeObserver.disconnect();
    };
  }, [activeColor, baseColor, dotSize, gap, proximity, resistance, returnDuration, shockRadius, shockStrength]);

  return (
    <div
      aria-hidden
      ref={rootRef}
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      style={{ opacity }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
};

export default DotGrid;
