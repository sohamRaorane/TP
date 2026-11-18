// Small PNG previews for the dashboard / server thumbnails.
import type { BinaryFiles, SketchElement } from '@/types/appState';
import { exportBounds, exportToCanvas } from './index';

export const THUMBNAIL_MAX = 320;

/** PNG data URL, longest side <= 320px. Empty scenes give a blank white thumbnail. */
export function renderThumbnail(els: SketchElement[], files: BinaryFiles): string {
  try {
    const live = els.filter((e) => !e.isDeleted);
    const padding = 16;
    if (!live.length) {
      const c = document.createElement('canvas');
      c.width = THUMBNAIL_MAX;
      c.height = Math.round(THUMBNAIL_MAX * 0.625);
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
      }
      return c.toDataURL('image/png');
    }
    const b = exportBounds(live);
    const w = b.maxX - b.minX + padding * 2;
    const h = b.maxY - b.minY + padding * 2;
    const scale = Math.min(1, THUMBNAIL_MAX / Math.max(w, h, 1));
    const canvas = exportToCanvas(live, files, { scale, padding, background: '#ffffff', theme: 'light' });
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}
