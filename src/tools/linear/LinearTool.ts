// Arrow & line tool. Drag to create a two-point element, or click-click to
// add points (finish with Escape/Enter/double-click or by clicking the last point).
// Shift snaps segment angles to 15°. Arrows bind to shapes near their ends.
import type { LinearElement } from '@/types/appState';
import type { CanvasPointerEvent, Tool, ToolContext } from '@/tools/types';
import { newLinear } from '@/engine/drawing/newElement';
import { applyBinding, getBindableElementAt, linearFromScenePoints } from '@/engine/drawing/binding';
import { getPointsInScene } from '@/engine/transformations/handles';
import { snapToGrid } from '@/engine/transformations/snapping';
import { snapAngle, type P2 } from '@/engine/math';
import { transient } from '@/engine/state/transient';
import { DRAG_THRESHOLD_PX } from '@/engine/constants';
import { finishCreation, store, visibleElements } from '@/tools/shared';

type Mode =
  | { kind: 'idle' }
  | { kind: 'down'; origin: P2; screen: { x: number; y: number }; startTarget: string | null }
  | { kind: 'drag'; id: string; startTarget: string | null }
  | { kind: 'multi'; id: string; startTarget: string | null; lastClickScreen: { x: number; y: number } };

export class LinearTool implements Tool {
  cursor = 'crosshair';
  private mode: Mode = { kind: 'idle' };

  constructor(public type: 'arrow' | 'line') {}

  isBusy() {
    return this.mode.kind !== 'idle';
  }

  private point(e: CanvasPointerEvent, ref?: P2): P2 {
    let p: P2 = [e.scene.x, e.scene.y];
    if (ref && e.shiftKey) {
      const ang = snapAngle(Math.atan2(p[1] - ref[1], p[0] - ref[0]));
      const len = Math.hypot(p[0] - ref[0], p[1] - ref[1]);
      p = [ref[0] + Math.cos(ang) * len, ref[1] + Math.sin(ang) * len];
    } else if (store().appState.gridEnabled && !e.modKey) p = [snapToGrid(p[0]), snapToGrid(p[1])];
    return p;
  }

  private target(p: P2, exclude?: string) {
    if (this.type !== 'arrow') return null;
    return getBindableElementAt(p[0], p[1], visibleElements(), store().appState.zoom, new Set(exclude ? [exclude] : []));
  }

  private setPoints(id: string, pts: P2[]) {
    store().updateElements({ [id]: linearFromScenePoints(pts) });
  }

  private create(origin: P2, second: P2) {
    const s = store();
    const el = newLinear(this.type, { x: origin[0], y: origin[1], style: s.appState.currentItem });
    // lines don't get arrowheads; arrows use the current defaults
    const withPts: LinearElement = { ...el, points: [[0, 0], [second[0] - origin[0], second[1] - origin[1]]] };
    s.addElements([withPts]);
    this.setPoints(el.id, [origin, second]);
    return el.id;
  }

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext) {
    if (e.button !== 0) return;
    const m = this.mode;
    if (m.kind === 'multi') {
      const el = store().elementsById[m.id];
      if (!el || el.type !== this.type) {
        this.mode = { kind: 'idle' };
        return;
      }
      const pts = getPointsInScene(el);
      const fixed = pts.slice(0, -1);
      const last = fixed[fixed.length - 1];
      const near = Math.hypot(e.screen.x - m.lastClickScreen.x, e.screen.y - m.lastClickScreen.y) < 8 + 2;
      if (near) {
        this.finish(ctx);
        return;
      }
      const p = this.point(e, last);
      this.setPoints(m.id, [...fixed, p, p]);
      m.lastClickScreen = { ...e.screen };
      return;
    }
    const origin = this.point(e);
    const t = this.target(origin);
    this.mode = { kind: 'down', origin, screen: e.screen, startTarget: t?.id ?? null };
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext) {
    const m = this.mode;
    if (m.kind === 'idle') {
      ctx.setCursor(this.cursor);
      return;
    }
    if (m.kind === 'down') {
      if (Math.hypot(e.screen.x - m.screen.x, e.screen.y - m.screen.y) < DRAG_THRESHOLD_PX) return;
      const id = this.create(m.origin, this.point(e, m.origin));
      this.mode = { kind: 'drag', id, startTarget: m.startTarget };
    }
    const cur = this.mode;
    if (cur.kind !== 'drag' && cur.kind !== 'multi') return;
    const el = store().elementsById[cur.id];
    if (!el) return;
    const pts = getPointsInScene(el);
    const p = this.point(e, pts[pts.length - 2]);
    pts[pts.length - 1] = p;
    this.setPoints(cur.id, pts);
    const t = this.target(p, cur.id);
    transient.set({ suggestedBindingId: t?.id ?? null });
  }

  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext) {
    const m = this.mode;
    if (m.kind === 'down') {
      // click without drag: start multi-point mode with a floating point
      const id = this.create(m.origin, m.origin);
      this.mode = { kind: 'multi', id, startTarget: m.startTarget, lastClickScreen: { ...e.screen } };
      return;
    }
    if (m.kind === 'drag') this.finish(ctx);
  }

  onDoubleClick(_e: CanvasPointerEvent, ctx: ToolContext) {
    if (this.mode.kind === 'multi') this.finish(ctx);
  }

  /** complete the element in progress (Enter / Escape / double-click) */
  finish(ctx: ToolContext) {
    const m = this.mode;
    this.mode = { kind: 'idle' };
    transient.set({ suggestedBindingId: null });
    if (m.kind !== 'drag' && m.kind !== 'multi') return;
    const s = store();
    const el = s.elementsById[m.id];
    if (!el) return;
    let pts = getPointsInScene(el);
    if (m.kind === 'multi') pts = pts.slice(0, -1);
    // drop consecutive duplicates
    pts = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
    if (pts.length < 2) {
      s.deleteElements([m.id]);
      return;
    }
    this.setPoints(m.id, pts);
    if (this.type === 'arrow') {
      const st = m.startTarget ? store().elementsById[m.startTarget] : null;
      if (st) applyBinding(m.id, 'start', st);
      const endT = this.target(pts[pts.length - 1], m.id);
      if (endT && (endT.id !== m.startTarget || pts.length > 2)) applyBinding(m.id, 'end', endT);
    }
    finishCreation(ctx, [m.id]);
    store().commit();
  }

  cancel(ctx: ToolContext) {
    if (this.mode.kind === 'down') this.mode = { kind: 'idle' };
    else this.finish(ctx);
  }
}
