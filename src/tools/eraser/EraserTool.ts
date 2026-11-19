// Eraser: drag a trail; touched elements are previewed faded and deleted on release.
import type { SketchElement } from '@/types/appState';
import type { CanvasPointerEvent, Tool, ToolContext } from '@/tools/types';
import { hitTestElement } from '@/engine/hitTesting';
import { getElementBounds } from '@/engine/transformations/bounds';
import { store, visibleElements } from '@/tools/shared';

const ERASER_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Ccircle cx='10' cy='10' r='5' fill='white' stroke='%231e1e1e' stroke-width='1.5'/%3E%3C/svg%3E\") 10 10, cell";

const TRAIL_MAX = 24;

export class EraserTool implements Tool {
  type = 'eraser' as const;
  cursor = ERASER_CURSOR;
  private active = false;
  private last: [number, number] | null = null;
  private pending = new Set<string>();

  isBusy() {
    return this.active;
  }

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button !== 0) return;
    this.active = true;
    this.pending = new Set();
    this.last = [e.scene.x, e.scene.y];
    this.eraseAlong(e.scene.x, e.scene.y);
    this.publish([[e.scene.x, e.scene.y]]);
  }

  private publish(trail: Array<[number, number]>) {
    store().setAppState({
      eraserTrail: trail.slice(-TRAIL_MAX),
      pendingEraseIds: Object.fromEntries([...this.pending].map((id) => [id, true as const])),
    });
  }

  private eraseAlong(x: number, y: number) {
    const s = store();
    const zoom = s.appState.zoom;
    const tol = 4 / zoom;
    const [lx, ly] = this.last ?? [x, y];
    const len = Math.hypot(x - lx, y - ly);
    const steps = Math.max(1, Math.ceil(len / (4 / zoom)));
    const minX = Math.min(x, lx) - 20 / zoom, maxX = Math.max(x, lx) + 20 / zoom;
    const minY = Math.min(y, ly) - 20 / zoom, maxY = Math.max(y, ly) + 20 / zoom;
    const els = visibleElements();
    const candidates = els.filter((el) => {
      if (el.locked || this.pending.has(el.id)) return false;
      const b = getElementBounds(el);
      return b.maxX + el.strokeWidth * 3 >= minX && b.minX - el.strokeWidth * 3 <= maxX && b.maxY + el.strokeWidth * 3 >= minY && b.minY - el.strokeWidth * 3 <= maxY;
    });
    for (const el of candidates) {
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (hitTestElement(el, lx + (x - lx) * t, ly + (y - ly) * t, tol, { zoom })) {
          this.addWithRelated(el, els);
          break;
        }
      }
    }
    this.last = [x, y];
  }

  private addWithRelated(el: SketchElement, els: SketchElement[]) {
    const s = store();
    const target = el.type === 'text' && el.containerId ? s.elementsById[el.containerId] ?? el : el;
    this.pending.add(target.id);
    for (const b of target.boundElements) if (b.type === 'text') this.pending.add(b.id);
    // erase whole (outermost) groups
    const g = target.groupIds[target.groupIds.length - 1];
    if (g) for (const o of els) if (o.groupIds.includes(g) && !o.locked) this.pending.add(o.id);
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext) {
    if (!this.active) {
      ctx.setCursor(this.cursor);
      return;
    }
    this.eraseAlong(e.scene.x, e.scene.y);
    this.publish([...store().appState.eraserTrail, [e.scene.x, e.scene.y]]);
  }

  onPointerUp() {
    if (!this.active) return;
    this.active = false;
    const s = store();
    const ids = [...this.pending];
    this.pending = new Set();
    this.last = null;
    s.setAppState({ eraserTrail: [], pendingEraseIds: {} });
    if (ids.length) {
      s.deleteElements(ids);
      s.commit();
    }
  }

  cancel() {
    this.active = false;
    this.pending = new Set();
    store().setAppState({ eraserTrail: [], pendingEraseIds: {} });
  }
}
