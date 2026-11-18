// Scene query helpers shared by actions (pure where possible).
import type { AppState, SketchElement } from '@/types/appState';
import { useCanvasStore } from '@/store/canvasStore';
import { getCommonBounds, boundsToRect, type Bounds } from '@/engine/transformations/bounds';
import { screenToScene } from '@/engine/coordinates';

export const live = (els: readonly SketchElement[]) => els.filter((e) => !e.isDeleted);

/** selected live elements plus the bound text labels of selected containers (scene order) */
export function withBoundText(
  elements: readonly SketchElement[],
  selected: Record<string, true> | Set<string>,
): SketchElement[] {
  const has = (id: string) => (selected instanceof Set ? selected.has(id) : !!selected[id]);
  const ids = new Set<string>();
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const el of elements) {
    if (el.isDeleted || !has(el.id)) continue;
    ids.add(el.id);
    for (const b of el.boundElements) if (b.type === 'text') ids.add(b.id);
    // a selected label implies its container
    if (el.type === 'text' && el.containerId && byId.get(el.containerId) && !byId.get(el.containerId)!.isDeleted)
      ids.add(el.containerId);
  }
  return elements.filter((e) => ids.has(e.id) && !e.isDeleted);
}

export const getSelected = (): SketchElement[] => {
  const s = useCanvasStore.getState();
  return live(s.elements).filter((e) => s.appState.selectedElementIds[e.id]);
};

export const getSelectedWithBound = (): SketchElement[] => {
  const s = useCanvasStore.getState();
  return withBoundText(s.elements, s.appState.selectedElementIds);
};

export const commonRect = (els: readonly SketchElement[]) => {
  const b = getCommonBounds(els as SketchElement[]);
  return b ? boundsToRect(b) : null;
};

export const boundsCenter = (b: Bounds) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

/** scene point at the center of the visible canvas */
export const viewportCenter = (a: Pick<AppState, 'scrollX' | 'scrollY' | 'zoom' | 'width' | 'height'>) =>
  screenToScene(a.width / 2, a.height / 2, a);

/**
 * The group a selected element "belongs to" at the current editing level:
 * the outermost group, or the group just inside editingGroupId. null if none.
 */
export const selectionGroupOf = (el: SketchElement, editingGroupId: string | null): string | null => {
  const g = el.groupIds;
  if (!g.length) return null;
  if (editingGroupId) {
    const i = g.indexOf(editingGroupId);
    if (i === -1) return g[g.length - 1];
    return i > 0 ? g[i - 1] : null;
  }
  return g[g.length - 1];
};

/**
 * Split elements into units that move together for align/distribute:
 * one unit per group (at the current editing level), bound text with its container.
 */
export function selectionUnits(els: readonly SketchElement[], editingGroupId: string | null): SketchElement[][] {
  const units = new Map<string, SketchElement[]>();
  const byId = new Map(els.map((e) => [e.id, e]));
  for (const el of els) {
    let key: string;
    const container = el.type === 'text' && el.containerId ? byId.get(el.containerId) : undefined;
    const owner = container ?? el;
    const g = selectionGroupOf(owner, editingGroupId);
    key = g ? `g:${g}` : `e:${owner.id}`;
    const arr = units.get(key);
    if (arr) arr.push(el);
    else units.set(key, [el]);
  }
  return [...units.values()];
}
