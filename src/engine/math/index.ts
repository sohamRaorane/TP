// Pure geometry helpers shared by rendering, hit testing and transformations.
import type { SketchElement } from '@/types/appState';

export type Vec = { x: number; y: number };
export type P2 = [number, number];

export const TAU = Math.PI * 2;

export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);

export const rotatePoint = (x: number, y: number, cx: number, cy: number, a: number): P2 => {
  if (!a) return [x, y];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
};

export const normalizeAngle = (a: number) => {
  let r = a % TAU;
  if (r < 0) r += TAU;
  // avoid 2π float noise
  if (Math.abs(r - TAU) < 1e-9) r = 0;
  return r;
};

/** shortest distance from point to segment ab */
export const distToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

export const distToPolyline = (px: number, py: number, pts: P2[], closed = false) => {
  if (pts.length === 1) return dist(px, py, pts[0][0], pts[0][1]);
  let d = Infinity;
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) d = Math.min(d, distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  if (closed && n > 2) d = Math.min(d, distToSegment(px, py, pts[n - 1][0], pts[n - 1][1], pts[0][0], pts[0][1]));
  return d;
};

export const pointInPolygon = (px: number, py: number, poly: P2[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
};

/** intersection param t (along p->q) of segment pq with segment ab, or null */
export const segmentIntersection = (
  px: number, py: number, qx: number, qy: number,
  ax: number, ay: number, bx: number, by: number,
): number | null => {
  const rx = qx - px, ry = qy - py, sx = bx - ax, sy = by - ay;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((ax - px) * sy - (ay - py) * sx) / den;
  const u = ((ax - px) * ry - (ay - py) * rx) / den;
  if (u < 0 || u > 1) return null;
  return t;
};

export const pointsBounds = (pts: readonly (readonly [number, number])[]) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!pts.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
};

export const hasPoints = (el: SketchElement): el is Extract<SketchElement, { points: P2[] }> =>
  el.type === 'arrow' || el.type === 'line' || el.type === 'freedraw';

/**
 * Local box of an element relative to (x, y): shapes use [0,w]x[0,h]; linear and
 * freedraw elements use the extent of their points (points may be negative).
 */
export const localBox = (el: SketchElement) => {
  if (hasPoints(el) && el.points.length) {
    const b = pointsBounds(el.points);
    return { ox: b.minX, oy: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
  }
  return { ox: 0, oy: 0, w: el.width, h: el.height };
};

/** rotation center in scene coords */
export const getElementCenter = (el: SketchElement): Vec => {
  const b = localBox(el);
  return { x: el.x + b.ox + b.w / 2, y: el.y + b.oy + b.h / 2 };
};

/** scene point -> element-local unrotated coords (relative to el.x, el.y) */
export const sceneToLocal = (el: SketchElement, x: number, y: number): P2 => {
  const c = getElementCenter(el);
  const [rx, ry] = rotatePoint(x, y, c.x, c.y, -el.angle);
  return [rx - el.x, ry - el.y];
};

/** element-local coords (relative to el.x, el.y, unrotated) -> scene */
export const localToScene = (el: SketchElement, lx: number, ly: number): P2 => {
  const c = getElementCenter(el);
  return rotatePoint(el.x + lx, el.y + ly, c.x, c.y, el.angle);
};

/** sample an ellipse inscribed in [0,w]x[0,h] */
export const ellipsePolygon = (w: number, h: number, n = 64): P2[] => {
  const pts: P2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    pts.push([w / 2 + (w / 2) * Math.cos(t), h / 2 + (h / 2) * Math.sin(t)]);
  }
  return pts;
};

export const diamondPolygon = (w: number, h: number): P2[] => [
  [w / 2, 0],
  [w, h / 2],
  [w / 2, h],
  [0, h / 2],
];

export const rectPolygon = (w: number, h: number): P2[] => [
  [0, 0],
  [w, 0],
  [w, h],
  [0, h],
];

/** Catmull-Rom sampled curve through points (matches roughjs curve with tightness 0 closely). */
export const sampleCurve = (pts: P2[], stepsPerSeg = 12): P2[] => {
  if (pts.length < 3) return pts.slice();
  const out: P2[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[i + 1];
    // catmull-rom -> bezier control points
    const c1: P2 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: P2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    for (let s = 1; s <= stepsPerSeg; s++) {
      const t = s / stepsPerSeg;
      const mt = 1 - t;
      out.push([
        mt * mt * mt * p1[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * p2[0],
        mt * mt * mt * p1[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * p2[1],
      ]);
    }
  }
  return out;
};

export const snapAngle = (a: number, step = Math.PI / 12) => Math.round(a / step) * step;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** rounded rect radius used by rendering & hit testing */
export const rectRadius = (w: number, h: number) => Math.min(Math.min(Math.abs(w), Math.abs(h)) * 0.25, 32);
