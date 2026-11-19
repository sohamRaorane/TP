// Optional integration points built by other agents (C: hooks/services/library,
// A: minimap). They may not exist on this branch yet, so they are loaded through
// import.meta.glob: a missing file yields an empty map instead of a build error.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { SketchElement } from '@/types/appState';

type Loader = () => Promise<unknown>;

const modules: Record<string, Loader> = {
  ...import.meta.glob('/src/hooks/useKeyboardShortcuts.ts'),
  ...import.meta.glob('/src/services/persistence.ts'),
  ...import.meta.glob('/src/services/api.ts'),
  ...import.meta.glob('/src/services/textToDiagram.ts'),
  ...import.meta.glob('/src/store/libraryStore.ts'),
  ...import.meta.glob('/src/engine/rendering/minimap.ts'),
};

const cache = new Map<string, Promise<unknown>>();

export function loadOptional<T>(path: string): Promise<T | null> {
  const loader = modules[path];
  if (!loader) return Promise.resolve(null);
  if (!cache.has(path)) cache.set(path, loader().catch((e: unknown) => { console.warn(`[sketchboard] failed to load ${path}`, e); return null; }));
  return cache.get(path)! as Promise<T | null>;
}

export const hasOptional = (path: string) => path in modules;

/** React hook: resolves an optional module (null while loading or when absent). */
export function useOptionalModule<T>(path: string): T | null {
  const [mod, setMod] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    void loadOptional<T>(path).then((m) => alive && setMod(() => m));
    return () => { alive = false; };
  }, [path]);
  return mod;
}

// ---------------------------------------------------------------- C: hooks/services
export interface KeyboardModule { useKeyboardShortcuts: () => void }
export interface PersistenceModule { initPersistence: () => () => void }
export interface TextToDiagramModule { insertDiagramFromText: (text: string) => unknown }

export const PATHS = {
  keyboard: '/src/hooks/useKeyboardShortcuts.ts',
  persistence: '/src/services/persistence.ts',
  api: '/src/services/api.ts',
  textToDiagram: '/src/services/textToDiagram.ts',
  library: '/src/store/libraryStore.ts',
  minimap: '/src/engine/rendering/minimap.ts',
} as const;

// ---------------------------------------------------------------- C: library store
export interface LibraryItem { id: string; name: string; elements: SketchElement[]; created: number }
interface LibraryState { items: LibraryItem[]; remove?: (id: string) => void }
interface LibraryStoreApi {
  getState: () => LibraryState;
  subscribe: (listener: () => void) => () => void;
}
interface LibraryModule { useLibraryStore: LibraryStoreApi }

const EMPTY: LibraryItem[] = [];
const noopSubscribe = () => () => {};

/** Library items from C's store (empty until it exists). */
export function useLibrary(): { available: boolean; items: LibraryItem[]; remove: (id: string) => void } {
  const mod = useOptionalModule<LibraryModule>(PATHS.library);
  const store = mod?.useLibraryStore ?? null;
  const items = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    () => (store ? store.getState().items : EMPTY),
  );
  return {
    available: !!store,
    items,
    remove: (id) => store?.getState().remove?.(id),
  };
}

// ---------------------------------------------------------------- A: minimap
/**
 * Expected (requested from A): draws elements into ctx using a precomputed
 * scene->minimap mapping. Sketchboard's minimap UI draws the background and the
 * viewport rect itself and falls back to simple bounding boxes.
 */
export interface MinimapModule {
  renderMinimap: (
    ctx: CanvasRenderingContext2D,
    els: SketchElement[],
    map: { scale: number; offsetX: number; offsetY: number; theme: 'light' | 'dark' },
  ) => void;
}
