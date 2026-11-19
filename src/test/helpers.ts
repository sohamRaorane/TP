// Shared test helpers (state agent).
import { useCanvasStore, defaultAppState } from '@/store/canvasStore';
import { useHistoryStore } from '@/store/historyStore';
import { newShape, newText, newLinear } from '@/engine/drawing/newElement';
import type { GenericElement, LinearElement, SketchElement, TextElement } from '@/types/appState';

export const resetStores = () => {
  useCanvasStore.setState({
    elements: [],
    elementsById: {},
    files: {},
    appState: { ...defaultAppState(), width: 1000, height: 800 },
    sceneNonce: 0,
    localNonce: 0,
  });
  useHistoryStore.getState().reset([]);
};

const style = () => useCanvasStore.getState().appState.currentItem;

export const rect = (x: number, y: number, w = 100, h = 50, extra: Partial<GenericElement> = {}): GenericElement => ({
  ...newShape('rectangle', { x, y, width: w, height: h, style: style() }),
  ...extra,
});

export const text = (x: number, y: number, t = 'hi', extra: Partial<TextElement> = {}): TextElement => ({
  ...newText({ x, y, width: 20, height: 25, style: style(), text: t }),
  ...extra,
});

export const arrow = (x: number, y: number, dx: number, dy: number, extra: Partial<LinearElement> = {}): LinearElement => ({
  ...newLinear('arrow', { x, y, style: style() }),
  points: [[0, 0], [dx, dy]],
  width: Math.abs(dx),
  height: Math.abs(dy),
  ...extra,
});

/** add elements as a committed user action */
export const addCommitted = (...els: SketchElement[]) => {
  const s = useCanvasStore.getState();
  s.addElements(els);
  s.commit();
  return els;
};

export const select = (...ids: string[]) => useCanvasStore.getState().setSelection(ids);
export const get = (id: string) => useCanvasStore.getState().elementsById[id];
export const undoDepth = () => useHistoryStore.getState().undoStack.length;
