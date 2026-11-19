// Static layer: background, grid and elements.
import type { BinaryFiles, FrameElement, SketchElement } from '@/types/appState';
import { boundsIntersect, expandBounds, getElementBounds, type Bounds } from '@/engine/transformations/bounds';
import { clipToFrame, renderElement, renderFrameLabel } from './renderElement';

export const GRID_SIZE = 20;

export interface StaticSceneParams {
  elements: SketchElement[]; // non-deleted, z-ordered
  files: BinaryFiles;
  scrollX: number;
  scrollY: number;
  zoom: number;
  /** CSS px */
  width: number;
  height: number;
  dpr: number;
  background: string | null;
  gridEnabled: boolean;
  pendingEraseIds?: Record<string, true>;
  hiddenIds?: Record<string, true | undefined>;
  /** draw frame names (screen-constant size) */
  frameLabels?: boolean;
}

export const drawGrid = (ctx: CanvasRenderingContext2D, p: StaticSceneParams) => {
  const step = GRID_SIZE * p.zoom;
  if (step < 4) return;
  const offX = (p.scrollX * p.zoom) % step;
  const offY = (p.scrollY * p.zoom) % step;
  ctx.save();
  ctx.lineWidth = 1;
  const minorVisible = step >= 8;
  const lines = (major: boolean) => {
    ctx.beginPath();
    for (let x = offX < 0 ? offX + step : offX; x <= p.width; x += step) {
      const idx = Math.round((x / p.zoom - p.scrollX) / GRID_SIZE);
      if ((idx % 5 === 0) !== major) continue;
      const px = Math.round(x) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, p.height);
    }
    for (let y = offY < 0 ? offY + step : offY; y <= p.height; y += step) {
      const idx = Math.round((y / p.zoom - p.scrollY) / GRID_SIZE);
      if ((idx % 5 === 0) !== major) continue;
      const py = Math.round(y) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(p.width, py);
    }
    ctx.stroke();
  };
  if (minorVisible) {
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    lines(false);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  lines(true);
  ctx.restore();
};

/** viewport in scene coords */
export const viewportBounds = (p: { scrollX: number; scrollY: number; zoom: number; width: number; height: number }): Bounds => ({
  minX: -p.scrollX,
  minY: -p.scrollY,
  maxX: -p.scrollX + p.width / p.zoom,
  maxY: -p.scrollY + p.height / p.zoom,
});

/** draw elements with frame clipping; ctx must already be in scene space */
export const drawElements = (
  ctx: CanvasRenderingContext2D,
  elements: SketchElement[],
  opts: { files: BinaryFiles; view?: Bounds; pendingEraseIds?: Record<string, true>; hiddenIds?: Record<string, true | undefined>; zoom: number; frameLabels?: boolean },
) => {
  const frames = new Map<string, FrameElement>();
  for (const el of elements) if (el.type === 'frame') frames.set(el.id, el);
  const visible = (el: SketchElement) => !opts.view || boundsIntersect(expandBounds(getElementBounds(el), el.strokeWidth * 4 + 40), opts.view);
  // frames first so their children are always on top
  for (const f of frames.values()) {
    if (opts.hiddenIds?.[f.id] || !visible(f)) continue;
    renderElement(ctx, f, { files: opts.files, alpha: opts.pendingEraseIds?.[f.id] ? 0.25 : 1 });
  }
  for (const el of elements) {
    if (el.type === 'frame' || opts.hiddenIds?.[el.id] || !visible(el)) continue;
    const alpha = opts.pendingEraseIds?.[el.id] ? 0.25 : 1;
    const frame = el.frameId ? frames.get(el.frameId) : undefined;
    if (frame) {
      ctx.save();
      clipToFrame(ctx, frame);
      renderElement(ctx, el, { files: opts.files, alpha });
      ctx.restore();
    } else renderElement(ctx, el, { files: opts.files, alpha });
  }
  if (opts.frameLabels !== false)
    for (const f of frames.values()) if (!opts.hiddenIds?.[f.id] && visible(f)) renderFrameLabel(ctx, f, opts.zoom);
};

export const renderStaticScene = (ctx: CanvasRenderingContext2D, p: StaticSceneParams) => {
  ctx.save();
  ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
  ctx.clearRect(0, 0, p.width, p.height);
  if (p.background) {
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, p.width, p.height);
  }
  if (p.gridEnabled) drawGrid(ctx, p);
  ctx.scale(p.zoom, p.zoom);
  ctx.translate(p.scrollX, p.scrollY);
  drawElements(ctx, p.elements, {
    files: p.files,
    view: viewportBounds(p),
    pendingEraseIds: p.pendingEraseIds,
    hiddenIds: p.hiddenIds,
    zoom: p.zoom,
    frameLabels: p.frameLabels,
  });
  ctx.restore();
};
