// User-level actions. CONTRACT — Agent C implements. UI (Agent B), keyboard
// shortcuts, context menu and command palette ALL call these; never duplicate logic in components.
// Every action that changes elements must call useCanvasStore.getState().commit() once at the end.
const todo = (name: string) => () => { throw new Error(`${name}: implemented by state agent`); };

export const actions = {
  // selection & editing
  selectAll: todo('selectAll') as () => void,
  deleteSelected: todo('deleteSelected') as () => void,
  duplicateSelected: todo('duplicateSelected') as () => void,
  copy: todo('copy') as () => Promise<void>,
  cut: todo('cut') as () => Promise<void>,
  /** paste at scene point (defaults to viewport center); handles elements JSON, images, plain text */
  paste: todo('paste') as (at?: { x: number; y: number }) => Promise<void>,
  group: todo('group') as () => void,
  ungroup: todo('ungroup') as () => void,
  toggleLock: todo('toggleLock') as () => void,
  bringForward: todo('bringForward') as () => void,
  sendBackward: todo('sendBackward') as () => void,
  bringToFront: todo('bringToFront') as () => void,
  sendToBack: todo('sendToBack') as () => void,
  flip: todo('flip') as (axis: 'horizontal' | 'vertical') => void,
  align: todo('align') as (edge: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => void,
  distribute: todo('distribute') as (axis: 'horizontal' | 'vertical') => void,
  /** apply style to selection AND remember as currentItem default */
  setStyle: todo('setStyle') as (changes: Record<string, unknown>) => void,
  moveSelection: todo('moveSelection') as (dx: number, dy: number) => void,
  undo: todo('undo') as () => void,
  redo: todo('redo') as () => void,
  // viewport
  zoomIn: todo('zoomIn') as () => void,
  zoomOut: todo('zoomOut') as () => void,
  resetZoom: todo('resetZoom') as () => void,
  zoomToFit: todo('zoomToFit') as () => void,
  zoomToSelection: todo('zoomToSelection') as () => void,
  // document
  newDrawing: todo('newDrawing') as () => Promise<void>,
  clearCanvas: todo('clearCanvas') as () => void,
  saveNow: todo('saveNow') as () => Promise<void>,
  openDrawing: todo('openDrawing') as (id: string) => Promise<void>,
  rename: todo('rename') as (name: string) => Promise<void>,
  // import / export
  exportPNG: todo('exportPNG') as (opts: { scale: number; transparent: boolean; onlySelected: boolean; dark: boolean }) => Promise<void>,
  exportSVG: todo('exportSVG') as (opts: { transparent: boolean; onlySelected: boolean; dark: boolean }) => Promise<void>,
  exportJSON: todo('exportJSON') as () => void,
  copyAsPNG: todo('copyAsPNG') as () => Promise<void>,
  importFile: todo('importFile') as (file: File) => Promise<void>,
  insertImage: todo('insertImage') as (file: File, at?: { x: number; y: number }) => Promise<void>,
  // collaboration
  startCollaboration: todo('startCollaboration') as (mode?: 'edit' | 'view') => Promise<string>,
  stopCollaboration: todo('stopCollaboration') as () => void,
  followUser: todo('followUser') as (socketId: string | null) => void,
  // library
  addSelectionToLibrary: todo('addSelectionToLibrary') as () => void,
  insertLibraryItem: todo('insertLibraryItem') as (itemId: string, at?: { x: number; y: number }) => void,
  // presentation
  startPresentation: todo('startPresentation') as () => void,
  stopPresentation: todo('stopPresentation') as () => void,
  nextSlide: todo('nextSlide') as () => void,
  prevSlide: todo('prevSlide') as () => void,
};
export type Actions = typeof actions;
