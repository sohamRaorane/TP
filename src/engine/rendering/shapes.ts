// Element -> rough.js drawables (in element-local coordinates, origin = el.x/el.y).
// Cached per element id + version so the generator runs once per change.
import rough from 'roughjs';
import type { Drawable, Options } from 'roughjs/bin/core';
import { getStroke } from 'perfect-freehand';
import type { Arrowhead, FreedrawElement, LinearElement, SketchElement } from '@/types/appState';
import { rectRadius, sampleCurve, type P2 } from '@/engine/math';

const generator = rough.generator();

export interface ElementShape {
  drawables: Drawable[];
  /** freedraw outline as SVG path data (filled with strokeColor) */
  freedrawPath?: string;
}

const cache = new Map<string, { version: number; shape: ElementShape }>();

export const clearShapeCache = () => cache.clear();

export const roughOptions = (el: SketchElement, overrides: Options = {}): Options => {
  const sw = el.strokeWidth;
  const o: Options = {
    seed: el.seed % 2147483647 || 1,
    roughness: el.roughness,
    bowing: el.roughness === 0 ? 0 : 1,
    stroke: el.strokeColor === 'transparent' ? 'none' : el.strokeColor,
    strokeWidth: sw,
    fillStyle: el.fillStyle,
    fillWeight: sw / 2,
    hachureGap: sw * 4,
    preserveVertices: el.roughness < 2,
    // default rough curves look great; for architect mode keep lines crisp
    disableMultiStroke: el.strokeStyle !== 'solid' || el.roughness === 0,
    curveFitting: 0.95,
  };
  if (el.strokeStyle === 'dashed') o.strokeLineDash = [8 + sw, 8 + sw];
  else if (el.strokeStyle === 'dotted') o.strokeLineDash = [1.5, 6 + sw * 1.5];
  if (el.backgroundColor && el.backgroundColor !== 'transparent') {
    o.fill = el.backgroundColor;
  }
  return { ...o, ...overrides };
};

const roundedRectPath = (w: number, h: number) => {
  const r = rectRadius(w, h);
  return `M ${r} 0 L ${w - r} 0 Q ${w} 0, ${w} ${r} L ${w} ${h - r} Q ${w} ${h}, ${w - r} ${h} L ${r} ${h} Q 0 ${h}, 0 ${h - r} L 0 ${r} Q 0 0, ${r} 0 Z`;
};

const roundedDiamondPath = (w: number, h: number) => {
  // offsets along each edge from the vertex
  const r = Math.min(rectRadius(w, h) * 0.6, Math.hypot(w, h) / 8);
  const top: P2 = [w / 2, 0], right: P2 = [w, h / 2], bottom: P2 = [w / 2, h], left: P2 = [0, h / 2];
  const len = Math.hypot(w / 2, h / 2) || 1;
  const k = r / len;
  const along = (a: P2, b: P2): P2 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  const p = (pt: P2) => `${pt[0]} ${pt[1]}`;
  return [
    `M ${p(along(top, right))}`,
    `L ${p(along(right, top))} Q ${p(right)}, ${p(along(right, bottom))}`,
    `L ${p(along(bottom, right))} Q ${p(bottom)}, ${p(along(bottom, left))}`,
    `L ${p(along(left, bottom))} Q ${p(left)}, ${p(along(left, top))}`,
    `L ${p(along(top, left))} Q ${p(top)}, ${p(along(top, right))} Z`,
  ].join(' ');
};

export const arrowheadSize = (head: Arrowhead, strokeWidth: number) => {
  const base = head === 'arrow' ? 22 : head === 'bar' ? 12 : 13;
  return base * (0.75 + strokeWidth * 0.125);
};

/** points of the arrowhead shape at `tip` coming from `from` */
export const arrowheadGeometry = (head: Exclude<Arrowhead, null>, tip: P2, from: P2, strokeWidth: number, segLen: number) => {
  const size = Math.min(arrowheadSize(head, strokeWidth), segLen * (head === 'arrow' ? 0.6 : 0.45));
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const spread = head === 'arrow' ? Math.PI / 7.5 : Math.PI / 7;
  const a1: P2 = [tip[0] - size * Math.cos(ang - spread), tip[1] - size * Math.sin(ang - spread)];
  const a2: P2 = [tip[0] - size * Math.cos(ang + spread), tip[1] - size * Math.sin(ang + spread)];
  const perp = ang + Math.PI / 2;
  const half = size / 2;
  return {
    size,
    ang,
    wings: [a1, a2] as [P2, P2],
    bar: [
      [tip[0] + half * Math.cos(perp), tip[1] + half * Math.sin(perp)],
      [tip[0] - half * Math.cos(perp), tip[1] - half * Math.sin(perp)],
    ] as [P2, P2],
  };
};

const arrowheadDrawables = (el: LinearElement, pts: P2[], at: 'start' | 'end'): Drawable[] => {
  const head = at === 'start' ? el.startArrowhead : el.endArrowhead;
  if (!head || pts.length < 2) return [];
  const tip = at === 'start' ? pts[0] : pts[pts.length - 1];
  // direction: pick a point a bit back along the path (handles curves)
  let from = at === 'start' ? pts[1] : pts[pts.length - 2];
  const seq = at === 'start' ? pts : [...pts].reverse();
  let acc = 0;
  for (let i = 1; i < seq.length; i++) {
    acc += Math.hypot(seq[i][0] - seq[i - 1][0], seq[i][1] - seq[i - 1][1]);
    from = seq[i];
    if (acc > 12) break;
  }
  let segLen = 0;
  for (let i = 1; i < pts.length; i++) segLen += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (segLen < 1) return [];
  const g = arrowheadGeometry(head, tip, from, el.strokeWidth, segLen);
  const opts = roughOptions(el, { strokeLineDash: undefined, fill: undefined, disableMultiStroke: el.roughness === 0 });
  const solid = { ...opts, fill: el.strokeColor, fillStyle: 'solid' };
  switch (head) {
    case 'arrow':
      return [generator.linearPath([g.wings[0], tip, g.wings[1]], opts)];
    case 'triangle':
      return [generator.polygon([tip, g.wings[0], g.wings[1]], solid)];
    case 'dot': {
      const d = g.size * 0.75;
      return [generator.circle(tip[0], tip[1], d, solid)];
    }
    case 'bar':
      return [generator.line(g.bar[0][0], g.bar[0][1], g.bar[1][0], g.bar[1][1], opts)];
  }
  return [];
};

/** perfect-freehand outline -> SVG path data */
export const strokeToPath = (stroke: number[][]) => {
  if (!stroke.length) return '';
  const d: (string | number)[] = ['M', stroke[0][0].toFixed(2), stroke[0][1].toFixed(2), 'Q'];
  for (let i = 0; i < stroke.length; i++) {
    const [x0, y0] = stroke[i];
    const [x1, y1] = stroke[(i + 1) % stroke.length];
    d.push(x0.toFixed(2), y0.toFixed(2), ((x0 + x1) / 2).toFixed(2), ((y0 + y1) / 2).toFixed(2));
  }
  d.push('Z');
  return d.join(' ');
};

export const freedrawOutline = (el: FreedrawElement) => {
  const input = el.points.map(([x, y], i) => [x, y, el.pressures[i] ?? 0.5]);
  if (input.length === 1) input.push([input[0][0] + 0.1, input[0][1] + 0.1, input[0][2]]);
  return getStroke(input, {
    size: el.strokeWidth * 4.25,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: el.simulatePressure,
    easing: (t) => Math.sin((t * Math.PI) / 2),
    last: true,
  });
};

const generate = (el: SketchElement): ElementShape => {
  const w = el.width;
  const h = el.height;
  switch (el.type) {
    case 'rectangle':
      return {
        drawables: [
          el.roundness ? generator.path(roundedRectPath(w, h), roughOptions(el)) : generator.rectangle(0, 0, w, h, roughOptions(el)),
        ],
      };
    case 'diamond':
      return {
        drawables: [
          el.roundness
            ? generator.path(roundedDiamondPath(w, h), roughOptions(el))
            : generator.polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], roughOptions(el)),
        ],
      };
    case 'ellipse':
      return { drawables: [generator.ellipse(w / 2, h / 2, w, h, roughOptions(el, { curveFitting: 1 }))] };
    case 'line':
    case 'arrow': {
      const pts = el.points as P2[];
      if (pts.length < 2) return { drawables: [] };
      const closed = el.type === 'line' && pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1;
      const opts = roughOptions(el, closed ? {} : { fill: undefined });
      const curved = el.roundness && pts.length > 2;
      const main = curved
        ? generator.curve(pts, opts)
        : closed
          ? generator.polygon(pts.slice(0, -1), opts)
          : generator.linearPath(pts, opts);
      const path = curved ? sampleCurve(pts) : pts;
      return {
        drawables: [main, ...(el.type === 'arrow' ? [...arrowheadDrawables(el, path, 'start'), ...arrowheadDrawables(el, path, 'end')] : [])],
      };
    }
    case 'freedraw':
      return { drawables: [], freedrawPath: strokeToPath(freedrawOutline(el)) };
    case 'frame':
      return {
        drawables: [
          generator.path(
            `M 8 0 L ${w - 8} 0 Q ${w} 0, ${w} 8 L ${w} ${h - 8} Q ${w} ${h}, ${w - 8} ${h} L 8 ${h} Q 0 ${h}, 0 ${h - 8} L 0 8 Q 0 0, 8 0 Z`,
            { roughness: 0, stroke: el.strokeColor || '#bbb', strokeWidth: 1, seed: el.seed || 1, preserveVertices: true, disableMultiStroke: true },
          ),
        ],
      };
    default:
      return { drawables: [] };
  }
};

export const getElementShape = (el: SketchElement): ElementShape => {
  const hit = cache.get(el.id);
  if (hit && hit.version === el.version) return hit.shape;
  const shape = generate(el);
  cache.set(el.id, { version: el.version, shape });
  // keep the cache bounded
  if (cache.size > 5000) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  return shape;
};

/** draw a rough.js drawable on any 2D context (no RoughCanvas instance needed) */
export const drawDrawable = (ctx: CanvasRenderingContext2D, d: Drawable) => {
  const o = d.options;
  for (const set of d.sets) {
    if (set.type === 'path') {
      if (!o.stroke || o.stroke === 'none') continue;
      ctx.save();
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = o.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (o.strokeLineDash) ctx.setLineDash(o.strokeLineDash);
      tracePath(ctx, set.ops);
      ctx.stroke();
      ctx.restore();
    } else if (set.type === 'fillPath') {
      ctx.save();
      ctx.fillStyle = o.fill || 'transparent';
      tracePath(ctx, set.ops);
      ctx.fill(d.shape === 'curve' || d.shape === 'polygon' || d.shape === 'path' ? 'evenodd' : 'nonzero');
      ctx.restore();
    } else if (set.type === 'fillSketch') {
      ctx.save();
      ctx.strokeStyle = o.fill || 'transparent';
      let fw = o.fillWeight;
      if (fw < 0) fw = o.strokeWidth / 2;
      ctx.lineWidth = fw;
      ctx.lineCap = 'round';
      if (o.fillLineDash) ctx.setLineDash(o.fillLineDash);
      tracePath(ctx, set.ops);
      ctx.stroke();
      ctx.restore();
    }
  }
};

const tracePath = (ctx: CanvasRenderingContext2D, ops: Drawable['sets'][number]['ops']) => {
  ctx.beginPath();
  for (const item of ops) {
    const d = item.data;
    if (item.op === 'move') ctx.moveTo(d[0], d[1]);
    else if (item.op === 'bcurveTo') ctx.bezierCurveTo(d[0], d[1], d[2], d[3], d[4], d[5]);
    else ctx.lineTo(d[0], d[1]);
  }
};

export { generator as roughGenerator };
