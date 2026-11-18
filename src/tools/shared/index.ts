// Helpers shared by tools. Tools talk to state only via store getState/actions.
import { selectors, useCanvasStore } from '@/store/canvasStore';
import type { AppState, SketchElement, SnapLine } from '@/types/appState';
import type { CanvasPointerEvent, ToolContext } from '@/tools/types';
import { getSnapTargets, snapPoint, snapToGrid, type SnapTargets } from '@/engine/transformations/snapping';
import { viewportBounds } from '@/engine/rendering/renderScene';
import { SNAP_DISTANCE_PX } from '@/engine/constants';

export const store = () => useCanvasStore.getState();
export const appState = (): AppState => useCanvasStore.getState().appState;
export const visibleElements = () => selectors.visibleElements(useCanvasStore.getState());

/** after drawing an element: select it and return to the selection tool unless locked */
export const finishCreation = (ctx: ToolContext, ids: string[]) => {
  const s = store();
  s.setSelection(ids);
  if (!s.appState.toolLocked) ctx.setTool('selection');
};

export const snapEnabled = (e: { modKey: boolean }) => appState().snapEnabled && !e.modKey;

export const snapThreshold = () => SNAP_DISTANCE_PX / appState().zoom;

export const collectSnapTargets = (exclude: Set<string>): SnapTargets => {
  const a = appState();
  return getSnapTargets(visibleElements(), exclude, viewportBounds(a));
};

/** snap a creation/resize point to grid or objects; also publishes guide lines */
export const snapScenePoint = (
  x: number,
  y: number,
  e: CanvasPointerEvent,
  targets: SnapTargets | null,
): { x: number; y: number } => {
  const a = appState();
  if (a.gridEnabled && !e.modKey) {
    setSnapLines([]);
    return { x: snapToGrid(x), y: snapToGrid(y) };
  }
  if (!targets || !snapEnabled(e)) {
    setSnapLines([]);
    return { x, y };
  }
  const r = snapPoint(x, y, targets, snapThreshold());
  setSnapLines(r.lines);
  return { x: r.x, y: r.y };
};

export const setSnapLines = (lines: SnapLine[]) => {
  const cur = appState().snapLines;
  if (!cur.length && !lines.length) return;
  store().setAppState({ snapLines: lines });
};

/** ids of elements to select when clicking `el`, honoring groups and editingGroupId */
export const groupAwareSelection = (el: SketchElement, a: AppState, elements: SketchElement[]): string[] => {
  if (!el.groupIds.length) return [el.id];
  let target: string | null;
  const k = a.editingGroupId ? el.groupIds.indexOf(a.editingGroupId) : -1;
  if (k === 0) target = null; // directly inside edited group: select the element
  else if (k > 0) target = el.groupIds[k - 1];
  else target = el.groupIds[el.groupIds.length - 1];
  if (!target) return [el.id];
  return elements.filter((e) => !e.isDeleted && e.groupIds.includes(target!)).map((e) => e.id);
};

/** expand ids with bound text labels and frame children (things that move together) */
export const withDependents = (ids: Iterable<string>, byId: Record<string, SketchElement>, elements: SketchElement[]) => {
  const set = new Set(ids);
  for (const id of [...set]) {
    const el = byId[id];
    if (!el) continue;
    for (const b of el.boundElements) if (b.type === 'text') set.add(b.id);
    if (el.type === 'frame') for (const c of elements) if (c.frameId === id && !c.isDeleted) set.add(c.id);
  }
  // labels of frame children
  for (const id of [...set]) {
    const el = byId[id];
    el?.boundElements.forEach((b) => b.type === 'text' && set.add(b.id));
  }
  return set;
};

/** lazily loaded collaboration service (built by another agent; may be missing) */
type CollabModule = { collab: { sendPointer: (p: unknown) => void; sendLaser: (pts: Array<[number, number, number]>) => void } };
// import.meta.glob resolves to {} when the file does not exist yet, so this
// compiles and runs before the collaboration service is merged.
const collabModules = import.meta.glob('/src/services/collaboration.ts');
let collabPromise: Promise<CollabModule | null> | null = null;
export const getCollab = () => {
  if (!collabPromise) {
    const load = collabModules['/src/services/collaboration.ts'];
    collabPromise = load ? load().then((m) => m as CollabModule).catch(() => null) : Promise.resolve(null);
  }
  return collabPromise;
};

/** lazily loaded actions (implemented by another agent; guard every call) */
export const callAction = async <K extends string>(name: K, ...args: unknown[]) => {
  try {
    const m = await import('@/services/actions');
    const fn = (m.actions as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
    if (typeof fn === 'function') return await fn(...args);
  } catch (err) {
    console.warn(`[sketchboard] action ${name} failed`, err);
  }
  return undefined;
};
