// Element factories. CONTRACT: all element creation goes through these.
import { v4 as uuid } from 'uuid';
import type {
  CurrentItemStyle,
  FrameElement,
  FreedrawElement,
  GenericElement,
  ImageElement,
  LinearElement,
  TextElement,
} from '@/types/appState';
import { randomInt } from '@/store/canvasStore';

type BaseInit = { x: number; y: number; width?: number; height?: number; style: CurrentItemStyle };

const base = ({ x, y, width = 0, height = 0, style }: BaseInit) => ({
  id: uuid(),
  x,
  y,
  width,
  height,
  angle: 0,
  strokeColor: style.strokeColor,
  backgroundColor: style.backgroundColor,
  fillStyle: style.fillStyle,
  strokeWidth: style.strokeWidth,
  strokeStyle: style.strokeStyle,
  roughness: style.roughness,
  opacity: style.opacity,
  roundness: style.roundness,
  locked: false,
  groupIds: [] as string[],
  frameId: null,
  boundElements: [],
  link: null,
  seed: randomInt(),
  version: 1,
  versionNonce: randomInt(),
  isDeleted: false,
  updated: Date.now(),
});

export const newShape = (type: GenericElement['type'], init: BaseInit): GenericElement => ({
  ...base(init),
  type,
});

export const newLinear = (type: LinearElement['type'], init: BaseInit): LinearElement => ({
  ...base(init),
  type,
  points: [[0, 0]],
  startArrowhead: type === 'arrow' ? init.style.startArrowhead : null,
  endArrowhead: type === 'arrow' ? init.style.endArrowhead : null,
  startBinding: null,
  endBinding: null,
});

export const newFreedraw = (init: BaseInit, simulatePressure = true): FreedrawElement => ({
  ...base(init),
  type: 'freedraw',
  backgroundColor: 'transparent',
  points: [[0, 0]],
  pressures: [],
  simulatePressure,
});

export const newText = (
  init: BaseInit & { text?: string; containerId?: string | null },
): TextElement => ({
  ...base(init),
  type: 'text',
  backgroundColor: 'transparent',
  text: init.text ?? '',
  fontSize: init.style.fontSize,
  fontFamily: init.style.fontFamily,
  textAlign: init.containerId ? 'center' : init.style.textAlign,
  verticalAlign: init.containerId ? 'middle' : 'top',
  containerId: init.containerId ?? null,
  lineHeight: 1.25,
});

export const newImage = (init: BaseInit & { fileId: string }): ImageElement => ({
  ...base(init),
  type: 'image',
  backgroundColor: 'transparent',
  strokeColor: 'transparent',
  fileId: init.fileId,
  status: 'saved',
  scale: [1, 1],
});

export const newFrame = (init: BaseInit & { name?: string }): FrameElement => ({
  ...base(init),
  type: 'frame',
  strokeColor: '#bbb',
  backgroundColor: 'transparent',
  roughness: 0,
  strokeWidth: 1,
  fillStyle: 'solid',
  name: init.name ?? 'Frame',
});

/** deep clone with fresh ids (for duplicate/paste). Remaps groupIds & bindings within the set. */
export const cloneElements = <T extends { id: string; groupIds: string[] }>(
  els: T[],
  offset = { x: 10, y: 10 },
): T[] => {
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  els.forEach((e) => idMap.set(e.id, uuid()));
  return els.map((e) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = structuredClone(e) as any;
    c.id = idMap.get(e.id)!;
    c.x = (c.x as number) + offset.x;
    c.y = (c.y as number) + offset.y;
    c.groupIds = e.groupIds.map((g) => {
      if (!groupMap.has(g)) groupMap.set(g, uuid());
      return groupMap.get(g)!;
    });
    c.seed = randomInt();
    c.version = 1;
    c.versionNonce = randomInt();
    c.updated = Date.now();
    c.isDeleted = false;
    if (Array.isArray(c.boundElements))
      c.boundElements = c.boundElements
        .filter((b: { id: string }) => idMap.has(b.id))
        .map((b: { id: string; type: string }) => ({ ...b, id: idMap.get(b.id)! }));
    for (const k of ['startBinding', 'endBinding'] as const)
      if (c[k]) c[k] = idMap.has(c[k].elementId) ? { ...c[k], elementId: idMap.get(c[k].elementId) } : null;
    if (c.containerId) c.containerId = idMap.get(c.containerId) ?? null;
    if (c.frameId) c.frameId = idMap.get(c.frameId) ?? c.frameId;
    return c as T;
  });
};
