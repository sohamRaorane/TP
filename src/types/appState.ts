import type {
  Arrowhead,
  FillStyle,
  FontFamily,
  StrokeStyle,
  TextAlign,
} from '@shared/element';

export * from '@shared/element';

export type ToolType =
  | 'selection'
  | 'hand'
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'freedraw'
  | 'text'
  | 'image'
  | 'eraser'
  | 'laser'
  | 'frame';

export type DialogType =
  | 'export'
  | 'share'
  | 'help'
  | 'library'
  | 'commandPalette'
  | 'versions'
  | 'dashboard'
  | 'stats'
  | 'textToDiagram'
  | null;

export interface CurrentItemStyle {
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  opacity: number;
  roundness: boolean;
  fontSize: number;
  fontFamily: FontFamily;
  textAlign: TextAlign;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
}

export interface SceneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type SaveStatus = 'idle' | 'saved' | 'saving' | 'unsaved' | 'error' | 'offline';

export interface AppState {
  activeTool: ToolType;
  /** keep the tool active after drawing (lock icon / Q) */
  toolLocked: boolean;

  // viewport: screenX = (sceneX + scrollX) * zoom
  scrollX: number;
  scrollY: number;
  zoom: number;
  /** canvas size in CSS pixels */
  width: number;
  height: number;

  selectedElementIds: Record<string, true>;
  /** when double-clicking into a group, its id; selection then targets members */
  editingGroupId: string | null;
  editingTextId: string | null;
  /** linear element whose individual points are being edited */
  editingLinearId: string | null;
  hoveredElementId: string | null;

  currentItem: CurrentItemStyle;

  theme: 'light' | 'dark';
  viewBackgroundColor: string;
  gridEnabled: boolean;
  snapEnabled: boolean;
  zenMode: boolean;
  /** read-only (view-only share links, presentation mode) */
  viewModeEnabled: boolean;
  showMinimap: boolean;

  name: string;
  drawingId: string | null;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;

  openDialog: DialogType;
  contextMenu: { x: number; y: number; kind: 'element' | 'canvas' } | null;

  // transient render state (scene coords)
  selectionBox: SceneRect | null;
  snapLines: SnapLine[];
  eraserTrail: Array<[number, number]>;
  pendingEraseIds: Record<string, true>;

  presentation: { active: boolean; frameIndex: number };
  /** socket id of the collaborator whose viewport we follow */
  followingSocketId: string | null;

  toast: { message: string; kind: 'info' | 'error' | 'success' } | null;
}
