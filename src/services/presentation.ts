// Presentation mode: step through frames (ordered by x, then y).
import { useCanvasStore, selectors } from '@/store/canvasStore';
import type { FrameElement, SketchElement } from '@/types/appState';
import { fitRect } from './viewport';
import { toast } from '@/utils/toast';

const st = () => useCanvasStore.getState();
let prevViewMode = false;
let prevZoom = 1;

export const orderFrames = (els: readonly SketchElement[]): FrameElement[] =>
  els
    .filter((e): e is FrameElement => e.type === 'frame' && !e.isDeleted)
    .sort((a, b) => a.x - b.x || a.y - b.y);

const frames = () => orderFrames(selectors.visibleElements(st()));

function showFrame(index: number) {
  const list = frames();
  if (!list.length) return stopPresentation();
  const i = Math.max(0, Math.min(list.length - 1, index));
  const f = list[i];
  st().setAppState({ presentation: { active: true, frameIndex: i } });
  fitRect({ x: f.x, y: f.y, width: f.width, height: f.height }, 10, 24);
}

export function startPresentation() {
  if (!frames().length) {
    toast('Add frames (F) to present', 'info');
    return;
  }
  const a = st().appState;
  if (!a.presentation.active) {
    prevViewMode = a.viewModeEnabled;
    prevZoom = a.zoom;
  }
  st().setAppState({
    viewModeEnabled: true,
    selectedElementIds: {},
    editingTextId: null,
    editingLinearId: null,
    openDialog: null,
    contextMenu: null,
  });
  showFrame(0);
}

export function stopPresentation() {
  if (!st().appState.presentation.active) return;
  st().setAppState({ presentation: { active: false, frameIndex: 0 }, viewModeEnabled: prevViewMode, zoom: prevZoom });
}

export const nextSlide = () => {
  const a = st().appState;
  if (a.presentation.active) showFrame(a.presentation.frameIndex + 1);
};
export const prevSlide = () => {
  const a = st().appState;
  if (a.presentation.active) showFrame(a.presentation.frameIndex - 1);
};
export const slideCount = () => frames().length;
