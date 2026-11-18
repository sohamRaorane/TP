// Freehand drawing (perfect-freehand). Pen pressure is recorded; mouse/touch
// strokes use simulated pressure. Holding the pointer still for 500ms before
// releasing turns the stroke into a clean shape (smart shape recognition).
import type { FreedrawElement, SketchElement } from '@/types/appState';
import type { CanvasPointerEvent, Tool, ToolContext } from '@/tools/types';
import { newFreedraw, newLinear, newShape } from '@/engine/drawing/newElement';
import { recognizeShape, type RecognizedShape } from '@/engine/drawing/shapeRecognition';
import { linearFromScenePoints } from '@/engine/drawing/binding';
import { pointsBounds, type P2 } from '@/engine/math';
import { transient } from '@/engine/state/transient';
import { SHAPE_RECOGNITION_HOLD_MS } from '@/engine/constants';
import { store } from '@/tools/shared';

export class FreedrawTool implements Tool {
  type = 'freedraw' as const;
  cursor = 'crosshair';
  private id: string | null = null;
  private points: P2[] = [];
  private pressures: number[] = [];
  private pen = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stillAt: { x: number; y: number } | null = null;

  isBusy() {
    return !!this.id;
  }

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button !== 0) return;
    const s = store();
    this.pen = e.pointerType === 'pen';
    const el = newFreedraw({ x: e.scene.x, y: e.scene.y, style: s.appState.currentItem }, !this.pen);
    this.points = [[0, 0]];
    this.pressures = this.pen ? [e.pressure || 0.5] : [];
    s.addElements([{ ...el, pressures: this.pressures }]);
    this.id = el.id;
    this.stillAt = { ...e.screen };
    this.armHold();
  }

  private armHold() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.id) return;
      const el = store().elementsById[this.id] as FreedrawElement | undefined;
      if (!el) return;
      const scenePts = this.points.map(([x, y]) => [el.x + x, el.y + y] as P2);
      transient.set({ recognition: recognizeShape(scenePts) });
    }, SHAPE_RECOGNITION_HOLD_MS);
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext) {
    if (!this.id) {
      ctx.setCursor(this.cursor);
      return;
    }
    const s = store();
    const el = s.elementsById[this.id] as FreedrawElement | undefined;
    if (!el) return;
    const p: P2 = [e.scene.x - el.x, e.scene.y - el.y];
    const last = this.points[this.points.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) * s.appState.zoom < 0.75) return;
    // movement beyond a small radius cancels a pending hold/recognition
    if (this.stillAt && Math.hypot(e.screen.x - this.stillAt.x, e.screen.y - this.stillAt.y) > 4) {
      this.stillAt = { ...e.screen };
      if (transient.get().recognition) transient.set({ recognition: null });
      this.armHold();
    }
    this.points = [...this.points, p];
    if (this.pen) this.pressures = [...this.pressures, e.pressure || 0.5];
    const b = pointsBounds(this.points);
    s.updateElements({
      [this.id]: { points: this.points, pressures: this.pressures, width: b.maxX - b.minX, height: b.maxY - b.minY },
    });
  }

  onPointerUp() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const id = this.id;
    this.id = null;
    if (!id) return;
    const s = store();
    const rec = transient.get().recognition;
    transient.set({ recognition: null });
    const el = s.elementsById[id];
    if (rec && el) {
      const replacement = buildRecognizedElement(rec, el);
      s.deleteElements([id]);
      s.addElements([replacement]);
    }
    s.commit();
  }

  cancel() {
    this.onPointerUp();
  }
}

/** clean element replacing a recognized freedraw stroke (keeps its style) */
export function buildRecognizedElement(rec: RecognizedShape, src: SketchElement): SketchElement {
  const s = store();
  const style = {
    ...s.appState.currentItem,
    strokeColor: src.strokeColor,
    strokeWidth: src.strokeWidth,
    strokeStyle: src.strokeStyle,
    roughness: src.roughness,
    opacity: src.opacity,
  };
  if ('start' in rec) {
    const el = newLinear(rec.type, { x: rec.start[0], y: rec.start[1], style });
    const ch = linearFromScenePoints([rec.start, rec.end]);
    return {
      ...el,
      ...(ch as object),
      endArrowhead: rec.type === 'arrow' ? style.endArrowhead ?? 'arrow' : null,
      frameId: src.frameId,
    } as SketchElement;
  }
  const el = newShape(rec.type, { x: rec.x, y: rec.y, width: rec.width, height: rec.height, style });
  return { ...el, frameId: src.frameId, groupIds: [...src.groupIds] };
}
