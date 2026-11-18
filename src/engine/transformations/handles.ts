// Transform handles (resize/rotate) and linear point handles, in scene coords.
import type { SketchElement } from '@/types/appState';
import { getElementCenter, hasPoints, localBox, localToScene, rotatePoint, type P2 } from '@/engine/math';
import type { Bounds } from './bounds';

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export type HandleType = ResizeHandle | 'rotation';

export interface Handle {
  /** center in scene coords */
  x: number;
  y: number;
  /** side length in scene units */
  size: number;
}

export type TransformHandles = Partial<Record<HandleType, Handle>>;

export const HANDLE_SIZE_PX = 8;
export const SELECTION_PADDING_PX = 4;
export const ROTATION_OFFSET_PX = 18;
export const POINT_HANDLE_RADIUS_PX = 5;

export interface SelectionFrame {
  /** box (unrotated) in scene coords around `center` */
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  center: { x: number; y: number };
}

/** padded selection frame of a single element (rotated box) */
export const elementSelectionFrame = (el: SketchElement, zoom: number): SelectionFrame => {
  const pad = SELECTION_PADDING_PX / zoom + (el.type === 'text' || el.type === 'image' ? 0 : el.strokeWidth / 2);
  const b = localBox(el);
  return {
    x: el.x + b.ox - pad,
    y: el.y + b.oy - pad,
    width: b.w + pad * 2,
    height: b.h + pad * 2,
    angle: el.angle,
    center: getElementCenter(el),
  };
};

export const boundsSelectionFrame = (b: Bounds, zoom: number, angle = 0): SelectionFrame => {
  const pad = SELECTION_PADDING_PX / zoom;
  return {
    x: b.minX - pad,
    y: b.minY - pad,
    width: b.maxX - b.minX + pad * 2,
    height: b.maxY - b.minY + pad * 2,
    angle,
    center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
  };
};

export const frameCorners = (f: SelectionFrame): P2[] =>
  [
    [f.x, f.y],
    [f.x + f.width, f.y],
    [f.x + f.width, f.y + f.height],
    [f.x, f.y + f.height],
  ].map(([x, y]) => rotatePoint(x, y, f.center.x, f.center.y, f.angle));

export interface HandleOptions {
  /** hide n/s/e/w */
  cornersOnly?: boolean;
  noRotation?: boolean;
}

/** handles for a single element or for a precomputed selection frame */
export function getTransformHandles(target: SketchElement | SelectionFrame, zoom: number, opts: HandleOptions = {}): TransformHandles {
  const f: SelectionFrame = 'type' in target ? elementSelectionFrame(target, zoom) : target;
  const size = HANDLE_SIZE_PX / zoom;
  const { x, y, width: w, height: h } = f;
  const pos: Record<HandleType, P2> = {
    nw: [x, y],
    n: [x + w / 2, y],
    ne: [x + w, y],
    e: [x + w, y + h / 2],
    se: [x + w, y + h],
    s: [x + w / 2, y + h],
    sw: [x, y + h],
    w: [x, y + h / 2],
    rotation: [x + w / 2, y - ROTATION_OFFSET_PX / zoom],
  };
  // side handles are hidden when the box is too small on screen
  const screenW = w * zoom, screenH = h * zoom;
  const out: TransformHandles = {};
  (Object.keys(pos) as HandleType[]).forEach((k) => {
    if (k === 'rotation' && opts.noRotation) return;
    if ((k === 'n' || k === 's') && (opts.cornersOnly || screenW < HANDLE_SIZE_PX * 4)) return;
    if ((k === 'e' || k === 'w') && (opts.cornersOnly || screenH < HANDLE_SIZE_PX * 4)) return;
    const [px, py] = rotatePoint(pos[k][0], pos[k][1], f.center.x, f.center.y, f.angle);
    out[k] = { x: px, y: py, size };
  });
  return out;
}

/** which handle (if any) is under the scene point */
export function hitTestHandle(handles: TransformHandles, x: number, y: number, zoom: number): HandleType | null {
  const slop = 4 / zoom;
  // rotation first (sits outside), then corners, then sides
  const order: HandleType[] = ['rotation', 'nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'];
  for (const k of order) {
    const h = handles[k];
    if (!h) continue;
    const r = h.size / 2 + slop;
    if (k === 'rotation' ? Math.hypot(x - h.x, y - h.y) <= r : Math.abs(x - h.x) <= r && Math.abs(y - h.y) <= r) return k;
  }
  return null;
}

/** scene positions of a linear/freedraw element's points */
export const getPointsInScene = (el: SketchElement): P2[] =>
  hasPoints(el) ? el.points.map(([px, py]) => localToScene(el, px, py)) : [];

/** midpoints between consecutive points (scene) used to insert a point */
export const getMidpointsInScene = (el: SketchElement): P2[] => {
  const pts = getPointsInScene(el);
  const out: P2[] = [];
  for (let i = 0; i < pts.length - 1; i++) out.push([(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]);
  return out;
};

/** index of the linear point handle under (x,y), or -1 */
export function hitTestPointHandle(el: SketchElement, x: number, y: number, zoom: number): number {
  const pts = getPointsInScene(el);
  const r = (POINT_HANDLE_RADIUS_PX + 4) / zoom;
  // prefer the last-drawn handle (endpoints on top)
  for (let i = pts.length - 1; i >= 0; i--) if (Math.hypot(pts[i][0] - x, pts[i][1] - y) <= r) return i;
  return -1;
}

export function hitTestMidpointHandle(el: SketchElement, x: number, y: number, zoom: number): number {
  const mids = getMidpointsInScene(el);
  const r = (POINT_HANDLE_RADIUS_PX + 2) / zoom;
  for (let i = 0; i < mids.length; i++) if (Math.hypot(mids[i][0] - x, mids[i][1] - y) <= r) return i;
  return -1;
}

export const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};

/** cursor for a resize handle taking element rotation into account */
export const cursorForHandle = (h: HandleType, angle: number) => {
  if (h === 'rotation') return 'grab';
  const order: ResizeHandle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const idx = order.indexOf(h);
  const steps = Math.round(((angle % (Math.PI * 2)) + Math.PI * 2) / (Math.PI / 4)) % 8;
  return HANDLE_CURSORS[order[(idx + steps) % 8]];
};
