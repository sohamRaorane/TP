import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { X } from 'lucide-react';
import { useCanvasStore } from '@/store/canvasStore';
import { getElementBounds } from '@/engine/transformations/bounds';
import type { SketchElement } from '@/types/appState';
import { useOptionalModule, PATHS, type MinimapModule } from '../integration';
import { setUi } from '../run';

const W = 200;
const H = 140;
const PAD = 8;

interface Mapping { scale: number; offsetX: number; offsetY: number }

function computeMapping(els: SketchElement[], view: { x: number; y: number; w: number; h: number }): Mapping {
  let minX = view.x, minY = view.y, maxX = view.x + view.w, maxY = view.y + view.h;
  for (const el of els) {
    const b = getElementBounds(el);
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
  }
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  const scale = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh);
  return { scale, offsetX: (W - bw * scale) / 2 - minX * scale, offsetY: (H - bh * scale) / 2 - minY * scale };
}

function drawFallback(ctx: CanvasRenderingContext2D, els: SketchElement[], m: Mapping) {
  for (const el of els) {
    ctx.globalAlpha = Math.max(0.25, el.opacity / 100);
    const dark = document.querySelector('.sb-root.dark') !== null;
    ctx.strokeStyle = el.strokeColor === 'transparent' ? '#868e96' : dark && /^#(1e1e1e|000000|000)$/i.test(el.strokeColor) ? '#e3e3e8' : el.strokeColor;
    ctx.fillStyle = el.backgroundColor;
    ctx.lineWidth = 1;
    const x = el.x * m.scale + m.offsetX, y = el.y * m.scale + m.offsetY;
    const w = Math.max(1, el.width * m.scale), h = Math.max(1, el.height * m.scale);
    ctx.save();
    if (el.angle) { ctx.translate(x + w / 2, y + h / 2); ctx.rotate(el.angle); ctx.translate(-(x + w / 2), -(y + h / 2)); }
    ctx.beginPath();
    if ('points' in el && el.points.length > 1) {
      el.points.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * m.scale, y + py * m.scale) : ctx.moveTo(x + px * m.scale, y + py * m.scale)));
    } else if (el.type === 'ellipse') {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else if (el.type === 'diamond') {
      ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x, y + h / 2); ctx.closePath();
    } else {
      ctx.rect(x, y, w, h);
    }
    if (el.backgroundColor !== 'transparent' && !('points' in el)) ctx.fill();
    if (el.type === 'text' || el.type === 'image') { ctx.globalAlpha *= 0.35; ctx.fillStyle = ctx.strokeStyle; ctx.fill(); } else ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** Minimap overview; click or drag to navigate. */
export function Minimap() {
  const show = useCanvasStore((s) => s.appState.showMinimap && !s.appState.zenMode && !s.appState.presentation.active);
  if (!show) return null;
  return <MinimapBody />;
}

function MinimapBody() {
  const ref = useRef<HTMLCanvasElement>(null);
  const frozen = useRef<Mapping | null>(null);
  const mapping = useRef<Mapping | null>(null);
  const mod = useOptionalModule<MinimapModule>(PATHS.minimap);
  const modRef = useRef(mod);
  modRef.current = mod;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    let raf = 0;
    const draw = () => {
      raf = 0;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { elements, appState: a } = useCanvasStore.getState();
      const els = elements.filter((e) => !e.isDeleted);
      const view = { x: -a.scrollX, y: -a.scrollY, w: a.width / a.zoom, h: a.height / a.zoom };
      const m = frozen.current ?? computeMapping(els, view);
      mapping.current = m;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = a.theme === 'dark' ? '#1b1b20' : '#f8f9fa';
      ctx.fillRect(0, 0, W, H);
      let drawn = false;
      const renderMinimap = modRef.current?.renderMinimap;
      if (renderMinimap) {
        try { ctx.save(); renderMinimap(ctx, els, { ...m, theme: a.theme }); drawn = true; } catch { /* fall back */ } finally { ctx.restore(); }
      }
      if (!drawn) drawFallback(ctx, els, m);
      // viewport
      const vx = view.x * m.scale + m.offsetX, vy = view.y * m.scale + m.offsetY;
      const vw = view.w * m.scale, vh = view.h * m.scale;
      ctx.fillStyle = a.theme === 'dark' ? 'rgba(168,165,255,0.12)' : 'rgba(105,101,219,0.08)';
      ctx.fillRect(vx, vy, vw, vh);
      ctx.strokeStyle = a.theme === 'dark' ? '#a8a5ff' : '#6965db';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vx, vy, vw, vh);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
    draw();
    const unsub = useCanvasStore.subscribe(
      (s) => [s.sceneNonce, s.appState.scrollX, s.appState.scrollY, s.appState.zoom, s.appState.width, s.appState.height, s.appState.theme] as const,
      schedule,
      { equalityFn: (x, y) => x.every((v, i) => v === y[i]) },
    );
    return () => { unsub(); if (raf) cancelAnimationFrame(raf); };
  }, [mod]);

  const navigate = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const m = frozen.current ?? mapping.current;
    if (!m) return;
    const r = e.currentTarget.getBoundingClientRect();
    const sx = (e.clientX - r.left - m.offsetX) / m.scale;
    const sy = (e.clientY - r.top - m.offsetY) / m.scale;
    const a = useCanvasStore.getState().appState;
    setUi({ scrollX: a.width / (2 * a.zoom) - sx, scrollY: a.height / (2 * a.zoom) - sy });
  };

  return (
    <div className="sb-island sb-pe absolute sb-hide-narrow" style={{ right: 16, bottom: 64, padding: 4, width: W, height: H, boxSizing: 'content-box' }} data-testid="minimap">
      <canvas
        ref={ref}
        role="img"
        aria-label="Minimap. Click or drag to navigate"
        style={{ width: W, height: H, borderRadius: 6, cursor: 'pointer', display: 'block', touchAction: 'none' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          frozen.current = mapping.current;
          navigate(e);
        }}
        onPointerMove={(e) => { if (frozen.current) navigate(e); }}
        onPointerUp={() => { frozen.current = null; }}
        onPointerCancel={() => { frozen.current = null; }}
      />
      <button
        type="button"
        className="sb-tool"
        style={{ position: 'absolute', top: 8, right: 8, width: 22, height: 22, background: 'var(--island-bg)', boxShadow: 'var(--island-shadow)' }}
        aria-label="Hide minimap"
        onClick={() => setUi({ showMinimap: false })}
      >
        <X size={12} />
      </button>
    </div>
  );
}
