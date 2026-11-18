// Shared element model. Used by the client (engine, store, UI) and the server
// (validation, persistence, collaboration). CONTRACT: change only with care.

export type ElementType =
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'freedraw'
  | 'text'
  | 'image'
  | 'frame';

export type FillStyle = 'hachure' | 'cross-hatch' | 'solid' | 'zigzag';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type Arrowhead = 'arrow' | 'triangle' | 'dot' | 'bar' | null;
/** 1 = hand-drawn (Kalam), 2 = normal (sans), 3 = code (mono) */
export type FontFamily = 1 | 2 | 3;
export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type Point = [number, number];

export interface BoundElementRef {
  id: string;
  type: 'arrow' | 'text';
}

export interface PointBinding {
  elementId: string;
  /** -1..1, where along the target the arrow aims (0 = center) */
  focus: number;
  /** distance in scene units between arrow end and target outline */
  gap: number;
}

export interface BaseElement {
  id: string;
  type: ElementType;
  /** scene coordinates of the unrotated top-left corner */
  x: number;
  y: number;
  width: number;
  height: number;
  /** radians, clockwise, around the element center */
  angle: number;
  strokeColor: string;
  backgroundColor: string; // 'transparent' allowed
  fillStyle: FillStyle;
  strokeWidth: number; // 1 | 2 | 4 in the UI, any positive number allowed
  strokeStyle: StrokeStyle;
  roughness: number; // 0 architect, 1 artist, 2 cartoonist
  opacity: number; // 0..100
  roundness: boolean; // rounded corners (rect/diamond) / curved (line/arrow)
  locked: boolean;
  /** innermost group first, outermost last */
  groupIds: string[];
  frameId: string | null;
  boundElements: BoundElementRef[];
  link: string | null;
  /** rough.js seed so shapes look identical on every render/client */
  seed: number;
  /** incremented on every change; used for sync reconciliation */
  version: number;
  /** random int regenerated on every change; deterministic tiebreak */
  versionNonce: number;
  isDeleted: boolean;
  /** epoch ms of last change */
  updated: number;
}

export interface GenericElement extends BaseElement {
  type: 'rectangle' | 'diamond' | 'ellipse';
}

export interface LinearElement extends BaseElement {
  type: 'arrow' | 'line';
  /** relative to (x, y); first point is always [0, 0] */
  points: Point[];
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  startBinding: PointBinding | null;
  endBinding: PointBinding | null;
}

export interface FreedrawElement extends BaseElement {
  type: 'freedraw';
  /** relative to (x, y) */
  points: Point[];
  /** 0..1 per point, same length as points (empty if simulated) */
  pressures: number[];
  simulatePressure: boolean;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: FontFamily;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  /** id of the shape this text is bound inside (label), else null */
  containerId: string | null;
  lineHeight: number; // multiplier, e.g. 1.25
}

export interface ImageElement extends BaseElement {
  type: 'image';
  fileId: string;
  status: 'pending' | 'saved' | 'error';
  scale: [number, number]; // [-1|1, -1|1] for flips
}

export interface FrameElement extends BaseElement {
  type: 'frame';
  name: string;
}

export type SketchElement =
  | GenericElement
  | LinearElement
  | FreedrawElement
  | TextElement
  | ImageElement
  | FrameElement;

export interface BinaryFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
}

export type BinaryFiles = Record<string, BinaryFile>;

/** Persisted/exported document format (.sketchboard JSON) */
export interface SceneData {
  type: 'sketchboard';
  version: 1;
  source?: string;
  elements: SketchElement[];
  appState: {
    viewBackgroundColor?: string;
    gridEnabled?: boolean;
    theme?: 'light' | 'dark';
    name?: string;
  };
  files: BinaryFiles;
}

export const isLinear = (el: SketchElement): el is LinearElement =>
  el.type === 'arrow' || el.type === 'line';
export const isFreedraw = (el: SketchElement): el is FreedrawElement => el.type === 'freedraw';
export const isText = (el: SketchElement): el is TextElement => el.type === 'text';
export const isImage = (el: SketchElement): el is ImageElement => el.type === 'image';
export const isFrame = (el: SketchElement): el is FrameElement => el.type === 'frame';
export const isShape = (el: SketchElement): el is GenericElement =>
  el.type === 'rectangle' || el.type === 'diamond' || el.type === 'ellipse';
/** Shapes that arrows can bind to and that can hold a text label */
export const isBindable = (el: SketchElement) =>
  isShape(el) || el.type === 'text' || el.type === 'image' || el.type === 'frame';

/**
 * Sync reconciliation rule (used by client AND server):
 * the element with the higher version wins; on equal version the lower
 * versionNonce wins. Returns true if `incoming` should replace `local`.
 */
export const shouldAcceptRemote = (local: SketchElement | undefined, incoming: SketchElement) => {
  if (!local) return true;
  if (incoming.version > local.version) return true;
  if (incoming.version < local.version) return false;
  return incoming.versionNonce < local.versionNonce;
};
