// Engine-only transient render state that is not part of AppState
// (binding suggestions, shape-recognition preview, hovered point handles).
import type { RecognizedShape } from '@/engine/drawing/shapeRecognition';

export interface TransientState {
  /** element highlighted as an arrow binding target */
  suggestedBindingId: string | null;
  /** hold-to-snap preview (scene coords) */
  recognition: RecognizedShape | null;
  /** hovered linear point index / midpoint index (selection tool) */
  hoveredPoint: number;
  hoveredMidpoint: number;
  /** selected linear point indices (point editing) */
  selectedPoints: number[];
}

const state: TransientState = {
  suggestedBindingId: null,
  recognition: null,
  hoveredPoint: -1,
  hoveredMidpoint: -1,
  selectedPoints: [],
};

const listeners = new Set<() => void>();

export const transient = {
  get: (): Readonly<TransientState> => state,
  set(p: Partial<TransientState>) {
    let changed = false;
    for (const k of Object.keys(p) as (keyof TransientState)[]) {
      if (state[k] !== p[k]) {
        (state as unknown as Record<string, unknown>)[k] = p[k];
        changed = true;
      }
    }
    if (changed) listeners.forEach((l) => l());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
