// Viewport helpers: zoom steps, fit to content / selection / frame.
import { useCanvasStore, selectors } from '@/store/canvasStore';
import { clampZoom, fitBounds, zoomAt } from '@/engine/coordinates';
import type { SceneRect } from '@/types/appState';
import { commonRect, getSelectedWithBound } from './scene';

export const ZOOM_STEP = 0.1;

const st = () => useCanvasStore.getState();

/** next zoom level: additive 10% steps snapped to the grid of steps */
export const stepZoom = (zoom: number, dir: 1 | -1) => {
  const snapped = Math.round(zoom / ZOOM_STEP) * ZOOM_STEP;
  const base = Math.abs(snapped - zoom) < 1e-6 ? zoom : dir > 0 ? Math.floor(zoom / ZOOM_STEP) * ZOOM_STEP : Math.ceil(zoom / ZOOM_STEP) * ZOOM_STEP;
  return clampZoom(Math.round((base + dir * ZOOM_STEP) * 100) / 100);
};

export function setZoomAroundCenter(nextZoom: number) {
  const a = st().appState;
  st().setAppState(zoomAt(a, nextZoom, a.width / 2, a.height / 2));
}

export const zoomIn = () => setZoomAroundCenter(stepZoom(st().appState.zoom, 1));
export const zoomOut = () => setZoomAroundCenter(stepZoom(st().appState.zoom, -1));
export const resetZoom = () => setZoomAroundCenter(1);

export function fitRect(rect: SceneRect | null, maxZoom = 1, padding = 60) {
  const a = st().appState;
  if (!rect) {
    st().setAppState({ scrollX: 0, scrollY: 0, zoom: 1 });
    return;
  }
  st().setAppState(fitBounds(rect, a.width, a.height, padding, maxZoom));
}

export const zoomToFit = () => fitRect(commonRect(selectors.visibleElements(st())), 1);

export function zoomToSelection() {
  const sel = getSelectedWithBound();
  if (!sel.length) return zoomToFit();
  fitRect(commonRect(sel), 3);
}
