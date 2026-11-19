// Hit testing public API. CONTRACT — Agent A implements.
import type { SketchElement } from '@/types/appState';
import {
  diamondPolygon,
  distToPolyline,
  ellipsePolygon,
  hasPoints,
  pointInPolygon,
  rectPolygon,
  rectRadius,
  sampleCurve,
  sceneToLocal,
  type P2,
} from '@/engine/math';
import { boundsContain, getElementBounds } from '@/engine/transformations/bounds';
import { FRAME_LABEL_FONT } from '@/engine/constants';

export interface HitOptions {
  /** treat interior as hittable even when transparent (selected elements) */
  selected?: boolean;
  /** current zoom, for screen-constant regions (frame label) */
  zoom?: number;
}

const roundedRectPolygon = (w: number, h: number): P2[] => {
  const r = rectRadius(w, h);
  if (r < 1) return rectPolygon(w, h);
  const pts: P2[] = [];
  const corner = (cx: number, cy: number, start: number) => {
    for (let i = 0; i <= 4; i++) {
      const a = start + (i / 4) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  corner(w - r, r, -Math.PI / 2);
  corner(w - r, h - r, 0);
  corner(r, h - r, Math.PI / 2);
  corner(r, r, Math.PI);
  return pts;
};

/** element outline as a local polygon (closed shapes only) */
export const outlinePolygon = (el: SketchElement): P2[] => {
  const w = el.width, h = el.height;
  if (el.type === 'ellipse') return ellipsePolygon(w, h, 48);
  if (el.type === 'diamond') return diamondPolygon(w, h);
  if (el.type === 'rectangle' && el.roundness) return roundedRectPolygon(w, h);
  return rectPolygon(w, h);
};

/** local path of a linear element (curves sampled) */
export const linearPath = (el: SketchElement): P2[] => {
  if (!hasPoints(el)) return [];
  const pts = el.points as P2[];
  return el.type !== 'freedraw' && el.roundness && pts.length > 2 ? sampleCurve(pts, 10) : pts;
};

const frameLabelHit = (el: SketchElement, lx: number, ly: number, zoom: number) => {
  if (el.type !== 'frame') return false;
  const fs = FRAME_LABEL_FONT / zoom;
  const width = Math.min(Math.max(el.width, 40 / zoom), (el.name || 'Frame').length * fs * 0.6 + 8 / zoom);
  return lx >= 0 && lx <= width && ly <= 0 && ly >= -(fs + 8 / zoom);
};

/** does the scene point hit the element? `tol` in scene units */
export function hitTestElement(el: SketchElement, x: number, y: number, tol: number, opts: HitOptions = {}): boolean {
  if (el.isDeleted) return false;
  const [lx, ly] = sceneToLocal(el, x, y);
  const t = tol + el.strokeWidth / 2;
  switch (el.type) {
    case 'rectangle':
    case 'diamond':
    case 'ellipse': {
      const poly = outlinePolygon(el);
      if (distToPolyline(lx, ly, poly, true) <= t) return true;
      const filled = el.backgroundColor !== 'transparent' || opts.selected;
      return !!filled && pointInPolygon(lx, ly, poly);
    }
    case 'line':
    case 'arrow': {
      const path = linearPath(el);
      if (!path.length) return false;
      if (distToPolyline(lx, ly, path) <= t) return true;
      const pts = el.points;
      const closed = pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1;
      return closed && (el.backgroundColor !== 'transparent' || !!opts.selected) && pointInPolygon(lx, ly, path);
    }
    case 'freedraw': {
      if (!el.points.length) return false;
      return distToPolyline(lx, ly, el.points as P2[]) <= tol + el.strokeWidth * 2.2;
    }
    case 'text':
    case 'image':
      return lx >= -tol && lx <= el.width + tol && ly >= -tol && ly <= el.height + tol;
    case 'frame': {
      const zoom = opts.zoom ?? 10 / Math.max(tol, 1e-6);
      if (frameLabelHit(el, lx, ly, zoom)) return true;
      if (distToPolyline(lx, ly, rectPolygon(el.width, el.height), true) <= t) return true;
      return !!opts.selected && lx >= 0 && ly >= 0 && lx <= el.width && ly <= el.height;
    }
  }
  return false;
}

export interface HitTestSceneOptions extends HitOptions {
  selectedIds?: Record<string, true>;
  /** skip locked elements */
  skipLocked?: boolean;
  /** map a bound text label to its container (default true) */
  mapLabelsToContainer?: boolean;
}

/** topmost element under point; selected elements are hit on their interior */
export function hitTestScene(x: number, y: number, elements: SketchElement[], tol: number, opts: HitTestSceneOptions = {}): SketchElement | null {
  const byId = new Map<string, SketchElement>();
  for (const e of elements) byId.set(e.id, e);
  // selected elements get priority on their whole area (so you can drag them)
  if (opts.selectedIds) {
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (el.isDeleted || !opts.selectedIds[el.id] || (opts.skipLocked && el.locked)) continue;
      if (el.type === 'frame') continue;
      if (hitTestElement(el, x, y, tol, { ...opts, selected: true })) return el;
    }
  }
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || (opts.skipLocked && el.locked)) continue;
    if (el.type === 'frame') continue; // frames are checked last (they sit behind)
    if (hitTestElement(el, x, y, tol, opts)) {
      if (el.type === 'text' && el.containerId && opts.mapLabelsToContainer !== false) {
        const c = byId.get(el.containerId);
        if (c && !c.isDeleted) return c;
      }
      return el;
    }
  }
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.type !== 'frame' || el.isDeleted || (opts.skipLocked && el.locked)) continue;
    if (hitTestElement(el, x, y, tol, { ...opts, selected: !!opts.selectedIds?.[el.id] })) return el;
  }
  return null;
}

/** topmost non-deleted element under scene point; tolerance in scene units (use ~10/zoom) */
export function getElementAtPoint(x: number, y: number, elements: SketchElement[], tolerance: number): SketchElement | null {
  return hitTestScene(x, y, elements, tolerance);
}

/** elements fully inside the scene rect */
export function getElementsInRect(rect: { x: number; y: number; width: number; height: number }, elements: SketchElement[]): SketchElement[] {
  const r = {
    minX: Math.min(rect.x, rect.x + rect.width),
    minY: Math.min(rect.y, rect.y + rect.height),
    maxX: Math.max(rect.x, rect.x + rect.width),
    maxY: Math.max(rect.y, rect.y + rect.height),
  };
  return elements.filter((el) => !el.isDeleted && !(el.type === 'text' && el.containerId) && boundsContain(r, getElementBounds(el)));
}
