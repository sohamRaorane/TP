// Rendering public API. CONTRACT — Agent A implements; other agents only import these.
import type { BinaryFiles, SketchElement } from '@/types/appState';

export interface ExportOptions {
  /** pixel ratio for PNG (1, 2, 3) */
  scale: number;
  /** padding in scene units around content */
  padding: number;
  /** null = transparent */
  background: string | null;
  theme: 'light' | 'dark';
}

/** Render elements (already filtered to what should be exported) onto a new canvas sized to content. */
export function exportToCanvas(_els: SketchElement[], _files: BinaryFiles, _opts: ExportOptions): HTMLCanvasElement {
  throw new Error('exportToCanvas: implemented by engine agent');
}

/** Build a standalone SVG element (fonts embedded/referenced, images inlined). */
export function exportToSvg(_els: SketchElement[], _files: BinaryFiles, _opts: Omit<ExportOptions, 'scale'>): SVGSVGElement {
  throw new Error('exportToSvg: implemented by engine agent');
}
