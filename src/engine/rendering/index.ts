// Rendering public API. CONTRACT — Agent A implements; other agents only import these.
import type { BinaryFiles, SketchElement } from '@/types/appState';
import type { Drawable } from 'roughjs/bin/core';
import { getElementCenter, localBox } from '@/engine/math';
import { getCommonBounds, type Bounds } from '@/engine/transformations/bounds';
import { FONT_FAMILIES, lineBaselineY, splitLines } from '@/engine/drawing/textMeasure';
import { FRAME_LABEL_FONT } from '@/engine/constants';
import { drawElements } from './renderScene';
import { getElementShape, roughGenerator } from './shapes';
import { textLineX } from './renderElement';

export { preloadImages } from './imageCache';

export interface ExportOptions {
  /** pixel ratio for PNG (1, 2, 3) */
  scale: number;
  /** padding in scene units around content */
  padding: number;
  /** null = transparent */
  background: string | null;
  theme: 'light' | 'dark';
}

export const DARK_FILTER = 'invert(93%) hue-rotate(180deg)';

/** content bounds incl. frame labels */
export const exportBounds = (els: SketchElement[]): Bounds => {
  const live = els.filter((e) => !e.isDeleted);
  const b = getCommonBounds(live) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  for (const f of live) if (f.type === 'frame') b.minY = Math.min(b.minY, f.y - FRAME_LABEL_FONT - 8);
  return b;
};

const createCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

/** Render elements (already filtered to what should be exported) onto a new canvas sized to content. */
export function exportToCanvas(els: SketchElement[], files: BinaryFiles, opts: ExportOptions): HTMLCanvasElement {
  const live = els.filter((e) => !e.isDeleted);
  const b = exportBounds(live);
  const pad = opts.padding;
  const w = b.maxX - b.minX + pad * 2;
  const h = b.maxY - b.minY + pad * 2;
  const scale = opts.scale || 1;
  const canvas = createCanvas(w * scale, h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(pad - b.minX, pad - b.minY);
  drawElements(ctx, live, { files, zoom: 1 });
  ctx.restore();
  if (opts.theme === 'dark') {
    const out = createCanvas(canvas.width, canvas.height);
    const octx = out.getContext('2d');
    if (!octx) return canvas;
    octx.filter = DARK_FILTER;
    octx.drawImage(canvas, 0, 0);
    return out;
  }
  return canvas;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

const elementTransform = (el: SketchElement) => {
  const c = getElementCenter(el);
  const deg = (el.angle * 180) / Math.PI;
  return `translate(${fmt(c.x)} ${fmt(c.y)}) rotate(${fmt(deg)}) translate(${fmt(el.x - c.x)} ${fmt(el.y - c.y)})`;
};

const drawableToSvg = (doc: Document, d: Drawable, parent: Element) => {
  const o = d.options;
  for (const set of d.sets) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', roughGenerator.opsToPath(set, o.fixedDecimalPlaceDigits));
    if (set.type === 'path') {
      if (!o.stroke || o.stroke === 'none') continue;
      path.setAttribute('stroke', o.stroke);
      path.setAttribute('stroke-width', String(o.strokeWidth));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      if (o.strokeLineDash) path.setAttribute('stroke-dasharray', o.strokeLineDash.join(' '));
    } else if (set.type === 'fillPath') {
      path.setAttribute('stroke', 'none');
      path.setAttribute('fill', o.fill || 'none');
      if (d.shape === 'curve' || d.shape === 'polygon' || d.shape === 'path') path.setAttribute('fill-rule', 'evenodd');
    } else {
      path.setAttribute('stroke', o.fill || 'none');
      path.setAttribute('stroke-width', String(o.fillWeight < 0 ? o.strokeWidth / 2 : o.fillWeight));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
    }
    parent.appendChild(path);
  }
};

const elementToSvg = (doc: Document, el: SketchElement, files: BinaryFiles): Element => {
  const g = doc.createElementNS(SVG_NS, 'g');
  g.setAttribute('transform', elementTransform(el));
  if (el.opacity < 100) g.setAttribute('opacity', String(el.opacity / 100));
  switch (el.type) {
    case 'text': {
      const t = doc.createElementNS(SVG_NS, 'text');
      t.setAttribute('font-family', FONT_FAMILIES[el.fontFamily] ?? FONT_FAMILIES[1]);
      t.setAttribute('font-size', String(el.fontSize));
      t.setAttribute('fill', el.strokeColor);
      t.setAttribute('text-anchor', el.textAlign === 'center' ? 'middle' : el.textAlign === 'right' ? 'end' : 'start');
      const metricsOk = lineBaselineY(0, el.fontSize, el.fontFamily, el.lineHeight) !== null;
      if (!metricsOk) t.setAttribute('dominant-baseline', 'central');
      t.setAttribute('style', 'white-space: pre');
      const lh = el.fontSize * el.lineHeight;
      splitLines(el.text).forEach((line, i) => {
        const span = doc.createElementNS(SVG_NS, 'tspan');
        span.setAttribute('x', fmt(textLineX(el)));
        span.setAttribute('y', fmt(metricsOk ? lineBaselineY(i, el.fontSize, el.fontFamily, el.lineHeight)! : i * lh + lh / 2));
        span.textContent = line;
        t.appendChild(span);
      });
      g.appendChild(t);
      break;
    }
    case 'image': {
      const file = files[el.fileId];
      if (!file) break;
      const img = doc.createElementNS(SVG_NS, 'image');
      img.setAttribute('href', file.dataURL);
      img.setAttribute('width', fmt(el.width));
      img.setAttribute('height', fmt(el.height));
      img.setAttribute('preserveAspectRatio', 'none');
      const [sx, sy] = el.scale ?? [1, 1];
      if (sx < 0 || sy < 0)
        img.setAttribute('transform', `translate(${sx < 0 ? fmt(el.width) : 0} ${sy < 0 ? fmt(el.height) : 0}) scale(${sx < 0 ? -1 : 1} ${sy < 0 ? -1 : 1})`);
      g.appendChild(img);
      break;
    }
    case 'freedraw': {
      const shape = getElementShape(el);
      const p = doc.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', shape.freedrawPath ?? '');
      p.setAttribute('fill', el.strokeColor);
      g.appendChild(p);
      break;
    }
    default:
      for (const d of getElementShape(el).drawables) drawableToSvg(doc, d, g);
  }
  return g;
};

/** Build a standalone SVG element (fonts embedded/referenced, images inlined). */
export function exportToSvg(els: SketchElement[], files: BinaryFiles, opts: Omit<ExportOptions, 'scale'>): SVGSVGElement {
  const doc = document;
  const live = els.filter((e) => !e.isDeleted);
  const b = exportBounds(live);
  const pad = opts.padding;
  const w = b.maxX - b.minX + pad * 2;
  const h = b.maxY - b.minY + pad * 2;
  const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('version', '1.1');
  svg.setAttribute('width', fmt(w));
  svg.setAttribute('height', fmt(h));
  svg.setAttribute('viewBox', `0 0 ${fmt(w)} ${fmt(h)}`);
  if (opts.theme === 'dark') svg.setAttribute('style', `filter: ${DARK_FILTER}`);
  const defs = doc.createElementNS(SVG_NS, 'defs');
  const style = doc.createElementNS(SVG_NS, 'style');
  if (live.some((e) => e.type === 'text' && e.fontFamily === 1)) {
    style.textContent = `@import url('https://fonts.googleapis.com/css2?family=Kalam&display=swap');`;
    defs.appendChild(style);
  }
  svg.appendChild(defs);
  if (opts.background) {
    const r = doc.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', '0');
    r.setAttribute('y', '0');
    r.setAttribute('width', fmt(w));
    r.setAttribute('height', fmt(h));
    r.setAttribute('fill', opts.background);
    svg.appendChild(r);
  }
  const root = doc.createElementNS(SVG_NS, 'g');
  root.setAttribute('transform', `translate(${fmt(pad - b.minX)} ${fmt(pad - b.minY)})`);
  svg.appendChild(root);
  const frames = new Map<string, SketchElement>();
  for (const el of live) if (el.type === 'frame') frames.set(el.id, el);
  // frames first (behind), each with a clip path for its children
  for (const f of frames.values()) {
    root.appendChild(elementToSvg(doc, f, files));
    const clip = doc.createElementNS(SVG_NS, 'clipPath');
    clip.setAttribute('id', `clip-${f.id}`);
    const r = doc.createElementNS(SVG_NS, 'rect');
    const box = localBox(f);
    r.setAttribute('width', fmt(box.w));
    r.setAttribute('height', fmt(box.h));
    r.setAttribute('transform', elementTransform(f));
    clip.appendChild(r);
    defs.appendChild(clip);
  }
  for (const el of live) {
    if (el.type === 'frame') continue;
    const node = elementToSvg(doc, el, files);
    if (el.frameId && frames.has(el.frameId)) {
      const wrap = doc.createElementNS(SVG_NS, 'g');
      wrap.setAttribute('clip-path', `url(#clip-${el.frameId})`);
      wrap.appendChild(node);
      root.appendChild(wrap);
    } else root.appendChild(node);
  }
  for (const f of frames.values()) {
    if (f.type !== 'frame') continue;
    const t = doc.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', fmt(f.x));
    t.setAttribute('y', fmt(f.y - 4));
    t.setAttribute('font-family', FONT_FAMILIES[2]);
    t.setAttribute('font-size', String(FRAME_LABEL_FONT));
    t.setAttribute('fill', '#868e96');
    t.textContent = f.name || 'Frame';
    root.appendChild(t);
  }
  return svg;
}
