// Central scene store. CONTRACT for all agents.
//
// RULES
// 1. Elements are IMMUTABLE. Never mutate an element object; always go through
//    updateElements/addElements/etc. which create new objects and bump
//    version/versionNonce/updated (required for history diffing and sync).
// 2. During a drag/draw, call update actions freely (no history entry), then
//    call commit() exactly once when the interaction completes (pointerup).
// 3. Deleted elements stay in `elements` with isDeleted=true (needed for sync);
//    use selectors.visibleElements() for rendering/hit-testing.
// 4. Remote collaborator changes go through applyRemoteElements() only.
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  AppState,
  BinaryFiles,
  SketchElement,
} from '@/types/appState';
import { shouldAcceptRemote } from '@shared/element';
import { appendKey, repairIndices, sortByIndex } from '@shared/fractionalIndex';
import { useHistoryStore, type HistoryEntry } from './historyStore';

export const randomInt = () => Math.floor(Math.random() * 2 ** 31);

export const defaultAppState = (): AppState => ({
  activeTool: 'selection',
  toolLocked: false,
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  width: typeof window !== 'undefined' ? window.innerWidth : 1280,
  height: typeof window !== 'undefined' ? window.innerHeight : 800,
  selectedElementIds: {},
  editingGroupId: null,
  editingTextId: null,
  editingLinearId: null,
  hoveredElementId: null,
  currentItem: {
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'hachure',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    roundness: true,
    fontSize: 20,
    fontFamily: 1,
    textAlign: 'left',
    startArrowhead: null,
    endArrowhead: 'arrow',
  },
  theme: 'light',
  viewBackgroundColor: '#ffffff',
  gridEnabled: false,
  snapEnabled: true,
  zenMode: false,
  viewModeEnabled: false,
  showMinimap: false,
  name: 'Untitled drawing',
  drawingId: null,
  saveStatus: 'idle',
  lastSavedAt: null,
  openDialog: null,
  contextMenu: null,
  selectionBox: null,
  snapLines: [],
  eraserTrail: [],
  pendingEraseIds: {},
  presentation: { active: false, frameIndex: 0 },
  followingSocketId: null,
  toast: null,
});

export type ElementChanges = Partial<Omit<SketchElement, 'id' | 'type'>> & Record<string, unknown>;

export interface CanvasStore {
  elements: SketchElement[];
  /** id -> element, always in sync with `elements` */
  elementsById: Record<string, SketchElement>;
  files: BinaryFiles;
  appState: AppState;
  /** increments on every element change; renderer redraw trigger */
  sceneNonce: number;
  /** increments on local (non-remote) element changes; collaboration/autosave trigger */
  localNonce: number;

  addElements: (els: SketchElement[], opts?: { select?: boolean }) => void;
  /** shallow-merge changes into elements; bumps version unless bump=false */
  updateElements: (changes: Record<string, ElementChanges>, opts?: { bump?: boolean }) => void;
  updateElement: (id: string, changes: ElementChanges) => void;
  /** marks isDeleted, removes from selection, drops bound text, unbinds arrows */
  deleteElements: (ids: string[]) => void;
  /** replace whole scene (load/import). Resets history unless keepHistory */
  replaceScene: (els: SketchElement[], files?: BinaryFiles, opts?: { keepHistory?: boolean }) => void;
  reorder: (ids: string[], dir: 'forward' | 'backward' | 'front' | 'back') => void;
  applyRemoteElements: (els: SketchElement[]) => void;
  addFiles: (files: BinaryFiles, opts?: { remote?: boolean }) => void;

  setAppState: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
  setSelection: (ids: string[]) => void;

  /** close one logical user interaction as one history entry */
  commit: () => void;
  undo: () => void;
  redo: () => void;
}

const bumpEl = <T extends SketchElement>(el: T, changes: ElementChanges, bump = true): T =>
  ({
    ...el,
    ...changes,
    ...(bump
      ? { version: el.version + 1, versionNonce: randomInt(), updated: Date.now() }
      : {}),
  }) as T;

const indexById = (els: SketchElement[]) => {
  const m: Record<string, SketchElement> = {};
  for (const el of els) m[el.id] = el;
  return m;
};

const selectionList = (s: AppState) => Object.keys(s.selectedElementIds);

export const useCanvasStore = create<CanvasStore>()(
  subscribeWithSelector((set, get) => ({
    elements: [],
    elementsById: {},
    files: {},
    appState: defaultAppState(),
    sceneNonce: 0,
    localNonce: 0,

    addElements: (els, opts) => {
      if (!els.length) return;
      // new elements go on top: fresh z-order keys after the current topmost
      const cur = get().elements;
      let prev = cur.length ? cur[cur.length - 1].index : undefined;
      const keyed = els.map((el) => {
        prev = appendKey(prev);
        return { ...el, index: prev } as SketchElement;
      });
      els = keyed;
      const elements = [...cur, ...keyed];
      set((s) => ({
        elements,
        elementsById: indexById(elements),
        sceneNonce: s.sceneNonce + 1,
        localNonce: s.localNonce + 1,
        ...(opts?.select
          ? {
              appState: {
                ...s.appState,
                selectedElementIds: Object.fromEntries(els.map((e) => [e.id, true as const])),
              },
            }
          : {}),
      }));
    },

    updateElements: (changes, opts) => {
      const ids = Object.keys(changes);
      if (!ids.length) return;
      const bump = opts?.bump ?? true;
      const elements = get().elements.map((el) =>
        changes[el.id] ? bumpEl(el, changes[el.id], bump) : el,
      );
      set((s) => ({
        elements,
        elementsById: indexById(elements),
        sceneNonce: s.sceneNonce + 1,
        localNonce: s.localNonce + 1,
      }));
    },

    updateElement: (id, changes) => get().updateElements({ [id]: changes }),

    deleteElements: (ids) => {
      if (!ids.length) return;
      const del = new Set(ids);
      const { elementsById } = get();
      // also delete bound text labels of deleted containers
      for (const id of ids) {
        const el = elementsById[id];
        el?.boundElements.forEach((b) => b.type === 'text' && del.add(b.id));
      }
      const elements = get().elements.map((el) => {
        if (del.has(el.id) && !el.isDeleted) return bumpEl(el, { isDeleted: true });
        // unbind arrows pointing at deleted elements
        if ((el.type === 'arrow' || el.type === 'line') && !el.isDeleted) {
          const sb = el.startBinding && del.has(el.startBinding.elementId);
          const eb = el.endBinding && del.has(el.endBinding.elementId);
          if (sb || eb)
            return bumpEl(el, {
              ...(sb ? { startBinding: null } : {}),
              ...(eb ? { endBinding: null } : {}),
            });
        }
        if (el.boundElements.some((b) => del.has(b.id)))
          return bumpEl(el, { boundElements: el.boundElements.filter((b) => !del.has(b.id)) });
        return el;
      });
      set((s) => {
        const sel = { ...s.appState.selectedElementIds };
        del.forEach((id) => delete sel[id]);
        return {
          elements,
          elementsById: indexById(elements),
          sceneNonce: s.sceneNonce + 1,
          localNonce: s.localNonce + 1,
          appState: {
            ...s.appState,
            selectedElementIds: sel,
            editingTextId: del.has(s.appState.editingTextId ?? '') ? null : s.appState.editingTextId,
          },
        };
      });
    },

    replaceScene: (els, files, opts) => {
      const fixes = repairIndices(els);
      if (Object.keys(fixes).length) els = els.map((el) => (fixes[el.id] ? ({ ...el, index: fixes[el.id] } as SketchElement) : el));
      set((s) => ({
        elements: els,
        elementsById: indexById(els),
        files: files ?? s.files,
        sceneNonce: s.sceneNonce + 1,
        appState: { ...s.appState, selectedElementIds: {}, editingTextId: null, editingGroupId: null },
      }));
      if (opts?.keepHistory) get().commit();
      else useHistoryStore.getState().reset(els);
    },

    reorder: (ids, dir) => {
      const set_ = new Set(ids);
      // give moved elements new z-order keys between their new neighbours (synced to peers)
      const rekey = (order: SketchElement[], moved: Set<string>) => {
        const cleared = order.map((el) => (moved.has(el.id) ? { id: el.id } : el));
        const fixes = repairIndices(cleared);
        const changes: Record<string, ElementChanges> = {};
        for (const [id, index] of Object.entries(fixes)) changes[id] = { index };
        const byId = Object.fromEntries(order.map((el) => [el.id, el]));
        const next = order.map((el) => byId[el.id]);
        set((s) => ({ elements: next, elementsById: indexById(next), sceneNonce: s.sceneNonce + 1, localNonce: s.localNonce + 1 }));
        get().updateElements(changes);
      };
      const els = [...get().elements];
      if (dir === 'front' || dir === 'back') {
        const moving = els.filter((e) => set_.has(e.id));
        const rest = els.filter((e) => !set_.has(e.id));
        const next = dir === 'front' ? [...rest, ...moving] : [...moving, ...rest];
        rekey(next, set_);
        return;
      }
      if (dir === 'forward') {
        for (let i = els.length - 2; i >= 0; i--) {
          if (set_.has(els[i].id) && !set_.has(els[i + 1].id)) {
            // skip over deleted neighbours
            let j = i + 1;
            while (j < els.length - 1 && els[j].isDeleted) j++;
            const [m] = els.splice(i, 1);
            els.splice(j, 0, m);
          }
        }
      } else {
        for (let i = 1; i < els.length; i++) {
          if (set_.has(els[i].id) && !set_.has(els[i - 1].id)) {
            let j = i - 1;
            while (j > 0 && els[j].isDeleted) j--;
            const [m] = els.splice(i, 1);
            els.splice(j, 0, m);
          }
        }
      }
      rekey(els, set_);
    },

    applyRemoteElements: (incoming) => {
      if (!incoming.length) return;
      const { elementsById } = get();
      const accepted: Record<string, SketchElement> = {};
      for (const el of incoming) {
        if (shouldAcceptRemote(elementsById[el.id], el)) accepted[el.id] = el;
      }
      const ids = Object.keys(accepted);
      if (!ids.length) return;
      const elements = get().elements.map((el) => accepted[el.id] ?? el);
      const existing = new Set(elements.map((e) => e.id));
      for (const el of incoming) if (accepted[el.id] && !existing.has(el.id)) elements.push(el);
      const ordered = sortByIndex(elements);
      if (ordered !== elements) elements.splice(0, elements.length, ...ordered);
      set((s) => {
        const sel = { ...s.appState.selectedElementIds };
        let selChanged = false;
        for (const id of ids)
          if (accepted[id].isDeleted && sel[id]) {
            delete sel[id];
            selChanged = true;
          }
        return {
          elements,
          elementsById: indexById(elements),
          sceneNonce: s.sceneNonce + 1,
          ...(selChanged ? { appState: { ...s.appState, selectedElementIds: sel } } : {}),
        };
      });
      // remote changes are not undoable locally
      const h = useHistoryStore.getState();
      const baseline = { ...h.baseline };
      for (const id of ids) baseline[id] = accepted[id];
      useHistoryStore.setState({ baseline, baselineOrder: get().elements.map((e) => e.id) });
    },

    addFiles: (files) => set((s) => ({ files: { ...s.files, ...files }, sceneNonce: s.sceneNonce + 1 })),

    setAppState: (partial) =>
      set((s) => ({
        appState: { ...s.appState, ...(typeof partial === 'function' ? partial(s.appState) : partial) },
      })),

    setSelection: (ids) =>
      set((s) => ({
        appState: {
          ...s.appState,
          selectedElementIds: Object.fromEntries(ids.map((id) => [id, true as const])),
        },
      })),

    commit: () => {
      const { elements, appState } = get();
      useHistoryStore.getState().record(elements, selectionList(appState));
    },

    undo: () => applyHistory(get, set, useHistoryStore.getState().popUndo(), 'undo'),
    redo: () => applyHistory(get, set, useHistoryStore.getState().popRedo(), 'redo'),
  })),
);

function applyHistory(
  get: () => CanvasStore,
  set: (p: Partial<CanvasStore> | ((s: CanvasStore) => Partial<CanvasStore>)) => void,
  entry: HistoryEntry | undefined,
  dir: 'undo' | 'redo',
) {
  if (!entry) return;
  const current = get().elementsById;
  const target: Record<string, SketchElement> = {};
  for (const [id, ch] of Object.entries(entry.changes)) {
    const want = dir === 'undo' ? ch.before : ch.after;
    const cur = current[id];
    const base = want ?? (cur ? { ...cur, isDeleted: true } : null);
    if (!base) continue;
    // version must exceed the current one so collaborators accept it
    target[id] = {
      ...base,
      version: Math.max(cur?.version ?? 0, base.version) + 1,
      versionNonce: randomInt(),
      updated: Date.now(),
    } as SketchElement;
  }
  let elements = get().elements.map((el) => target[el.id] ?? el);
  const present = new Set(elements.map((e) => e.id));
  for (const el of Object.values(target)) if (!present.has(el.id)) elements.push(el);
  const order = dir === 'undo' ? entry.orderBefore : entry.orderAfter;
  if (order) {
    const pos = new Map(order.map((id, i) => [id, i]));
    elements = [...elements].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }
  // restored elements carry their old z-order keys; keys are authoritative
  elements = sortByIndex(elements);
  const sel = dir === 'undo' ? entry.selectionBefore : entry.selectionAfter;
  const byId = indexById(elements);
  set((s) => ({
    elements,
    elementsById: byId,
    sceneNonce: s.sceneNonce + 1,
    localNonce: s.localNonce + 1,
    appState: {
      ...s.appState,
      editingTextId: null,
      selectedElementIds: Object.fromEntries(
        sel.filter((id) => byId[id] && !byId[id].isDeleted).map((id) => [id, true as const]),
      ),
    },
  }));
  useHistoryStore.getState().absorb(elements);
  useHistoryStore.setState({ baselineSelection: sel });
}

// ---------------------------------------------------------------- selectors
export const selectors = {
  visibleElements: (s: CanvasStore) => s.elements.filter((e) => !e.isDeleted),
  selectedElements: (s: CanvasStore) =>
    s.elements.filter((e) => !e.isDeleted && s.appState.selectedElementIds[e.id]),
};

/** non-React access helpers for engine/tools */
export const getScene = () => useCanvasStore.getState();
