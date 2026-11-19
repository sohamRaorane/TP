// Tool interface. CONTRACT. The Canvas component owns pointer capture and
// converts DOM events into CanvasPointerEvent, then delegates to the active tool.
import type { ToolType } from '@/types/appState';

export interface CanvasPointerEvent {
  /** scene (world) coordinates */
  scene: { x: number; y: number };
  /** CSS px relative to canvas top-left */
  screen: { x: number; y: number };
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  /** ctrl on win/linux, cmd on mac */
  modKey: boolean;
  pressure: number;
  pointerType: 'mouse' | 'pen' | 'touch';
  /** ms timestamp */
  time: number;
  /** 1 for single, 2 for double click (from detail) */
  clickCount: number;
}

export interface ToolContext {
  /** ask the renderer to repaint on the next animation frame */
  requestRender: () => void;
  /** switch tool (e.g. back to selection after drawing unless toolLocked) */
  setTool: (tool: ToolType) => void;
  /** set the canvas CSS cursor */
  setCursor: (cursor: string) => void;
  /** open inline text editor for a text element */
  startTextEditing: (elementId: string) => void;
}

export interface Tool {
  type: ToolType;
  /** default CSS cursor while active */
  cursor: string;
  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void;
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void;
  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void;
  onDoubleClick?(e: CanvasPointerEvent, ctx: ToolContext): void;
  /** Escape / tool switch: abort any in-progress interaction */
  cancel?(ctx: ToolContext): void;
  /** true while a drag/draw is in progress (blocks shortcuts like tool switch) */
  isBusy?(): boolean;
}
