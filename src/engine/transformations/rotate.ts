// Rotation math.
import type { ElementChanges } from '@/store/canvasStore';
import type { SketchElement } from '@/types/appState';
import { getElementCenter, normalizeAngle, rotatePoint, snapAngle } from '@/engine/math';

export const SNAP_STEP = Math.PI / 12; // 15°

/** angle of the rotation handle for a pointer at (px,py) around center (0 = handle straight up) */
export const pointerAngle = (cx: number, cy: number, px: number, py: number) => Math.atan2(py - cy, px - cx) + Math.PI / 2;

/** single element: new absolute angle */
export function rotateSingleElement(orig: SketchElement, px: number, py: number, snap: boolean): ElementChanges {
  const c = getElementCenter(orig);
  let a = pointerAngle(c.x, c.y, px, py);
  if (snap) a = snapAngle(a, SNAP_STEP);
  return { angle: normalizeAngle(a) };
}

/** rotate elements by `delta` around (cx, cy) */
export function rotateElements(origs: SketchElement[], cx: number, cy: number, delta: number): Record<string, ElementChanges> {
  const out: Record<string, ElementChanges> = {};
  for (const el of origs) {
    const c = getElementCenter(el);
    const [nx, ny] = rotatePoint(c.x, c.y, cx, cy, delta);
    out[el.id] = { x: el.x + (nx - c.x), y: el.y + (ny - c.y), angle: normalizeAngle(el.angle + delta) };
  }
  return out;
}

/** multi-selection rotation delta from drag start to pointer (optionally snapped) */
export const rotationDelta = (cx: number, cy: number, sx: number, sy: number, px: number, py: number, snap: boolean) => {
  const d = Math.atan2(py - cy, px - cx) - Math.atan2(sy - cy, sx - cx);
  return snap ? snapAngle(d, SNAP_STEP) : d;
};
