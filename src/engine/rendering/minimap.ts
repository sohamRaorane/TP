// Minimap rendering for the UI minimap panel.
// renderMinimap maps scene -> minimap as `x * scale + offsetX` (same for y).
import type { SketchElement } from '@/types/appState';
import { getCommonBounds, getElementBounds } from '@/engine/transformations/bounds';
import { renderElement } from './renderElement';
import { DARK_FILTER } from './index';

export interface MinimapRenderOptions {
  scale: number;
  offsetX: number;
  offsetY: number;
  theme: 'light' | 'dark';
}

/**
 * Draw simplified elements onto `ctx` (the caller owns clearing, DPR transform
 * and the viewport rectangle). Tiny elements, text and images are drawn as blocks.
 */
export function renderMinimap(ctx: CanvasRenderingContext2D, els: SketchElement[], opts: MinimapRenderOptions): void {
  const { scale, offsetX, offsetY } = opts;
  ctx.save();
  if (opts.theme === 'dark' && 'filter' in ctx) ctx.filter = DARK_FILTER;
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  for (const el of els) {
    if (el.isDeleted) continue;
    const b = getElementBounds(el);
    const tiny = (b.maxX - b.minX) * scale < 3 && (b.maxY - b.minY) * scale < 3;
    if (tiny || el.type === 'text' || el.type === 'image') {
      ctx.save();
      ctx.fillStyle = el.type === 'image' ? '#ced4da' : el.strokeColor === 'transparent' ? '#adb5bd' : el.strokeColor;
      ctx.globalAlpha = el.type === 'text' ? 0.35 : 0.6;
      ctx.fillRect(b.minX, b.minY, Math.max(b.maxX - b.minX, 1 / scale), Math.max(b.maxY - b.minY, 1 / scale));
      ctx.restore();
    } else renderElement(ctx, el, { files: {} });
  }
  ctx.restore();
}

export interface MinimapViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
  /** main canvas CSS size */
  width: number;
  height: number;
}

/** scale/offset that fit content + current viewport into a width x height minimap */
export function getMinimapTransform(els: SketchElement[], v: MinimapViewport, width: number, height: number, pad = 8) {
  const vr = { minX: -v.scrollX, minY: -v.scrollY, maxX: -v.scrollX + v.width / v.zoom, maxY: -v.scrollY + v.height / v.zoom };
  const cb = getCommonBounds(els.filter((e) => !e.isDeleted));
  const b = cb
    ? { minX: Math.min(cb.minX, vr.minX), minY: Math.min(cb.minY, vr.minY), maxX: Math.max(cb.maxX, vr.maxX), maxY: Math.max(cb.maxY, vr.maxY) }
    : vr;
  const bw = Math.max(b.maxX - b.minX, 1), bh = Math.max(b.maxY - b.minY, 1);
  const scale = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh);
  return {
    scale,
    offsetX: (width - bw * scale) / 2 - b.minX * scale,
    offsetY: (height - bh * scale) / 2 - b.minY * scale,
    /** viewport rectangle in minimap px */
    viewportRect: {
      x: vr.minX * scale + (width - bw * scale) / 2 - b.minX * scale,
      y: vr.minY * scale + (height - bh * scale) / 2 - b.minY * scale,
      width: (vr.maxX - vr.minX) * scale,
      height: (vr.maxY - vr.minY) * scale,
    },
  };
}

/** scroll values that center the main view on the clicked minimap point */
export function minimapPointToViewport(
  mx: number,
  my: number,
  t: { scale: number; offsetX: number; offsetY: number },
  viewport: MinimapViewport,
): { scrollX: number; scrollY: number } {
  const sceneX = (mx - t.offsetX) / t.scale;
  const sceneY = (my - t.offsetY) / t.scale;
  return { scrollX: viewport.width / 2 / viewport.zoom - sceneX, scrollY: viewport.height / 2 / viewport.zoom - sceneY };
}
