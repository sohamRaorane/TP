// Draw one element onto a 2D context whose transform is already in scene units.
import type { BinaryFiles, FrameElement, ImageElement, SketchElement, TextElement } from '@/types/appState';
import { getElementCenter, localBox } from '@/engine/math';
import { fontString, splitLines } from '@/engine/drawing/textMeasure';
import { drawDrawable, getElementShape } from './shapes';
import { getImage } from './imageCache';

export interface RenderElementOptions {
  files: BinaryFiles;
  /** extra opacity multiplier (eraser preview) */
  alpha?: number;
}

/** apply translate/rotate so that drawing at (0,0) is the element's (x,y) */
export const applyElementTransform = (ctx: CanvasRenderingContext2D, el: SketchElement) => {
  const c = getElementCenter(el);
  ctx.translate(c.x, c.y);
  if (el.angle) ctx.rotate(el.angle);
  ctx.translate(el.x - c.x, el.y - c.y);
};

export const textLineX = (el: TextElement) => (el.textAlign === 'center' ? el.width / 2 : el.textAlign === 'right' ? el.width : 0);

const drawText = (ctx: CanvasRenderingContext2D, el: TextElement) => {
  ctx.font = fontString(el.fontSize, el.fontFamily);
  ctx.fillStyle = el.strokeColor;
  ctx.textAlign = el.textAlign;
  ctx.textBaseline = 'middle';
  const lh = el.fontSize * el.lineHeight;
  const x = textLineX(el);
  splitLines(el.text).forEach((line, i) => ctx.fillText(line, x, i * lh + lh / 2));
};

const drawImage = (ctx: CanvasRenderingContext2D, el: ImageElement, files: BinaryFiles) => {
  const img = getImage(el.fileId, files);
  const w = el.width, h = el.height;
  if (!img) {
    // placeholder while loading / missing
    ctx.fillStyle = '#f1f3f5';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ced4da';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);
    return;
  }
  const [sx, sy] = el.scale ?? [1, 1];
  ctx.save();
  ctx.translate(sx < 0 ? w : 0, sy < 0 ? h : 0);
  ctx.scale(sx < 0 ? -1 : 1, sy < 0 ? -1 : 1);
  ctx.drawImage(img, 0, 0, w, h);
  ctx.restore();
};

export const renderElement = (ctx: CanvasRenderingContext2D, el: SketchElement, opts: RenderElementOptions) => {
  ctx.save();
  ctx.globalAlpha *= (el.opacity / 100) * (opts.alpha ?? 1);
  applyElementTransform(ctx, el);
  switch (el.type) {
    case 'text':
      drawText(ctx, el);
      break;
    case 'image':
      drawImage(ctx, el, opts.files);
      break;
    case 'freedraw': {
      const shape = getElementShape(el);
      if (shape.freedrawPath && typeof Path2D !== 'undefined') {
        ctx.fillStyle = el.strokeColor;
        ctx.fill(new Path2D(shape.freedrawPath));
      }
      break;
    }
    default: {
      const shape = getElementShape(el);
      for (const d of shape.drawables) drawDrawable(ctx, d);
    }
  }
  ctx.restore();
};

import { FRAME_LABEL_FONT } from '@/engine/constants';
export { FRAME_LABEL_FONT };
/** frame name drawn above the frame at constant screen size */
export const renderFrameLabel = (ctx: CanvasRenderingContext2D, el: FrameElement, zoom: number, color = '#868e96') => {
  ctx.save();
  applyElementTransform(ctx, el);
  ctx.font = `${FRAME_LABEL_FONT / zoom}px Helvetica, 'Segoe UI', Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  let name = el.name || 'Frame';
  const maxW = Math.max(el.width, 40 / zoom);
  while (name.length > 1 && ctx.measureText(name).width > maxW) name = name.slice(0, -2) + '…';
  ctx.fillText(name, 0, -4 / zoom);
  ctx.restore();
};

/** clip path for a frame (used for frame children) */
export const clipToFrame = (ctx: CanvasRenderingContext2D, frame: SketchElement) => {
  applyElementTransform(ctx, frame);
  const { w, h } = localBox(frame);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  // undo transform for subsequent drawing (clip region persists)
  const c = getElementCenter(frame);
  ctx.translate(c.x - frame.x, c.y - frame.y);
  if (frame.angle) ctx.rotate(-frame.angle);
  ctx.translate(-c.x, -c.y);
};
