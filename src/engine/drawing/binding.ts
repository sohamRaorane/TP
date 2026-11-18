// Arrow <-> shape binding. Arrow endpoints bound to a target stay attached
// when the target moves/resizes/rotates.
import { useCanvasStore, type ElementChanges } from '@/store/canvasStore';
import type { LinearElement, PointBinding, SketchElement } from '@/types/appState';
import { isBindable, isLinear } from '@shared/element';
import {
  clamp,
  distToPolyline,
  getElementCenter,
  localBox,
  localToScene,
  pointInPolygon,
  pointsBounds,
  segmentIntersection,
  type P2,
} from '@/engine/math';
import { outlinePolygon } from '@/engine/hitTesting';
import { getPointsInScene } from '@/engine/transformations/handles';
import { BINDING_DISTANCE_PX, BINDING_GAP } from '@/engine/constants';

/** can arrows bind to this element? (frames & bound labels excluded) */
export const canBindTo = (el: SketchElement) =>
  !el.isDeleted && isBindable(el) && el.type !== 'frame' && !(el.type === 'text' && el.containerId);

/** target outline polygon in scene coords */
export const scenePolygon = (el: SketchElement): P2[] => outlinePolygon(el).map(([x, y]) => localToScene(el, x, y));

/** topmost bindable element whose outline is near (or contains) the scene point */
export function getBindableElementAt(x: number, y: number, elements: SketchElement[], zoom: number, exclude: Set<string> = new Set()): SketchElement | null {
  const maxD = BINDING_DISTANCE_PX / zoom;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (exclude.has(el.id) || !canBindTo(el)) continue;
    const poly = scenePolygon(el);
    if (pointInPolygon(x, y, poly) || distToPolyline(x, y, poly, true) <= maxD) return el;
  }
  return null;
}

const targetRadius = (el: SketchElement) => {
  const b = localBox(el);
  return Math.max(b.w, b.h, 1) / 2;
};

const basis = (target: SketchElement, adjacent: P2) => {
  const c = getElementCenter(target);
  let dx = c.x - adjacent[0], dy = c.y - adjacent[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
  return { c, dir: [dx, dy] as P2, perp: [-dy, dx] as P2 };
};

/** binding descriptor for an endpoint placed at `end` with neighbouring point `adjacent` */
export function computeBinding(target: SketchElement, end: P2, adjacent: P2): PointBinding {
  const { c, perp } = basis(target, adjacent);
  const focus = clamp(((end[0] - c.x) * perp[0] + (end[1] - c.y) * perp[1]) / targetRadius(target), -1, 1);
  return { elementId: target.id, focus, gap: BINDING_GAP };
}

/** where an endpoint bound with `binding` to `target` should be, given its neighbouring point */
export function bindingPoint(binding: PointBinding, target: SketchElement, adjacent: P2): P2 {
  const { c, perp } = basis(target, adjacent);
  const r = targetRadius(target);
  const aim: P2 = [c.x + perp[0] * binding.focus * r, c.y + perp[1] * binding.focus * r];
  const poly = scenePolygon(target);
  let vx = aim[0] - adjacent[0], vy = aim[1] - adjacent[1];
  const vlen = Math.hypot(vx, vy);
  if (vlen < 1e-6) return aim;
  vx /= vlen; vy /= vlen;
  // ray from adjacent through aim, far beyond
  const far: P2 = [adjacent[0] + vx * (vlen + r * 4), adjacent[1] + vy * (vlen + r * 4)];
  let bestT = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const t = segmentIntersection(adjacent[0], adjacent[1], far[0], far[1], a[0], a[1], b[0], b[1]);
    if (t !== null && t >= 0 && t < bestT) bestT = t;
  }
  if (!Number.isFinite(bestT)) return aim;
  const total = vlen + r * 4;
  const hitD = bestT * total;
  const d = Math.max(0, hitD - binding.gap);
  return [adjacent[0] + vx * d, adjacent[1] + vy * d];
}

/** rebuild a linear element from scene points (angle reset to 0) */
export const linearFromScenePoints = (pts: P2[]): ElementChanges => {
  const [x0, y0] = pts[0];
  const points = pts.map(([x, y]) => [x - x0, y - y0] as P2);
  const b = pointsBounds(points);
  return { x: x0, y: y0, points, width: b.maxX - b.minX, height: b.maxY - b.minY, angle: 0 };
};

/** compute updated endpoints for arrows bound to any of `changedIds` */
export function computeBoundArrowUpdates(changedIds: Iterable<string>, byId: Record<string, SketchElement>): Record<string, ElementChanges> {
  const arrows = new Set<string>();
  for (const id of changedIds) {
    const el = byId[id];
    if (!el) continue;
    for (const b of el.boundElements) if (b.type === 'arrow') arrows.add(b.id);
  }
  const out: Record<string, ElementChanges> = {};
  for (const id of arrows) {
    const a = byId[id];
    if (!a || a.isDeleted || !isLinear(a)) continue;
    const ch = recomputeArrow(a, byId);
    if (ch) out[id] = ch;
  }
  return out;
}

export function recomputeArrow(a: LinearElement, byId: Record<string, SketchElement>): ElementChanges | null {
  const pts = getPointsInScene(a);
  if (pts.length < 2) return null;
  const n = pts.length;
  const st = a.startBinding ? byId[a.startBinding.elementId] : undefined;
  const et = a.endBinding ? byId[a.endBinding.elementId] : undefined;
  const sTarget = st && !st.isDeleted ? st : undefined;
  const eTarget = et && !et.isDeleted ? et : undefined;
  if (!sTarget && !eTarget) return null;
  if (sTarget && a.startBinding) {
    const adj: P2 = n === 2 && eTarget ? [getElementCenter(eTarget).x, getElementCenter(eTarget).y] : pts[1];
    pts[0] = bindingPoint(a.startBinding, sTarget, adj);
  }
  if (eTarget && a.endBinding) {
    pts[n - 1] = bindingPoint(a.endBinding, eTarget, pts[n - 2]);
  }
  return linearFromScenePoints(pts);
}

/** apply bound-arrow updates for changed elements to the store (no commit) */
export function updateBoundArrows(changedIds: Iterable<string>) {
  const s = useCanvasStore.getState();
  const changes = computeBoundArrowUpdates(changedIds, s.elementsById);
  if (Object.keys(changes).length) s.updateElements(changes);
}

/**
 * Changes that bind (or unbind, when target is null) one end of an arrow.
 * Includes the arrow, the previous target and the new target (boundElements).
 */
export function bindingChanges(
  arrow: LinearElement,
  end: 'start' | 'end',
  target: SketchElement | null,
  byId: Record<string, SketchElement>,
): Record<string, ElementChanges> {
  const out: Record<string, ElementChanges> = {};
  const key = end === 'start' ? 'startBinding' : 'endBinding';
  const otherKey = end === 'start' ? 'endBinding' : 'startBinding';
  const prev = arrow[key];
  if (target) {
    const pts = getPointsInScene(arrow);
    const endPt = end === 'start' ? pts[0] : pts[pts.length - 1];
    const adj = end === 'start' ? pts[1] ?? pts[0] : pts[pts.length - 2] ?? pts[0];
    out[arrow.id] = { [key]: computeBinding(target, endPt, adj) };
  } else if (prev) out[arrow.id] = { [key]: null };
  // previous target loses the ref unless the other end still binds to it
  if (prev && prev.elementId !== target?.id && arrow[otherKey]?.elementId !== prev.elementId) {
    const pt = byId[prev.elementId];
    if (pt) out[pt.id] = { boundElements: pt.boundElements.filter((b) => b.id !== arrow.id) };
  }
  if (target && !target.boundElements.some((b) => b.id === arrow.id)) {
    const base = (out[target.id]?.boundElements as SketchElement['boundElements'] | undefined) ?? target.boundElements;
    out[target.id] = { boundElements: [...base, { id: arrow.id, type: 'arrow' }] };
  }
  return out;
}

/** bind/unbind an arrow end in the store and snap the endpoint onto the target */
export function applyBinding(arrowId: string, end: 'start' | 'end', target: SketchElement | null) {
  const s = useCanvasStore.getState();
  const arrow = s.elementsById[arrowId];
  if (!arrow || !isLinear(arrow)) return;
  const changes = bindingChanges(arrow, end, target, s.elementsById);
  if (Object.keys(changes).length) s.updateElements(changes);
  if (target) {
    const s2 = useCanvasStore.getState();
    const a2 = s2.elementsById[arrowId];
    if (a2 && isLinear(a2)) {
      const ch = recomputeArrow(a2, s2.elementsById);
      if (ch) s2.updateElements({ [arrowId]: ch });
    }
  }
}
