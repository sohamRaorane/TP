// Minimap renderer for the UI minimap panel.
import type { SketchElement } from '@/types/appState';
import { getCommonBounds, getElementBounds, type Bounds } from '@/engine/transformations/bounds';
import { renderElement } from './renderElement';

export interface MinimapViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
  /** canvas CSS size */
  width: number;
  height: number;
}

export interface MinimapTransform {
  /** scene -> minimap: mx = (x - originX) * scale + offsetX */
  scale: number;
  originX: number;
  originY: number;
  offsetX: number;
  offsetY: number;
}

const viewportRect = (v: MinimapViewport): Bounds => ({
  minX: -v.scrollX,
  minY: -v.scrollY,
  maxX: -v.scrollX + v.width / v.zoom,
  maxY: -v.scrollY + v.height / v.zoom,
});

/** world area shown by the minimap: content + current viewport */
export const minimapTransform = (elements: SketchElement[], v: MinimapViewport, width: number, height: number, pad = 8): MinimapTransform => {
  const vr = viewportRect(v);
  const cb = getCommonBounds(elements);
  const b = cb
    ? { minX: Math.min(cb.minX, vr.minX), minY: Math.min(cb.minY, vr.minY), maxX: Math.max(cb.maxX, vr.maxX), maxY: Math.max(cb.maxY, vr.maxY) }
    : vr;
  const bw = Math.max(b.maxX - b.minX, 1), bh = Math.max(b.maxY - b.minY, 1);
  const scale = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh);
  return {
    scale,
    originX: b.minX,
    originY: b.minY,
    offsetX: (width - bw * scale) / 2,
    offsetY: (height - bh * scale) / 2,
  };
};

/**
 * Draw elements (simplified when tiny) + the viewport rectangle onto `canvas`
 * (`width` x `height` CSS px; canvas backing store is sized for devicePixelRatio).
 */
export function renderMinimap(canvas: HTMLCanvasElement, elements: SketchElement[], viewport: MinimapViewport, width: number, height: number): MinimapTransform {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const live = elements.filter((e) => !e.isDeleted);
  const t = minimapTransform(live, viewport, width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return t;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(t.offsetX, t.offsetY);
  ctx.scale(t.scale, t.scale);
  ctx.translate(-t.originX, -t.originY);
  for (const el of live) {
    const b = getElementBounds(el);
    const tiny = (b.maxX - b.minX) * t.scale < 3 && (b.maxY - b.minY) * t.scale < 3;
    if (tiny || el.type === 'text' || el.type === 'image') {
      ctx.fillStyle = el.type === 'image' ? '#ced4da' : el.strokeColor === 'transparent' ? '#adb5bd' : el.strokeColor;
      ctx.globalAlpha = el.type === 'text' ? 0.35 : 0.6;
      ctx.fillRect(b.minX, b.minY, Math.max(b.maxX - b.minX, 1 / t.scale), Math.max(b.maxY - b.minY, 1 / t.scale));
      ctx.globalAlpha = 1;
    } else renderElement(ctx, el, { files: {} });
  }
  ctx.restore();
  // viewport
  const vr = viewportRect(viewport);
  const x = (vr.minX - t.originX) * t.scale + t.offsetX;
  const y = (vr.minY - t.originY) * t.scale + t.offsetY;
  ctx.fillStyle = 'rgba(105,101,219,0.08)';
  ctx.strokeStyle = '#6965db';
  ctx.lineWidth = 1.5;
  ctx.fillRect(x, y, (vr.maxX - vr.minX) * t.scale, (vr.maxY - vr.minY) * t.scale);
  ctx.strokeRect(x, y, (vr.maxX - vr.minX) * t.scale, (vr.maxY - vr.minY) * t.scale);
  return t;
}

/** viewport scroll that centers the main view on the clicked minimap point */
export function minimapPointToViewport(
  mx: number,
  my: number,
  t: MinimapTransform,
  viewport: MinimapViewport,
): { scrollX: number; scrollY: number } {
  const sceneX = (mx - t.offsetX) / t.scale + t.originX;
  const sceneY = (my - t.offsetY) / t.scale + t.originY;
  return {
    scrollX: viewport.width / 2 / viewport.zoom - sceneX,
    scrollY: viewport.height / 2 / viewport.zoom - sceneY,
  };
}
