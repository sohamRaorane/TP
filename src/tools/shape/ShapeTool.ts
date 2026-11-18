// Drag-to-create tool for rectangle, diamond, ellipse and frame.
// Shift = square/circle, Alt = from center. A click without drag creates nothing.
import type { ElementChanges } from '@/store/canvasStore';
import type { SketchElement } from '@/types/appState';
import type { CanvasPointerEvent, Tool, ToolContext } from '@/tools/types';
import { newFrame, newShape } from '@/engine/drawing/newElement';
import { boundsContain, getElementBounds } from '@/engine/transformations/bounds';
import type { SnapTargets } from '@/engine/transformations/snapping';
import { DRAG_THRESHOLD_PX } from '@/engine/constants';
import { collectSnapTargets, finishCreation, setSnapLines, snapScenePoint, store, visibleElements } from '@/tools/shared';

type ShapeType = 'rectangle' | 'diamond' | 'ellipse' | 'frame';

let frameCounter = 0;

export class ShapeTool implements Tool {
  cursor = 'crosshair';
  private origin: { x: number; y: number; screen: { x: number; y: number } } | null = null;
  private id: string | null = null;
  private targets: SnapTargets | null = null;

  constructor(public type: ShapeType) {}

  isBusy() {
    return !!this.origin;
  }

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button !== 0) return;
    this.targets = collectSnapTargets(new Set());
    const p = snapScenePoint(e.scene.x, e.scene.y, e, this.targets);
    this.origin = { ...p, screen: e.screen };
    this.id = null;
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext) {
    const o = this.origin;
    if (!o) {
      ctx.setCursor(this.cursor);
      return;
    }
    const s = store();
    if (!this.id) {
      if (Math.hypot(e.screen.x - o.screen.x, e.screen.y - o.screen.y) < DRAG_THRESHOLD_PX) return;
      const style = s.appState.currentItem;
      const el =
        this.type === 'frame'
          ? newFrame({ x: o.x, y: o.y, style, name: `Frame ${++frameCounter}` })
          : newShape(this.type, { x: o.x, y: o.y, style });
      s.addElements([el]);
      this.id = el.id;
    }
    const p = snapScenePoint(e.scene.x, e.scene.y, e, this.targets);
    let dx = p.x - o.x;
    let dy = p.y - o.y;
    if (e.shiftKey) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * m;
      dy = Math.sign(dy || 1) * m;
    }
    let x1 = o.x, y1 = o.y, x2 = o.x + dx, y2 = o.y + dy;
    if (e.altKey) {
      x1 = o.x - dx;
      y1 = o.y - dy;
    }
    const ch: ElementChanges = {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
    s.updateElements({ [this.id]: ch });
  }

  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext) {
    const id = this.id;
    this.origin = null;
    this.id = null;
    setSnapLines([]);
    if (!id) return;
    const s = store();
    const el = s.elementsById[id];
    if (el && el.type === 'frame') adoptFrameChildren(el);
    finishCreation(ctx, [id]);
    store().commit();
  }

  cancel(ctx: ToolContext) {
    if (this.id) this.onPointerUp({} as CanvasPointerEvent, ctx);
    this.origin = null;
  }
}

/** elements fully inside a frame become its children */
export function adoptFrameChildren(frame: SketchElement) {
  const s = store();
  const fb = getElementBounds(frame);
  const changes: Record<string, ElementChanges> = {};
  for (const el of visibleElements()) {
    if (el.id === frame.id || el.type === 'frame' || el.frameId) continue;
    if (el.type === 'text' && el.containerId) continue;
    if (!boundsContain(fb, getElementBounds(el))) continue;
    changes[el.id] = { frameId: frame.id };
    for (const b of el.boundElements) if (b.type === 'text') changes[b.id] = { frameId: frame.id };
  }
  if (Object.keys(changes).length) s.updateElements(changes);
}
