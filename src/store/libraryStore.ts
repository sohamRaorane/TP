// Personal shape library, persisted to localStorage ('sketchboard:library').
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type { SketchElement } from '@/types/appState';
import { elementSchema } from '@shared/schema';

export interface LibraryItem {
  id: string;
  name: string;
  elements: SketchElement[];
  created: number;
}

export interface LibraryState {
  items: LibraryItem[];
  add: (name: string, elements: SketchElement[]) => LibraryItem;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  clear: () => void;
}

export const LIBRARY_KEY = 'sketchboard:library';

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      items: [],
      add: (name, elements) => {
        const item: LibraryItem = { id: uuid(), name: name.trim() || 'Untitled item', elements, created: Date.now() };
        set((s) => ({ items: [item, ...s.items] }));
        return item;
      },
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      rename: (id, name) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, name } : i)) })),
      clear: () => set({ items: [] }),
    }),
    {
      name: LIBRARY_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ items: s.items }),
      // drop corrupted items instead of crashing on load
      merge: (persisted, current) => {
        const raw = (persisted as { items?: unknown } | undefined)?.items;
        const items: LibraryItem[] = [];
        if (Array.isArray(raw))
          for (const it of raw as Array<Partial<LibraryItem>>) {
            if (!it || typeof it.id !== 'string' || !Array.isArray(it.elements)) continue;
            const els = it.elements.filter((e) => elementSchema.safeParse(e).success);
            if (els.length) items.push({ id: it.id, name: String(it.name ?? 'Untitled item'), elements: els, created: Number(it.created) || 0 });
          }
        return { ...current, items };
      },
    },
  ),
);
