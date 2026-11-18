// Hit testing public API. CONTRACT — Agent A implements.
import type { SketchElement } from '@/types/appState';

/** topmost non-deleted element under scene point; tolerance in scene units (use ~10/zoom) */
export function getElementAtPoint(_x: number, _y: number, _elements: SketchElement[], _tolerance: number): SketchElement | null {
  throw new Error('getElementAtPoint: implemented by engine agent');
}

/** elements fully inside the scene rect */
export function getElementsInRect(_rect: { x: number; y: number; width: number; height: number }, _elements: SketchElement[]): SketchElement[] {
  throw new Error('getElementsInRect: implemented by engine agent');
}
