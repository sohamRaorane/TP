// Element edits the `actions` contract does not cover yet (link, numeric
// geometry from the stats panel). They prefer an action if C adds one, else go
// through the store's update API and close the interaction with commit().
import { actions } from '@/services/actions';
import { useCanvasStore, type ElementChanges } from '@/store/canvasStore';
import type { Point, SketchElement } from '@/types/appState';

type MaybeActions = typeof actions & {
  setLink?: (link: string | null) => void;
  updateGeometry?: (id: string, changes: Partial<Pick<SketchElement, 'x' | 'y' | 'width' | 'height' | 'angle'>>) => void;
};

export function setElementLink(ids: string[], link: string | null) {
  const a = actions as MaybeActions;
  if (a.setLink) return a.setLink(link);
  const s = useCanvasStore.getState();
  s.updateElements(Object.fromEntries(ids.map((id) => [id, { link }])));
  s.commit();
}

/** Apply x/y/width/height/angle edits; scales points of linear/freedraw elements. */
export function setElementGeometry(el: SketchElement, changes: Partial<Pick<SketchElement, 'x' | 'y' | 'width' | 'height' | 'angle'>>) {
  const a = actions as MaybeActions;
  if (a.updateGeometry) return a.updateGeometry(el.id, changes);
  const patch: ElementChanges = { ...changes };
  if ('points' in el && (changes.width !== undefined || changes.height !== undefined)) {
    const sx = changes.width !== undefined && el.width ? changes.width / el.width : 1;
    const sy = changes.height !== undefined && el.height ? changes.height / el.height : 1;
    patch.points = el.points.map(([x, y]) => [x * sx, y * sy] as Point);
  }
  const s = useCanvasStore.getState();
  s.updateElement(el.id, patch);
  s.commit();
}
