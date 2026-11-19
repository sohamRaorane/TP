// World (scene) <-> screen coordinate system. CONTRACT.
//   screenX = (sceneX + scrollX) * zoom
//   sceneX  = screenX / zoom - scrollX
// screen coords are CSS pixels relative to the canvas top-left.

export interface ViewportLike {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export const sceneToScreen = (x: number, y: number, v: ViewportLike) => ({
  x: (x + v.scrollX) * v.zoom,
  y: (y + v.scrollY) * v.zoom,
});

export const screenToScene = (x: number, y: number, v: ViewportLike) => ({
  x: x / v.zoom - v.scrollX,
  y: y / v.zoom - v.scrollY,
});

/** new viewport after zooming to `nextZoom` while keeping screen point (sx, sy) fixed */
export const zoomAt = (v: ViewportLike, nextZoom: number, sx: number, sy: number): ViewportLike => {
  const zoom = clampZoom(nextZoom);
  const scene = screenToScene(sx, sy, v);
  return { zoom, scrollX: sx / zoom - scene.x, scrollY: sy / zoom - scene.y };
};

/** visible scene rectangle for a canvas of (width x height) CSS px */
export const visibleSceneBounds = (v: ViewportLike, width: number, height: number) => {
  const tl = screenToScene(0, 0, v);
  return { x: tl.x, y: tl.y, width: width / v.zoom, height: height / v.zoom };
};

/** viewport that fits `bounds` (scene) into width x height with padding (CSS px) */
export const fitBounds = (
  bounds: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
  padding = 60,
  maxZoom = 1,
): ViewportLike => {
  const bw = Math.max(bounds.width, 1);
  const bh = Math.max(bounds.height, 1);
  const zoom = clampZoom(Math.min((width - padding * 2) / bw, (height - padding * 2) / bh, maxZoom));
  const cx = bounds.x + bw / 2;
  const cy = bounds.y + bh / 2;
  return { zoom, scrollX: width / 2 / zoom - cx, scrollY: height / 2 / zoom - cy };
};
