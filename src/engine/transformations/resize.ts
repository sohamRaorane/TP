// Resize math. Pure functions: original element(s) + pointer -> changes.
import type { ElementChanges } from '@/store/canvasStore';
import type { SketchElement } from '@/types/appState';
import { getElementCenter, hasPoints, localBox, rotatePoint, type P2 } from '@/engine/math';
import type { Bounds } from './bounds';
import type { ResizeHandle } from './handles';

export interface ResizeOptions {
  /** keep aspect ratio (Shift; images default) */
  keepAspect: boolean;
  /** resize symmetrically around the center (Alt) */
  fromCenter: boolean;
}

const MIN = 1;
const sign = (v: number) => (v < 0 ? -1 : 1);

/**
 * Compute the new box edges (relative to the original center, unrotated frame)
 * when dragging `handle` to local pointer (ux, uy). Returns scale factors too.
 */
export const resizeBox = (
  w: number,
  h: number,
  handle: ResizeHandle,
  ux: number,
  uy: number,
  opts: ResizeOptions,
) => {
  const hasE = handle.includes('e'), hasW = handle.includes('w'), hasN = handle.includes('n'), hasS = handle.includes('s');
  const corner = (hasE || hasW) && (hasN || hasS);
  const canX = w > 1e-6, canY = h > 1e-6;
  let L = -w / 2, R = w / 2, T = -h / 2, B = h / 2;
  if (hasE) R = ux;
  if (hasW) L = ux;
  if (hasN) T = uy;
  if (hasS) B = uy;
  if (opts.fromCenter) {
    if (hasE) L = -R;
    if (hasW) R = -L;
    if (hasN) B = -T;
    if (hasS) T = -B;
  }
  let sx = canX ? (R - L) / w : 1;
  let sy = canY ? (B - T) / h : 1;
  if (!(hasE || hasW)) sx = 1;
  if (!(hasN || hasS)) sy = 1;
  if (opts.keepAspect && canX && canY) {
    if (corner) {
      const s = Math.max(Math.abs(sx), Math.abs(sy));
      sx = sign(sx) * s;
      sy = sign(sy) * s;
    } else if (hasE || hasW) sy = Math.abs(sx);
    else sx = Math.abs(sy);
  }
  // minimum size
  if (canX && Math.abs(w * sx) < MIN) sx = (sign(sx) * MIN) / w;
  if (canY && Math.abs(h * sy) < MIN) sy = (sign(sy) * MIN) / h;
  // rebuild edges from the fixed anchor
  const nw = w * sx, nh = h * sy;
  if (opts.fromCenter || !(hasE || hasW)) { L = -nw / 2; R = nw / 2; }
  else if (hasE) { L = -w / 2; R = L + nw; }
  else { R = w / 2; L = R - nw; }
  if (opts.fromCenter || !(hasN || hasS)) { T = -nh / 2; B = nh / 2; }
  else if (hasS) { T = -h / 2; B = T + nh; }
  else { B = h / 2; T = B - nh; }
  return { L, R, T, B, sx, sy };
};

/** resize a single (possibly rotated) element by dragging `handle` to scene point (px, py) */
export function resizeSingleElement(orig: SketchElement, handle: ResizeHandle, px: number, py: number, opts: ResizeOptions): ElementChanges {
  const { ox, oy, w, h } = localBox(orig);
  const c0 = getElementCenter(orig);
  const [rx, ry] = rotatePoint(px, py, c0.x, c0.y, -orig.angle);
  const keepAspect = orig.type === 'text' ? true : orig.type === 'image' ? !opts.keepAspect : opts.keepAspect;
  const { L, R, T, B, sx, sy } = resizeBox(w, h, handle, rx - c0.x, ry - c0.y, { ...opts, keepAspect });
  const nc = { x: (L + R) / 2, y: (T + B) / 2 };
  const [cx, cy] = rotatePoint(c0.x + nc.x, c0.y + nc.y, c0.x, c0.y, orig.angle);
  const width = Math.abs(R - L);
  const height = Math.abs(B - T);

  if (hasPoints(orig)) {
    const u: P2[] = orig.points.map(([x, y]) => [L + (x - ox) * sx, T + (y - oy) * sy]);
    // if w (or h) is 0, keep the original offset on that axis
    if (w <= 1e-6) u.forEach((p, i) => (p[0] = orig.points[i][0] - ox - w / 2));
    if (h <= 1e-6) u.forEach((p, i) => (p[1] = orig.points[i][1] - oy - h / 2));
    const p0 = u[0];
    return {
      x: cx + (p0[0] - nc.x),
      y: cy + (p0[1] - nc.y),
      width,
      height,
      points: u.map(([x, y]) => [x - p0[0], y - p0[1]] as P2),
    };
  }
  const changes: ElementChanges = { x: cx - width / 2, y: cy - height / 2, width, height };
  if (orig.type === 'text') changes.fontSize = Math.max(1, orig.fontSize * Math.abs(sy));
  if (orig.type === 'image') {
    const [fx, fy] = orig.scale ?? [1, 1];
    changes.scale = [sx < 0 ? -fx : fx, sy < 0 ? -fy : fy];
  }
  return changes;
}

/** proportional resize of several elements inside their common bounds */
export function resizeMultipleElements(
  origs: SketchElement[],
  bounds: Bounds,
  handle: ResizeHandle,
  px: number,
  py: number,
  opts: ResizeOptions,
): Record<string, ElementChanges> {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const c0 = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const corner = handle.length === 2;
  const keepAspect = corner ? true : opts.keepAspect;
  let { L, T, sx, sy } = resizeBox(w, h, handle, px - c0.x, py - c0.y, { ...opts, keepAspect });
  // no flipping for groups; clamp to a small positive scale
  const minS = 0.02;
  if (sx < minS || sy < minS) {
    sx = Math.max(sx, minS);
    sy = Math.max(sy, minS);
    const r = rebuild(w, h, handle, sx, sy, opts.fromCenter);
    L = r.L;
    T = r.T;
  }
  const newMinX = c0.x + L;
  const newMinY = c0.y + T;
  const out: Record<string, ElementChanges> = {};
  const uniform = Math.abs(sx - sy) < 1e-9;
  for (const el of origs) {
    const c = getElementCenter(el);
    const ncx = newMinX + (c.x - bounds.minX) * sx;
    const ncy = newMinY + (c.y - bounds.minY) * sy;
    const box = localBox(el);
    // scale in the element's own frame (exact for uniform scale)
    let esx = sx, esy = sy;
    if (!uniform && el.angle) {
      const cos = Math.abs(Math.cos(el.angle)), sin = Math.abs(Math.sin(el.angle));
      esx = sx * cos + sy * sin;
      esy = sx * sin + sy * cos;
    }
    if (hasPoints(el)) {
      const points = el.points.map(([x, y]) => [x * esx, y * esy] as P2);
      out[el.id] = {
        x: ncx - (box.ox * esx + (box.w * esx) / 2),
        y: ncy - (box.oy * esy + (box.h * esy) / 2),
        width: box.w * esx,
        height: box.h * esy,
        points,
      };
      continue;
    }
    const nw = el.width * esx, nh = el.height * esy;
    const ch: ElementChanges = { x: ncx - nw / 2, y: ncy - nh / 2, width: nw, height: nh };
    if (el.type === 'text') ch.fontSize = Math.max(1, el.fontSize * Math.min(esx, esy));
    out[el.id] = ch;
  }
  return out;
}

const rebuild = (w: number, h: number, handle: ResizeHandle, sx: number, sy: number, fromCenter: boolean) => {
  const nw = w * sx, nh = h * sy;
  let L: number, T: number;
  if (fromCenter || !(handle.includes('e') || handle.includes('w'))) L = -nw / 2;
  else if (handle.includes('e')) L = -w / 2;
  else L = w / 2 - nw;
  if (fromCenter || !(handle.includes('n') || handle.includes('s'))) T = -nh / 2;
  else if (handle.includes('s')) T = -h / 2;
  else T = h / 2 - nh;
  return { L, T };
};
