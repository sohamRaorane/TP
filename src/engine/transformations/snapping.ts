// Object & grid snapping for move/resize/create.
import type { SketchElement, SnapLine } from '@/types/appState';
import { getElementBounds, type Bounds } from './bounds';

export const GRID = 20;

export interface SnapTarget { v: number; min: number; max: number }
export interface SnapTargets { xs: SnapTarget[]; ys: SnapTarget[] }

export const snapToGrid = (v: number, grid = GRID) => Math.round(v / grid) * grid;

/** collect snap anchors (edges + centers) of reference elements */
export function getSnapTargets(elements: SketchElement[], exclude: Set<string>, view?: Bounds): SnapTargets {
  const xs: SnapTarget[] = [];
  const ys: SnapTarget[] = [];
  for (const el of elements) {
    if (el.isDeleted || exclude.has(el.id)) continue;
    if (el.type === 'text' && el.containerId) continue;
    const b = getElementBounds(el);
    if (view && (b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY)) continue;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    for (const v of [b.minX, cx, b.maxX]) xs.push({ v, min: b.minY, max: b.maxY });
    for (const v of [b.minY, cy, b.maxY]) ys.push({ v, min: b.minX, max: b.maxX });
  }
  return { xs, ys };
}

const best = (cands: number[], targets: SnapTarget[], threshold: number) => {
  let d = Infinity;
  for (const c of cands)
    for (const t of targets) {
      const delta = t.v - c;
      if (Math.abs(delta) <= threshold && Math.abs(delta) < Math.abs(d)) d = delta;
    }
  return Number.isFinite(d) ? d : 0;
};

const linesFor = (axis: 'x' | 'y', cands: number[], targets: SnapTarget[], span: [number, number]): SnapLine[] => {
  const out: SnapLine[] = [];
  const seen = new Set<string>();
  for (const c of cands)
    for (const t of targets) {
      if (Math.abs(t.v - c) > 0.01) continue;
      const key = t.v.toFixed(2);
      const lo = Math.min(span[0], t.min), hi = Math.max(span[1], t.max);
      if (seen.has(key)) {
        // extend existing
        const l = out.find((o) => (axis === 'x' ? o.x1 : o.y1).toFixed(2) === key)!;
        if (axis === 'x') { l.y1 = Math.min(l.y1, lo); l.y2 = Math.max(l.y2, hi); }
        else { l.x1 = Math.min(l.x1, lo); l.x2 = Math.max(l.x2, hi); }
        continue;
      }
      seen.add(key);
      out.push(axis === 'x' ? { x1: t.v, y1: lo, x2: t.v, y2: hi } : { x1: lo, y1: t.v, x2: hi, y2: t.v });
    }
  return out;
};

/** snap a moving bounding box. Returns the extra offset to apply and guide lines. */
export function snapBounds(b: Bounds, targets: SnapTargets, threshold: number) {
  const cxs = [b.minX, (b.minX + b.maxX) / 2, b.maxX];
  const cys = [b.minY, (b.minY + b.maxY) / 2, b.maxY];
  const dx = best(cxs, targets.xs, threshold);
  const dy = best(cys, targets.ys, threshold);
  const nb = { minX: b.minX + dx, maxX: b.maxX + dx, minY: b.minY + dy, maxY: b.maxY + dy };
  const lines = [
    ...(dx || targets.xs.some((t) => cxs.some((c) => Math.abs(t.v - c) < 0.01))
      ? linesFor('x', [nb.minX, (nb.minX + nb.maxX) / 2, nb.maxX], targets.xs, [nb.minY, nb.maxY])
      : []),
    ...(dy || targets.ys.some((t) => cys.some((c) => Math.abs(t.v - c) < 0.01))
      ? linesFor('y', [nb.minY, (nb.minY + nb.maxY) / 2, nb.maxY], targets.ys, [nb.minX, nb.maxX])
      : []),
  ];
  return { dx, dy, lines };
}

/** snap a single point (resize handle / creation corner) */
export function snapPoint(x: number, y: number, targets: SnapTargets, threshold: number) {
  const dx = best([x], targets.xs, threshold);
  const dy = best([y], targets.ys, threshold);
  const nx = x + dx, ny = y + dy;
  const lines = [
    ...linesFor('x', [nx], targets.xs, [ny, ny]),
    ...linesFor('y', [ny], targets.ys, [nx, nx]),
  ];
  return { x: nx, y: ny, lines };
}
