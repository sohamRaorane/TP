// Delta-based undo/redo. Each entry stores only the elements that changed in
// one completed user interaction (before/after references). Elements are
// immutable objects, so diffing is a cheap reference comparison.
import { create } from 'zustand';
import type { SketchElement } from '@/types/appState';

export interface HistoryChange {
  before: SketchElement | null;
  after: SketchElement | null;
}

export interface HistoryEntry {
  changes: Record<string, HistoryChange>;
  /** element order (ids) before and after, only when z-order changed */
  orderBefore?: string[];
  orderAfter?: string[];
  selectionBefore: string[];
  selectionAfter: string[];
}

interface HistoryState {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  /** last committed elements by id, plus order */
  baseline: Record<string, SketchElement>;
  baselineOrder: string[];
  baselineSelection: string[];
  limit: number;
  canUndo: boolean;
  canRedo: boolean;
  reset: (elements: SketchElement[], selection?: string[]) => void;
  /** diff current scene against baseline; push an entry if anything changed */
  record: (elements: SketchElement[], selection: string[]) => boolean;
  /** absorb remote/non-undoable changes into baseline without an entry */
  absorb: (elements: SketchElement[]) => void;
  popUndo: () => HistoryEntry | undefined;
  popRedo: () => HistoryEntry | undefined;
}

const toMap = (els: SketchElement[]) => {
  const m: Record<string, SketchElement> = {};
  for (const el of els) m[el.id] = el;
  return m;
};

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

export const useHistoryStore = create<HistoryState>((set, get) => ({
  undoStack: [],
  redoStack: [],
  baseline: {},
  baselineOrder: [],
  baselineSelection: [],
  limit: 200,
  canUndo: false,
  canRedo: false,

  reset: (elements, selection = []) =>
    set({
      undoStack: [],
      redoStack: [],
      baseline: toMap(elements),
      baselineOrder: elements.map((e) => e.id),
      baselineSelection: selection,
      canUndo: false,
      canRedo: false,
    }),

  record: (elements, selection) => {
    const { baseline, baselineOrder, baselineSelection, undoStack, limit } = get();
    const changes: Record<string, HistoryChange> = {};
    let changed = false;
    const seen = new Set<string>();
    for (const el of elements) {
      seen.add(el.id);
      const prev = baseline[el.id];
      if (prev !== el) {
        // ignore pure version/nonce churn with no semantic difference? keep simple: any new ref counts
        changes[el.id] = { before: prev ?? null, after: el };
        changed = true;
      }
    }
    for (const id of Object.keys(baseline)) {
      if (!seen.has(id)) {
        changes[id] = { before: baseline[id], after: null };
        changed = true;
      }
    }
    const order = elements.map((e) => e.id);
    const orderChanged = !sameOrder(order, baselineOrder);
    if (!changed && !orderChanged) {
      set({ baselineSelection: selection });
      return false;
    }
    const entry: HistoryEntry = {
      changes,
      selectionBefore: baselineSelection,
      selectionAfter: selection,
      ...(orderChanged ? { orderBefore: baselineOrder, orderAfter: order } : {}),
    };
    const stack = [...undoStack, entry];
    if (stack.length > limit) stack.shift();
    set({
      undoStack: stack,
      redoStack: [],
      baseline: toMap(elements),
      baselineOrder: order,
      baselineSelection: selection,
      canUndo: true,
      canRedo: false,
    });
    return true;
  },

  absorb: (elements) =>
    set({ baseline: toMap(elements), baselineOrder: elements.map((e) => e.id) }),

  popUndo: () => {
    const { undoStack, redoStack } = get();
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return undefined;
    const u = undoStack.slice(0, -1);
    const r = [...redoStack, entry];
    set({ undoStack: u, redoStack: r, canUndo: u.length > 0, canRedo: true });
    return entry;
  },

  popRedo: () => {
    const { undoStack, redoStack } = get();
    const entry = redoStack[redoStack.length - 1];
    if (!entry) return undefined;
    const r = redoStack.slice(0, -1);
    const u = [...undoStack, entry];
    set({ undoStack: u, redoStack: r, canUndo: true, canRedo: r.length > 0 });
    return entry;
  },
}));
