// Pure geometric transforms used by actions. Each returns a changes map for
// useCanvasStore.updateElements (no mutation, no store access).
import type { LinearElement, Point, SketchElement } from '@/types/appState';
import type { ElementChanges } from '@/store/canvasStore';
import { getCommonBounds, getElementBounds, type Bounds } from '@/engine/transformations/bounds';

export type Changes = Record<string, ElementChanges>;
export type AlignEdge = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

const neg = (v: number) => (v === 0 ? 0 : -v);

/** width/height = extent of points */
export const pointsExtent = (points: Point[]) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { width: maxX - minX, height: maxY - minY };
};

/** mirror elements around the center of their common bounds */
export function flipElements(els: readonly SketchElement[], axis: 'horizontal' | 'vertical'): Changes {
  const b = getCommonBounds(els as SketchElement[]);
  if (!b) return {};
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const h = axis === 'horizontal';
  const out: Changes = {};
  for (const el of els) {
    if (el.isDeleted || el.locked) continue;
    const ch: ElementChanges = { angle: el.angle ? normAngle(-el.angle) : 0 };
    if (el.type === 'arrow' || el.type === 'line' || el.type === 'freedraw') {
      // point 0 stays the origin: mirror the origin, negate relative coords on the axis
      if (h) ch.x = 2 * cx - el.x;
      else ch.y = 2 * cy - el.y;
      ch.points = el.points.map(([px, py]) => (h ? [neg(px), py] : [px, neg(py)]) as Point);
      if (el.type !== 'freedraw') {
        const l = el as LinearElement;
        // bindings survive (same targets, also mirrored); focus flips sign
        if (l.startBinding) ch.startBinding = { ...l.startBinding, focus: -l.startBinding.focus };
        if (l.endBinding) ch.endBinding = { ...l.endBinding, focus: -l.endBinding.focus };
      }
    } else {
      const ecx = el.x + el.width / 2;
      const ecy = el.y + el.height / 2;
      if (h) ch.x = 2 * cx - ecx - el.width / 2;
      else ch.y = 2 * cy - ecy - el.height / 2;
      if (el.type === 'image') ch.scale = h ? [-el.scale[0], el.scale[1]] : [el.scale[0], -el.scale[1]];
    }
    out[el.id] = ch;
  }
  return out;
}

const normAngle = (a: number) => {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
};

const unitBounds = (unit: readonly SketchElement[]) => getCommonBounds(unit as SketchElement[])!;

const translate = (unit: readonly SketchElement[], dx: number, dy: number, out: Changes) => {
  if (!dx && !dy) return;
  for (const el of unit) if (!el.locked) out[el.id] = { x: el.x + dx, y: el.y + dy };
};

/** align units (groups move as one) to the common bounds edge/center */
export function alignUnits(units: readonly (readonly SketchElement[])[], edge: AlignEdge): Changes {
  const out: Changes = {};
  if (units.length < 2) return out;
  const all = getCommonBounds(units.flat() as SketchElement[]);
  if (!all) return out;
  for (const u of units) {
    const b = unitBounds(u);
    let dx = 0, dy = 0;
    switch (edge) {
      case 'left': dx = all.minX - b.minX; break;
      case 'right': dx = all.maxX - b.maxX; break;
      case 'centerX': dx = (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2; break;
      case 'top': dy = all.minY - b.minY; break;
      case 'bottom': dy = all.maxY - b.maxY; break;
      case 'centerY': dy = (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2; break;
    }
    translate(u, dx, dy, out);
  }
  return out;
}

/** distribute units with equal gaps between them (first and last stay put) */
export function distributeUnits(units: readonly (readonly SketchElement[])[], axis: 'horizontal' | 'vertical'): Changes {
  const out: Changes = {};
  if (units.length < 3) return out;
  const h = axis === 'horizontal';
  const items = units.map((u) => ({ u, b: unitBounds(u) }));
  const lo = (b: Bounds) => (h ? b.minX : b.minY);
  const hi = (b: Bounds) => (h ? b.maxX : b.maxY);
  const center = (b: Bounds) => (lo(b) + hi(b)) / 2;
  items.sort((a, b) => center(a.b) - center(b.b));
  const start = Math.min(...items.map((i) => lo(i.b)));
  const end = Math.max(...items.map((i) => hi(i.b)));
  const total = items.reduce((s, i) => s + hi(i.b) - lo(i.b), 0);
  const gap = (end - start - total) / (items.length - 1);
  let pos = start;
  for (const { u, b } of items) {
    const d = pos - lo(b);
    translate(u, h ? d : 0, h ? 0 : d, out);
    pos += hi(b) - lo(b) + gap;
  }
  return out;
}

/**
 * Move elements by (dx, dy). Arrows not in the set whose both ends are bound to
 * moved elements move along; arrows with one bound end get that endpoint moved.
 */
export function moveElements(
  all: readonly SketchElement[],
  movingIds: ReadonlySet<string>,
  dx: number,
  dy: number,
): Changes {
  const out: Changes = {};
  for (const el of all) {
    if (el.isDeleted) continue;
    if (movingIds.has(el.id)) {
      if (!el.locked) out[el.id] = { x: el.x + dx, y: el.y + dy };
      continue;
    }
    if (el.type !== 'arrow' && el.type !== 'line') continue;
    const s = !!el.startBinding && movingIds.has(el.startBinding.elementId);
    const e = !!el.endBinding && movingIds.has(el.endBinding.elementId);
    if (s && e) out[el.id] = { x: el.x + dx, y: el.y + dy };
    else if (s || e) {
      const last = el.points.length - 1;
      let x = el.x, y = el.y;
      let points = el.points.map((p) => [...p] as Point);
      if (s) {
        x += dx; y += dy;
        points = points.map((p, i) => (i === 0 ? p : ([p[0] - dx, p[1] - dy] as Point)));
      }
      if (e && last > 0) points[last] = [points[last][0] + dx, points[last][1] + dy];
      out[el.id] = { x, y, points, ...pointsExtent(points) };
    }
  }
  return out;
}

export { getElementBounds };
