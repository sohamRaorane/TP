// Interactive layer: selection, handles, selection box, snap lines, eraser
// trail, binding/recognition hints, collaborator cursors and laser trails.
import type { AppState, SketchElement } from '@/types/appState';
import type { Collaborator, PointerPayload } from '@shared/protocol';
import { isLinear } from '@shared/element';
import { SELECTION_COLOR, SNAP_COLOR } from '@/engine/constants';
import { hasPoints, localToScene, type P2 } from '@/engine/math';
import { getCommonBounds } from '@/engine/transformations/bounds';
import {
  boundsSelectionFrame,
  elementSelectionFrame,
  frameCorners,
  getMidpointsInScene,
  getPointsInScene,
  getTransformHandles,
  POINT_HANDLE_RADIUS_PX,
  type SelectionFrame,
  type TransformHandles,
} from '@/engine/transformations/handles';
import { linearPath, outlinePolygon } from '@/engine/hitTesting';
import { scenePolygon } from '@/engine/drawing/binding';
import type { TransientState } from '@/engine/state/transient';

export interface InteractiveParams {
  elements: SketchElement[]; // visible
  byId: Record<string, SketchElement>;
  appState: AppState;
  transient: Readonly<TransientState>;
  dpr: number;
  now: number;
  collaborators: Collaborator[];
  pointers: Record<string, PointerPayload & { updated: number }>;
  lasers: Record<string, Array<[number, number, number]>>;
  localLaser: Array<[number, number, number]>;
  /** per remote socket: local receive time of its latest laser batch */
  laserReceivedAt: Record<string, number>;
}

export const LASER_FADE_MS = 1000;
const LASER_COLOR = '#ff3b30';

/** which selection UI the current selection gets (also used by the selection tool) */
export interface SelectionUi {
  mode: 'none' | 'single' | 'multi' | 'linear';
  frame: SelectionFrame | null;
  handles: TransformHandles;
  elements: SketchElement[];
}

export const selectedForUi = (elements: SketchElement[], appState: AppState) =>
  elements.filter((e) => appState.selectedElementIds[e.id] && e.id !== appState.editingTextId && !(e.type === 'text' && e.containerId && appState.selectedElementIds[e.containerId]));

/** compute selection frame + handles for the current selection */
export function getSelectionUi(elements: SketchElement[], appState: AppState): SelectionUi {
  const sel = selectedForUi(elements, appState);
  const zoom = appState.zoom;
  if (!sel.length) return { mode: 'none', frame: null, handles: {}, elements: sel };
  const locked = sel.some((e) => e.locked);
  if (sel.length === 1) {
    const el = sel[0];
    if (isLinear(el)) {
      const showBox = el.points.length > 2 && appState.editingLinearId !== el.id;
      const frame = showBox ? elementSelectionFrame(el, zoom) : null;
      return {
        mode: 'linear',
        frame,
        handles: frame && !locked && !appState.viewModeEnabled ? getTransformHandles(frame, zoom) : {},
        elements: sel,
      };
    }
    const frame = elementSelectionFrame(el, zoom);
    return {
      mode: 'single',
      frame,
      handles: locked || appState.viewModeEnabled ? {} : getTransformHandles(frame, zoom, { cornersOnly: el.type === 'text' }),
      elements: sel,
    };
  }
  const b = getCommonBounds(sel)!;
  const frame = boundsSelectionFrame(b, zoom);
  return { mode: 'multi', frame, handles: locked || appState.viewModeEnabled ? {} : getTransformHandles(frame, zoom), elements: sel };
}

const strokeFrame = (ctx: CanvasRenderingContext2D, f: SelectionFrame) => {
  const c = frameCorners(f);
  ctx.beginPath();
  ctx.moveTo(c[0][0], c[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(c[i][0], c[i][1]);
  ctx.closePath();
  ctx.stroke();
};

const drawHandles = (ctx: CanvasRenderingContext2D, handles: TransformHandles, angle: number, zoom: number) => {
  ctx.save();
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.fillStyle = '#fff';
  for (const [k, h] of Object.entries(handles)) {
    if (!h) continue;
    if (k === 'rotation') {
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      continue;
    }
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(angle);
    const s = h.size;
    const r = 2 / zoom;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-s / 2, -s / 2, s, s, r);
    else ctx.rect(-s / 2, -s / 2, s, s);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
};

const drawPointHandles = (ctx: CanvasRenderingContext2D, el: SketchElement, p: InteractiveParams) => {
  const zoom = p.appState.zoom;
  const pts = getPointsInScene(el);
  const editing = p.appState.editingLinearId === el.id;
  ctx.save();
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = SELECTION_COLOR;
  if (editing) {
    // faint outline of the path while editing
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
    getMidpointsInScene(el).forEach(([x, y], i) => {
      ctx.beginPath();
      ctx.fillStyle = p.transient.hoveredMidpoint === i ? 'rgba(105,101,219,0.5)' : 'rgba(105,101,219,0.18)';
      ctx.arc(x, y, (POINT_HANDLE_RADIUS_PX - 1) / zoom, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  pts.forEach(([x, y], i) => {
    const endpoint = i === 0 || i === pts.length - 1;
    const selected = p.transient.selectedPoints.includes(i);
    const hovered = p.transient.hoveredPoint === i;
    ctx.beginPath();
    ctx.fillStyle = selected ? SELECTION_COLOR : hovered ? '#e5e4fb' : '#fff';
    ctx.arc(x, y, (endpoint ? POINT_HANDLE_RADIUS_PX : POINT_HANDLE_RADIUS_PX - 1) / zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
};

/** outline following the element geometry (hover / binding hint / remote selection) */
const traceElementOutline = (ctx: CanvasRenderingContext2D, el: SketchElement) => {
  ctx.beginPath();
  if (hasPoints(el)) {
    const path = el.type === 'freedraw' ? (el.points as P2[]) : linearPath(el);
    path.forEach(([x, y], i) => {
      const [sx, sy] = localToScene(el, x, y);
      if (i) ctx.lineTo(sx, sy);
      else ctx.moveTo(sx, sy);
    });
    return;
  }
  const poly = outlinePolygon(el).map(([x, y]) => localToScene(el, x, y));
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
};

const drawSelection = (ctx: CanvasRenderingContext2D, p: InteractiveParams) => {
  const { appState } = p;
  const zoom = appState.zoom;
  const ui = getSelectionUi(p.elements, appState);
  ctx.save();
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1 / zoom;
  if (ui.mode === 'single' && ui.frame) {
    const locked = ui.elements[0].locked;
    if (locked) ctx.setLineDash([6 / zoom, 4 / zoom]);
    strokeFrame(ctx, ui.frame);
    drawHandles(ctx, ui.handles, ui.frame.angle, zoom);
    // label inside a container: show the container frame only
  } else if (ui.mode === 'linear') {
    const el = ui.elements[0];
    if (ui.frame) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      strokeFrame(ctx, ui.frame);
      ctx.restore();
      drawHandles(ctx, ui.handles, ui.frame.angle, zoom);
    }
    if (!el.locked && !appState.viewModeEnabled) drawPointHandles(ctx, el, p);
  } else if (ui.mode === 'multi' && ui.frame) {
    ctx.save();
    ctx.setLineDash([4 / zoom, 3 / zoom]);
    ctx.globalAlpha = 0.7;
    for (const el of ui.elements) strokeFrame(ctx, elementSelectionFrame(el, zoom));
    ctx.restore();
    strokeFrame(ctx, ui.frame);
    drawHandles(ctx, ui.handles, 0, zoom);
  }
  // group being edited
  if (appState.editingGroupId) {
    const members = p.elements.filter((e) => e.groupIds.includes(appState.editingGroupId!));
    const b = getCommonBounds(members);
    if (b) {
      ctx.save();
      ctx.setLineDash([8 / zoom, 6 / zoom]);
      ctx.globalAlpha = 0.5;
      strokeFrame(ctx, boundsSelectionFrame(b, zoom / 3));
      ctx.restore();
    }
  }
  ctx.restore();
};

const drawRemote = (ctx: CanvasRenderingContext2D, p: InteractiveParams) => {
  const { zoom, scrollX, scrollY } = p.appState;
  const bySocket = new Map(p.collaborators.map((c) => [c.socketId, c]));
  // remote selections (scene space)
  ctx.save();
  ctx.lineWidth = 1.5 / zoom;
  for (const [sid, ptr] of Object.entries(p.pointers)) {
    const col = bySocket.get(sid)?.color ?? '#868e96';
    if (!ptr.selectedElementIds?.length) continue;
    ctx.strokeStyle = col;
    ctx.setLineDash([5 / zoom, 4 / zoom]);
    for (const id of ptr.selectedElementIds) {
      const el = p.byId[id];
      if (!el || el.isDeleted) continue;
      strokeFrame(ctx, elementSelectionFrame(el, zoom));
    }
  }
  ctx.restore();
  // cursors in screen space
  ctx.save();
  ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
  for (const [sid, ptr] of Object.entries(p.pointers)) {
    if (p.now - ptr.updated > 60_000) continue;
    const c = bySocket.get(sid);
    if (!c && p.collaborators.length) continue;
    const color = c?.color ?? '#868e96';
    const sx = (ptr.x + scrollX) * zoom;
    const sy = (ptr.y + scrollY) * zoom;
    if (sx < -50 || sy < -50 || sx > p.appState.width + 50 || sy > p.appState.height + 50) continue;
    const idle = p.now - ptr.updated > 5000;
    ctx.globalAlpha = idle ? 0.5 : 1;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy + 16);
    ctx.lineTo(sx + 4.5, sy + 12);
    ctx.lineTo(sx + 11, sy + 13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (ptr.button === 'down') {
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.globalAlpha = 0.2;
      ctx.fill();
      ctx.globalAlpha = idle ? 0.5 : 1;
    }
    const name = c?.name ?? 'Guest';
    ctx.font = "600 12px Helvetica, 'Segoe UI', Arial, sans-serif";
    const tw = ctx.measureText(name).width;
    const lx = sx + 12, ly = sy + 16;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(lx, ly, tw + 12, 20, 6);
    else ctx.rect(lx, ly, tw + 12, 20);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, lx + 6, ly + 10.5);
  }
  ctx.restore();
};

/** draws a fading laser trail; returns true while still visible */
const drawLaser = (ctx: CanvasRenderingContext2D, pts: Array<[number, number, number]>, ageOf: (t: number) => number, zoom: number, color = LASER_COLOR) => {
  const live = pts.filter((pt) => ageOf(pt[2]) < LASER_FADE_MS);
  if (live.length < 1) return false;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  for (let i = 1; i < live.length; i++) {
    const a = live[i - 1], b = live[i];
    const life = 1 - ageOf(b[2]) / LASER_FADE_MS;
    ctx.globalAlpha = Math.max(0, life);
    ctx.strokeStyle = color;
    ctx.lineWidth = (1.5 + 3 * life) / zoom;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  const head = live[live.length - 1];
  const life = 1 - ageOf(head[2]) / LASER_FADE_MS;
  ctx.globalAlpha = Math.max(0, life);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(head[0], head[1], 3.5 / zoom, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return true;
};

/** returns true if another frame is needed (animations in progress) */
export function renderInteractive(ctx: CanvasRenderingContext2D, p: InteractiveParams): boolean {
  const { appState, dpr } = p;
  const { zoom, scrollX, scrollY } = appState;
  let animating = false;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, appState.width, appState.height);
  ctx.scale(zoom, zoom);
  ctx.translate(scrollX, scrollY);

  // hover outline
  const hovered = appState.hoveredElementId ? p.byId[appState.hoveredElementId] : undefined;
  if (hovered && !hovered.isDeleted && !appState.selectedElementIds[hovered.id] && appState.activeTool === 'selection') {
    ctx.save();
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5 / zoom;
    traceElementOutline(ctx, hovered);
    ctx.stroke();
    ctx.restore();
  }

  // binding suggestion
  const bind = p.transient.suggestedBindingId ? p.byId[p.transient.suggestedBindingId] : undefined;
  if (bind && !bind.isDeleted) {
    ctx.save();
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 8 / zoom;
    ctx.lineJoin = 'round';
    const poly = scenePolygon(bind);
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  drawSelection(ctx, p);

  // shape recognition preview
  const rec = p.transient.recognition;
  if (rec) {
    ctx.save();
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([6 / zoom, 5 / zoom]);
    ctx.beginPath();
    if (rec.type === 'line' || rec.type === 'arrow') {
      ctx.moveTo(rec.start[0], rec.start[1]);
      ctx.lineTo(rec.end[0], rec.end[1]);
    } else if (rec.type === 'rectangle') ctx.rect(rec.x, rec.y, rec.width, rec.height);
    else if (rec.type === 'ellipse') ctx.ellipse(rec.x + rec.width / 2, rec.y + rec.height / 2, rec.width / 2, rec.height / 2, 0, 0, Math.PI * 2);
    else if (rec.type === 'diamond') {
      ctx.moveTo(rec.x + rec.width / 2, rec.y);
      ctx.lineTo(rec.x + rec.width, rec.y + rec.height / 2);
      ctx.lineTo(rec.x + rec.width / 2, rec.y + rec.height);
      ctx.lineTo(rec.x, rec.y + rec.height / 2);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
  }

  // selection box
  const sb = appState.selectionBox;
  if (sb) {
    ctx.save();
    ctx.fillStyle = 'rgba(105,101,219,0.08)';
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1 / zoom;
    ctx.fillRect(sb.x, sb.y, sb.width, sb.height);
    ctx.strokeRect(sb.x, sb.y, sb.width, sb.height);
    ctx.restore();
  }

  // snap lines
  if (appState.snapLines.length) {
    ctx.save();
    ctx.strokeStyle = SNAP_COLOR;
    ctx.lineWidth = 1 / zoom;
    const m = 3 / zoom;
    ctx.beginPath();
    for (const l of appState.snapLines) {
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
      for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2]]) {
        ctx.moveTo(x - m, y - m);
        ctx.lineTo(x + m, y + m);
        ctx.moveTo(x + m, y - m);
        ctx.lineTo(x - m, y + m);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // eraser trail
  const trail = appState.eraserTrail;
  if (trail.length > 1) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < trail.length; i++) {
      const k = i / trail.length;
      ctx.strokeStyle = `rgba(150,150,150,${0.15 + 0.35 * k})`;
      ctx.lineWidth = (2 + 4 * k) / zoom;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1][0], trail[i - 1][1]);
      ctx.lineTo(trail[i][0], trail[i][1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRemote(ctx, p);

  // lasers (scene space)
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.scale(zoom, zoom);
  ctx.translate(scrollX, scrollY);
  if (drawLaser(ctx, p.localLaser, (t) => p.now - t, zoom)) animating = true;
  const bySocket = new Map(p.collaborators.map((c) => [c.socketId, c]));
  for (const [sid, pts] of Object.entries(p.lasers)) {
    if (!pts.length) continue;
    const recv = p.laserReceivedAt[sid] ?? p.now;
    const lastT = pts[pts.length - 1][2];
    // age relative to local receive time (robust to clock skew between clients)
    const ageOf = (t: number) => p.now - recv + (lastT - t);
    if (drawLaser(ctx, pts, ageOf, zoom, bySocket.get(sid)?.color ?? LASER_COLOR)) animating = true;
  }
  ctx.restore();

  ctx.restore();
  return animating;
}
