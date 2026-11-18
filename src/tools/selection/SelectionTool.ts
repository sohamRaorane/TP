// Selection tool: click/shift/box select, move (Alt duplicates), resize,
// rotate, linear point editing, group entering, text/label editing.
import type { ElementChanges } from '@/store/canvasStore';
import type { LinearElement, SketchElement } from '@/types/appState';
import { isLinear } from '@shared/element';
import type { CanvasPointerEvent, Tool, ToolContext } from '@/tools/types';
import { cloneElements } from '@/engine/drawing/newElement';
import { hitTestElement, hitTestScene } from '@/engine/hitTesting';
import { getElementsInRect } from '@/engine/hitTesting';
import { getCommonBounds, getElementBounds, boundsContain, type Bounds } from '@/engine/transformations/bounds';
import {
  cursorForHandle,
  getPointsInScene,
  hitTestHandle,
  hitTestMidpointHandle,
  hitTestPointHandle,
  type HandleType,
  type ResizeHandle,
} from '@/engine/transformations/handles';
import { resizeMultipleElements, resizeSingleElement } from '@/engine/transformations/resize';
import { rotateElements, rotateSingleElement, rotationDelta } from '@/engine/transformations/rotate';
import { snapBounds, snapToGrid, type SnapTargets } from '@/engine/transformations/snapping';
import { getSelectionUi } from '@/engine/rendering/interactive';
import {
  applyBinding,
  bindingChanges,
  getBindableElementAt,
  linearFromScenePoints,
  updateBoundArrows,
} from '@/engine/drawing/binding';
import { canHaveLabel, updateBoundTexts } from '@/engine/drawing/boundText';
import { createTextAt, editContainerLabel } from '@/tools/shared/text';
import { getElementCenter, snapAngle, type P2 } from '@/engine/math';
import { transient } from '@/engine/state/transient';
import { DRAG_THRESHOLD_PX } from '@/engine/constants';
import {
  appState,
  collectSnapTargets,
  groupAwareSelection,
  setSnapLines,
  snapEnabled,
  snapScenePoint,
  snapThreshold,
  store,
  visibleElements,
  withDependents,
} from '@/tools/shared';

type Mode =
  | { kind: 'idle' }
  | { kind: 'pending'; start: CanvasPointerEvent; hitId: string | null; wasSelected: boolean; shift: boolean }
  | {
      kind: 'move';
      start: CanvasPointerEvent;
      origs: Map<string, SketchElement>;
      /** elements actually selected (bounds used for snapping) */
      primary: string[];
      startBounds: Bounds | null;
      targets: SnapTargets;
      duplicated: boolean;
    }
  | { kind: 'box'; start: CanvasPointerEvent; initial: string[] }
  | {
      kind: 'resize';
      handle: ResizeHandle;
      origs: Map<string, SketchElement>;
      primary: string[];
      bounds: Bounds;
      targets: SnapTargets;
    }
  | { kind: 'rotate'; origs: Map<string, SketchElement>; primary: string[]; center: { x: number; y: number }; start: CanvasPointerEvent }
  | { kind: 'point'; id: string; index: number; orig: LinearElement };

const HIT_TOL_PX = 8;

/** ids plus arrows bound to them (excluded from snapping while moving) */
const withBoundArrows = (ids: Set<string>, byId: Record<string, SketchElement>) => {
  const out = new Set(ids);
  for (const id of ids) byId[id]?.boundElements.forEach((b) => b.type === 'arrow' && out.add(b.id));
  return out;
};

export class SelectionTool implements Tool {
  type = 'selection' as const;
  cursor = 'default';
  private mode: Mode = { kind: 'idle' };

  isBusy() {
    return this.mode.kind !== 'idle' && this.mode.kind !== 'pending';
  }

  // ------------------------------------------------------------ pointer down
  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext) {
    if (e.button !== 0) return;
    const s = store();
    const a = s.appState;
    const zoom = a.zoom;
    const { x, y } = e.scene;
    const els = visibleElements();
    const view = a.viewModeEnabled;

    // 1. linear point editing
    if (!view && a.editingLinearId) {
      const el = s.elementsById[a.editingLinearId];
      if (el && isLinear(el) && !el.isDeleted) {
        const pi = hitTestPointHandle(el, x, y, zoom);
        if (pi >= 0) {
          transient.set({ selectedPoints: [pi] });
          this.mode = { kind: 'point', id: el.id, index: pi, orig: el };
          return;
        }
        const mi = hitTestMidpointHandle(el, x, y, zoom);
        if (mi >= 0) {
          const pts = getPointsInScene(el);
          const mid: P2 = [(pts[mi][0] + pts[mi + 1][0]) / 2, (pts[mi][1] + pts[mi + 1][1]) / 2];
          pts.splice(mi + 1, 0, mid);
          s.updateElements({ [el.id]: linearFromScenePoints(pts) });
          const updated = store().elementsById[el.id] as LinearElement;
          transient.set({ selectedPoints: [mi + 1], hoveredMidpoint: -1 });
          this.mode = { kind: 'point', id: el.id, index: mi + 1, orig: updated };
          return;
        }
      }
      s.setAppState({ editingLinearId: null });
      transient.set({ selectedPoints: [] });
    }

    // 2. transform / point handles of the current selection
    const ui = getSelectionUi(els, store().appState);
    if (!view && ui.mode === 'linear' && !ui.elements[0].locked) {
      const el = ui.elements[0] as LinearElement;
      const pi = hitTestPointHandle(el, x, y, zoom);
      if (pi >= 0) {
        transient.set({ selectedPoints: [pi] });
        this.mode = { kind: 'point', id: el.id, index: pi, orig: el };
        return;
      }
    }
    const handle = view ? null : hitTestHandle(ui.handles, x, y, zoom);
    if (handle && ui.frame) {
      this.startTransform(handle, ui.elements, e);
      return;
    }

    // 3. elements
    const hit = hitTestScene(x, y, els, HIT_TOL_PX / zoom, { selectedIds: a.selectedElementIds, skipLocked: true, zoom });
    if (hit) {
      const wasSelected = !!a.selectedElementIds[hit.id];
      if (a.editingGroupId && !hit.groupIds.includes(a.editingGroupId)) s.setAppState({ editingGroupId: null });
      const ids = groupAwareSelection(hit, store().appState, els);
      if (e.shiftKey) {
        if (!wasSelected) s.setSelection([...Object.keys(a.selectedElementIds), ...ids]);
      } else if (!wasSelected) s.setSelection(ids);
      this.mode = { kind: 'pending', start: e, hitId: hit.id, wasSelected, shift: e.shiftKey };
      return;
    }

    // 4. empty canvas: box selection
    if (!e.shiftKey) {
      s.setSelection([]);
      if (a.editingGroupId) s.setAppState({ editingGroupId: null });
    }
    this.mode = { kind: 'box', start: e, initial: e.shiftKey ? Object.keys(a.selectedElementIds) : [] };
    ctx.requestRender();
  }

  private startTransform(handle: HandleType, selected: SketchElement[], e: CanvasPointerEvent) {
    const s = store();
    const ids = selected.map((el) => el.id);
    const all = withDependents(ids, s.elementsById, s.elements);
    const origs = new Map<string, SketchElement>();
    for (const id of all) {
      const el = s.elementsById[id];
      if (el) origs.set(id, el);
    }
    const bounds = getCommonBounds(selected)!;
    if (handle === 'rotation') {
      const center = selected.length === 1 ? getElementCenter(selected[0]) : { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
      this.mode = { kind: 'rotate', origs, primary: ids, center, start: e };
      return;
    }
    this.mode = { kind: 'resize', handle, origs, primary: ids, bounds, targets: collectSnapTargets(withBoundArrows(all, s.elementsById)) };
  }

  // ------------------------------------------------------------ pointer move
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext) {
    const m = this.mode;
    switch (m.kind) {
      case 'idle':
        this.hover(e, ctx);
        return;
      case 'pending': {
        const d = Math.hypot(e.screen.x - m.start.screen.x, e.screen.y - m.start.screen.y);
        if (d < DRAG_THRESHOLD_PX) return;
        const a = appState();
        if (a.viewModeEnabled) return;
        this.startMove(m.start);
        this.onPointerMove(e, ctx);
        return;
      }
      case 'move':
        this.doMove(m, e);
        return;
      case 'box': {
        const x = Math.min(m.start.scene.x, e.scene.x);
        const y = Math.min(m.start.scene.y, e.scene.y);
        const rect = { x, y, width: Math.abs(e.scene.x - m.start.scene.x), height: Math.abs(e.scene.y - m.start.scene.y) };
        const s = store();
        const els = visibleElements();
        const a = s.appState;
        const inside = getElementsInRect(rect, els).filter((el) => !el.locked);
        const ids = new Set(m.initial);
        for (const el of inside) {
          if (a.editingGroupId && !el.groupIds.includes(a.editingGroupId)) continue;
          for (const id of groupAwareSelection(el, a, els)) ids.add(id);
        }
        s.setAppState({ selectionBox: rect, selectedElementIds: Object.fromEntries([...ids].map((id) => [id, true as const])) });
        return;
      }
      case 'resize':
        this.doResize(m, e);
        return;
      case 'rotate':
        this.doRotate(m, e);
        return;
      case 'point':
        this.doPoint(m, e);
        return;
    }
  }

  private hover(e: CanvasPointerEvent, ctx: ToolContext) {
    const a = appState();
    const zoom = a.zoom;
    const { x, y } = e.scene;
    const els = visibleElements();
    const ui = getSelectionUi(els, a);
    let cursor = 'default';
    let hoveredPoint = -1;
    let hoveredMidpoint = -1;
    if (!a.viewModeEnabled) {
      const h = hitTestHandle(ui.handles, x, y, zoom);
      if (h) cursor = cursorForHandle(h, ui.frame?.angle ?? 0);
      const lin = a.editingLinearId ? store().elementsById[a.editingLinearId] : ui.mode === 'linear' ? ui.elements[0] : undefined;
      if (!h && lin && !lin.isDeleted) {
        hoveredPoint = hitTestPointHandle(lin, x, y, zoom);
        if (hoveredPoint >= 0) cursor = 'move';
        else if (a.editingLinearId) {
          hoveredMidpoint = hitTestMidpointHandle(lin, x, y, zoom);
          if (hoveredMidpoint >= 0) cursor = 'copy';
        }
      }
    }
    transient.set({ hoveredPoint, hoveredMidpoint });
    const hit = cursor === 'default' ? hitTestScene(x, y, els, HIT_TOL_PX / zoom, { selectedIds: a.selectedElementIds, skipLocked: true, zoom }) : null;
    if (hit && !a.viewModeEnabled) cursor = 'move';
    const hoveredElementId = hit?.id ?? null;
    if (hoveredElementId !== a.hoveredElementId) store().setAppState({ hoveredElementId });
    ctx.setCursor(cursor);
  }

  private startMove(start: CanvasPointerEvent) {
    const s = store();
    const sel = Object.keys(s.appState.selectedElementIds).filter((id) => s.elementsById[id] && !s.elementsById[id].isDeleted && !s.elementsById[id].locked);
    if (!sel.length) {
      this.mode = { kind: 'idle' };
      return;
    }
    const all = withDependents(sel, s.elementsById, s.elements);
    const origs = new Map<string, SketchElement>();
    for (const id of all) origs.set(id, s.elementsById[id]);
    const primaryEls = sel.map((id) => s.elementsById[id]);
    this.mode = {
      kind: 'move',
      start,
      origs,
      primary: sel,
      startBounds: getCommonBounds(primaryEls),
      targets: collectSnapTargets(withBoundArrows(all, s.elementsById)),
      duplicated: false,
    };
    s.setAppState({ hoveredElementId: null });
  }

  private doMove(m: Extract<Mode, { kind: 'move' }>, e: CanvasPointerEvent) {
    const s = store();
    const a = s.appState;
    if (e.altKey && !m.duplicated) this.duplicateForMove(m);
    let dx = e.scene.x - m.start.scene.x;
    let dy = e.scene.y - m.start.scene.y;
    if (e.shiftKey) {
      // constrain to the dominant axis
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    let lines: typeof a.snapLines = [];
    if (m.startBounds) {
      if (a.gridEnabled && !e.modKey) {
        dx = snapToGrid(m.startBounds.minX + dx) - m.startBounds.minX;
        dy = snapToGrid(m.startBounds.minY + dy) - m.startBounds.minY;
      } else if (snapEnabled(e)) {
        const b = { minX: m.startBounds.minX + dx, maxX: m.startBounds.maxX + dx, minY: m.startBounds.minY + dy, maxY: m.startBounds.maxY + dy };
        const r = snapBounds(b, m.targets, snapThreshold());
        dx += r.dx;
        dy += r.dy;
        lines = r.lines;
      }
    }
    const changes: Record<string, ElementChanges> = {};
    for (const [id, o] of m.origs) changes[id] = { x: o.x + dx, y: o.y + dy };
    s.updateElements(changes);
    updateBoundArrows(m.origs.keys());
    setSnapLines(lines);
  }

  private duplicateForMove(m: Extract<Mode, { kind: 'move' }>) {
    const s = store();
    const origs = [...m.origs.values()];
    const clones = cloneElements(origs, { x: 0, y: 0 });
    // originals stay where they were; we keep dragging the copies
    s.addElements(clones);
    const map = new Map<string, SketchElement>();
    const idMap = new Map<string, string>();
    origs.forEach((o, i) => {
      map.set(clones[i].id, clones[i]);
      idMap.set(o.id, clones[i].id);
    });
    // restore originals to start positions
    const reset: Record<string, ElementChanges> = {};
    for (const o of origs) reset[o.id] = { x: o.x, y: o.y };
    s.updateElements(reset);
    updateBoundArrows(origs.map((o) => o.id));
    m.origs = map;
    m.primary = m.primary.map((id) => idMap.get(id) ?? id);
    m.duplicated = true;
    s.setSelection(m.primary);
  }

  private doResize(m: Extract<Mode, { kind: 'resize' }>, e: CanvasPointerEvent) {
    const s = store();
    let px = e.scene.x, py = e.scene.y;
    const single = m.primary.length === 1 ? m.origs.get(m.primary[0])! : null;
    if (!single || !single.angle) {
      const p = snapScenePoint(px, py, e, m.targets);
      px = p.x;
      py = p.y;
    }
    const opts = { keepAspect: e.shiftKey, fromCenter: e.altKey };
    let changes: Record<string, ElementChanges>;
    if (single) {
      changes = { [single.id]: resizeSingleElement(single, m.handle, px, py, opts) };
    } else {
      const scaled = [...m.origs.values()].filter((el) => !(el.type === 'text' && el.containerId && m.origs.has(el.containerId)));
      // only the primary selection drives the bounds; dependents (frame children) scale with it
      changes = resizeMultipleElements(scaled, m.bounds, m.handle, px, py, opts);
    }
    s.updateElements(changes);
    const containers = Object.keys(changes);
    updateBoundTexts(containers);
    updateBoundArrows(containers);
  }

  private doRotate(m: Extract<Mode, { kind: 'rotate' }>, e: CanvasPointerEvent) {
    const s = store();
    let changes: Record<string, ElementChanges>;
    if (m.primary.length === 1) {
      const el = m.origs.get(m.primary[0])!;
      const single = rotateSingleElement(el, e.scene.x, e.scene.y, e.shiftKey);
      changes = { [el.id]: single };
      const delta = (single.angle as number) - el.angle;
      // dependents (labels) rotate with it
      const deps = [...m.origs.values()].filter((d) => d.id !== el.id);
      if (deps.length) Object.assign(changes, rotateElements(deps, m.center.x, m.center.y, delta));
    } else {
      const delta = rotationDelta(m.center.x, m.center.y, m.start.scene.x, m.start.scene.y, e.scene.x, e.scene.y, e.shiftKey);
      changes = rotateElements([...m.origs.values()], m.center.x, m.center.y, delta);
    }
    s.updateElements(changes);
    updateBoundTexts(m.primary);
    updateBoundArrows(Object.keys(changes));
  }

  private doPoint(m: Extract<Mode, { kind: 'point' }>, e: CanvasPointerEvent) {
    const s = store();
    const pts = getPointsInScene(m.orig);
    let p: P2 = [e.scene.x, e.scene.y];
    const n = pts.length;
    if (e.shiftKey && n > 1) {
      const ref = m.index === 0 ? pts[1] : pts[m.index - 1];
      const ang = snapAngle(Math.atan2(p[1] - ref[1], p[0] - ref[0]));
      const len = Math.hypot(p[0] - ref[0], p[1] - ref[1]);
      p = [ref[0] + Math.cos(ang) * len, ref[1] + Math.sin(ang) * len];
    } else if (appState().gridEnabled && !e.modKey) p = [snapToGrid(p[0]), snapToGrid(p[1])];
    pts[m.index] = p;
    const isEnd = m.index === 0 || m.index === n - 1;
    let suggested: string | null = null;
    if (m.orig.type === 'arrow' && isEnd) {
      const t = getBindableElementAt(p[0], p[1], visibleElements(), appState().zoom, new Set([m.id]));
      suggested = t?.id ?? null;
    }
    transient.set({ suggestedBindingId: suggested });
    s.updateElements({ [m.id]: linearFromScenePoints(pts) });
  }

  // ------------------------------------------------------------ pointer up
  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext) {
    const m = this.mode;
    this.mode = { kind: 'idle' };
    const s = store();
    switch (m.kind) {
      case 'pending': {
        const a = s.appState;
        const hit = m.hitId ? s.elementsById[m.hitId] : null;
        if (hit) {
          const ids = groupAwareSelection(hit, a, visibleElements());
          if (m.shift && m.wasSelected) {
            const next = Object.keys(a.selectedElementIds).filter((id) => !ids.includes(id));
            s.setSelection(next);
          } else if (!m.shift && m.wasSelected) s.setSelection(ids);
        }
        break;
      }
      case 'move': {
        this.finishMove(m);
        setSnapLines([]);
        s.commit();
        break;
      }
      case 'box':
        s.setAppState({ selectionBox: null });
        break;
      case 'resize':
      case 'rotate':
        setSnapLines([]);
        s.commit();
        break;
      case 'point': {
        const el = s.elementsById[m.id];
        if (el && el.type === 'arrow' && isLinear(el) && (m.index === 0 || m.index === el.points.length - 1)) {
          const sug = transient.get().suggestedBindingId;
          const target = sug ? s.elementsById[sug] ?? null : null;
          applyBinding(el.id, m.index === 0 ? 'start' : 'end', target);
        }
        transient.set({ suggestedBindingId: null });
        s.commit();
        break;
      }
    }
    ctx.requestRender();
  }

  /** after a move: unbind dragged arrows from targets left behind, update frame membership */
  private finishMove(m: Extract<Mode, { kind: 'move' }>) {
    const s = store();
    const moved = new Set(m.origs.keys());
    const changes: Record<string, ElementChanges> = {};
    for (const id of moved) {
      const el = s.elementsById[id];
      if (!el || !isLinear(el)) continue;
      for (const end of ['start', 'end'] as const) {
        const b = end === 'start' ? el.startBinding : el.endBinding;
        if (b && !moved.has(b.elementId)) {
          const cur = { ...el, ...(changes[el.id] ?? {}) } as LinearElement;
          const byId = { ...s.elementsById };
          for (const [cid, ch] of Object.entries(changes)) byId[cid] = { ...byId[cid], ...ch } as SketchElement;
          const ch = bindingChanges(cur, end, null, byId);
          for (const [cid, c] of Object.entries(ch)) changes[cid] = { ...(changes[cid] ?? {}), ...c };
        }
      }
    }
    // frame membership
    const frames = visibleElements().filter((f) => f.type === 'frame');
    if (frames.length || [...moved].some((id) => s.elementsById[id]?.frameId)) {
      for (const id of moved) {
        const el = s.elementsById[id];
        if (!el || el.type === 'frame' || (el.type === 'text' && el.containerId)) continue;
        if (el.frameId && moved.has(el.frameId)) continue;
        const b = getElementBounds(el);
        const f = [...frames].reverse().find((fr) => fr.id !== el.id && boundsContain(getElementBounds(fr), b));
        const next = f ? f.id : null;
        if (next !== el.frameId) {
          changes[id] = { ...(changes[id] ?? {}), frameId: next };
          for (const bnd of el.boundElements) if (bnd.type === 'text') changes[bnd.id] = { ...(changes[bnd.id] ?? {}), frameId: next };
        }
      }
    }
    if (Object.keys(changes).length) s.updateElements(changes);
  }

  // ------------------------------------------------------------ double click
  onDoubleClick(e: CanvasPointerEvent, ctx: ToolContext) {
    const s = store();
    const a = s.appState;
    if (a.viewModeEnabled) return;
    const zoom = a.zoom;
    const els = visibleElements();
    let hit = hitTestScene(e.scene.x, e.scene.y, els, HIT_TOL_PX / zoom, {
      selectedIds: a.selectedElementIds,
      skipLocked: true,
      mapLabelsToContainer: false,
      zoom,
    });
    if (!hit || hit.type === 'frame') {
      // double-click inside a transparent shape still targets it (label editing)
      for (let i = els.length - 1; i >= 0; i--) {
        const el = els[i];
        if (!el.locked && canHaveLabel(el) && hitTestElement(el, e.scene.x, e.scene.y, 0, { selected: true })) {
          hit = el;
          break;
        }
      }
    }
    if (hit && hit.groupIds.length) {
      // enter the next group level unless already at the element
      const k = a.editingGroupId ? hit.groupIds.indexOf(a.editingGroupId) : -1;
      const enter = k === -1 ? hit.groupIds[hit.groupIds.length - 1] : k > 0 ? hit.groupIds[k - 1] : null;
      if (enter) {
        s.setAppState({ editingGroupId: enter });
        s.setSelection(groupAwareSelection(hit, store().appState, els));
        return;
      }
    }
    if (hit?.type === 'text') {
      ctx.startTextEditing(hit.id);
      return;
    }
    if (hit && isLinear(hit)) {
      s.setSelection([hit.id]);
      s.setAppState({ editingLinearId: hit.id });
      transient.set({ selectedPoints: [] });
      return;
    }
    if (hit && canHaveLabel(hit)) {
      editContainerLabel(hit, ctx);
      return;
    }
    if (!hit) createTextAt(e.scene.x, e.scene.y, ctx);
  }

  cancel(ctx: ToolContext) {
    const m = this.mode;
    const s = store();
    if (m.kind === 'move' || m.kind === 'resize' || m.kind === 'rotate') {
      const changes: Record<string, ElementChanges> = {};
      for (const [id, o] of m.origs) changes[id] = { ...o } as ElementChanges;
      s.updateElements(changes);
      updateBoundArrows(m.origs.keys());
      s.commit();
    } else if (m.kind === 'point') {
      s.updateElements({ [m.id]: { ...m.orig } as ElementChanges });
      s.commit();
    }
    this.mode = { kind: 'idle' };
    transient.set({ suggestedBindingId: null, selectedPoints: [], hoveredPoint: -1, hoveredMidpoint: -1 });
    const a = s.appState;
    if (a.selectionBox || a.snapLines.length || a.editingLinearId)
      s.setAppState({ selectionBox: null, snapLines: [], editingLinearId: null });
    ctx.requestRender();
  }
}
