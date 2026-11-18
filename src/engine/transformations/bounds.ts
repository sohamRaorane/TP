// Bounds helpers. CONTRACT (Agent A may optimise/extend, keep signatures).
import type { SketchElement } from '@/types/appState';

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

const rotate = (x: number, y: number, cx: number, cy: number, a: number): [number, number] => {
  const c = Math.cos(a), s = Math.sin(a);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
};

/** axis-aligned bounds of an element in scene coords, rotation included */
export const getElementBounds = (el: SketchElement): Bounds => {
  let pts: [number, number][];
  if ('points' in el && el.points.length) {
    pts = el.points.map(([px, py]) => [el.x + px, el.y + py]);
  } else {
    pts = [[el.x, el.y], [el.x + el.width, el.y], [el.x + el.width, el.y + el.height], [el.x, el.y + el.height]];
  }
  if (el.angle) {
    const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
    pts = pts.map(([x, y]) => rotate(x, y, cx, cy, el.angle));
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY };
};

export const getCommonBounds = (els: SketchElement[]): Bounds | null => {
  const live = els.filter((e) => !e.isDeleted);
  if (!live.length) return null;
  const b = live.map(getElementBounds);
  return {
    minX: Math.min(...b.map((x) => x.minX)), minY: Math.min(...b.map((x) => x.minY)),
    maxX: Math.max(...b.map((x) => x.maxX)), maxY: Math.max(...b.map((x) => x.maxY)),
  };
};

export const boundsToRect = (b: Bounds) => ({ x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY });
