// Bounds helpers. CONTRACT (Agent A may optimise/extend, keep signatures).
import type { SketchElement } from '@/types/appState';
import { getElementCenter, hasPoints, rotatePoint, sampleCurve, type P2 } from '@/engine/math';

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

/** element outline points in scene coords (rotation applied), used for bounds */
const scenePoints = (el: SketchElement): P2[] => {
  let pts: P2[];
  if (hasPoints(el) && el.points.length) {
    const local = el.type !== 'freedraw' && el.roundness && el.points.length > 2 ? sampleCurve(el.points, 6) : el.points;
    pts = local.map(([px, py]) => [el.x + px, el.y + py] as P2);
  } else if (el.type === 'ellipse' && el.angle) {
    // exact rotated ellipse extents
    const c = getElementCenter(el);
    const a = el.width / 2, b = el.height / 2;
    const cos = Math.cos(el.angle), sin = Math.sin(el.angle);
    const hw = Math.sqrt(a * a * cos * cos + b * b * sin * sin);
    const hh = Math.sqrt(a * a * sin * sin + b * b * cos * cos);
    return [[c.x - hw, c.y - hh], [c.x + hw, c.y + hh]];
  } else {
    pts = [[el.x, el.y], [el.x + el.width, el.y], [el.x + el.width, el.y + el.height], [el.x, el.y + el.height]];
  }
  if (el.angle) {
    const c = getElementCenter(el);
    pts = pts.map(([x, y]) => rotatePoint(x, y, c.x, c.y, el.angle));
  }
  return pts;
};

/** axis-aligned bounds of an element in scene coords, rotation included */
export const getElementBounds = (el: SketchElement): Bounds => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of scenePoints(el)) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
};

export const getCommonBounds = (els: SketchElement[]): Bounds | null => {
  const live = els.filter((e) => !e.isDeleted);
  if (!live.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of live) {
    const b = getElementBounds(el);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
};

export const boundsToRect = (b: Bounds) => ({ x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY });

export const boundsIntersect = (a: Bounds, b: Bounds) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

export const boundsContain = (outer: Bounds, inner: Bounds) =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;

export const expandBounds = (b: Bounds, pad: number): Bounds => ({
  minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad,
});
