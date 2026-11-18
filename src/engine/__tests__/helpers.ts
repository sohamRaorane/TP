// Test helpers: element factories with deterministic geometry.
import { defaultAppState } from '@/store/canvasStore';
import { newFrame, newFreedraw, newImage, newLinear, newShape, newText } from '@/engine/drawing/newElement';
import type { LinearElement, SketchElement } from '@/types/appState';
import { pointsBounds, type P2 } from '@/engine/math';

export const style = () => ({ ...defaultAppState().currentItem });

export const rect = (x: number, y: number, w: number, h: number, extra: Partial<SketchElement> = {}) =>
  ({ ...newShape('rectangle', { x, y, width: w, height: h, style: style() }), ...extra }) as SketchElement;
export const ellipse = (x: number, y: number, w: number, h: number, extra: Partial<SketchElement> = {}) =>
  ({ ...newShape('ellipse', { x, y, width: w, height: h, style: style() }), ...extra }) as SketchElement;
export const diamond = (x: number, y: number, w: number, h: number, extra: Partial<SketchElement> = {}) =>
  ({ ...newShape('diamond', { x, y, width: w, height: h, style: style() }), ...extra }) as SketchElement;
export const linear = (type: 'line' | 'arrow', pts: P2[], extra: Partial<LinearElement> = {}): LinearElement => {
  const [x0, y0] = pts[0];
  const points = pts.map(([x, y]) => [x - x0, y - y0] as P2);
  const b = pointsBounds(points);
  return { ...newLinear(type, { x: x0, y: y0, style: { ...style(), roundness: false } }), points, width: b.maxX - b.minX, height: b.maxY - b.minY, ...extra };
};
export const freedraw = (pts: P2[]) => {
  const [x0, y0] = pts[0];
  const points = pts.map(([x, y]) => [x - x0, y - y0] as P2);
  const b = pointsBounds(points);
  return { ...newFreedraw({ x: x0, y: y0, style: style() }), points, width: b.maxX - b.minX, height: b.maxY - b.minY } as SketchElement;
};
export const text = (x: number, y: number, t: string, extra: Partial<SketchElement> = {}) =>
  ({ ...newText({ x, y, width: 100, height: 25, style: style(), text: t }), ...extra }) as SketchElement;
export const image = (x: number, y: number, w: number, h: number) => newImage({ x, y, width: w, height: h, style: style(), fileId: 'f1' }) as SketchElement;
export const frame = (x: number, y: number, w: number, h: number) => newFrame({ x, y, width: w, height: h, style: style() }) as SketchElement;

export const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
