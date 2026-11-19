// Shared e2e helpers. The app is driven through real user input; `window.__sketch`
// (dev only) is used for ASSERTIONS ONLY (plus explicit seeding in perf.spec).
import { expect, type Page, type Locator } from '@playwright/test';

export interface El {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  groupIds: string[];
  locked: boolean;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  roughness: number;
  opacity: number;
  text?: string;
  fontSize?: number;
  containerId?: string | null;
  boundElements: Array<{ id: string; type: string }>;
  points?: Array<[number, number]>;
}

export interface View {
  zoom: number;
  scrollX: number;
  scrollY: number;
  activeTool: string;
  toolLocked: boolean;
  selectedIds: string[];
  editingTextId: string | null;
  theme: string;
  drawingId: string | null;
  saveStatus: string;
  name: string;
  viewModeEnabled: boolean;
  showMinimap: boolean;
  openDialog: string | null;
  presentation: { active: boolean; frameIndex: number };
}

/** open the app and wait until the canvas and the dev assertion hook exist */
export async function openApp(page: Page, url = '/') {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as unknown as { __sketch?: unknown }).__sketch);
  await expect(page.getByTestId('canvas-interactive')).toBeVisible();
}

/** visible (non-deleted) elements in z-order */
export const els = (page: Page): Promise<El[]> =>
  page.evaluate(() => {
    const s = (window as any).__sketch.useCanvasStore.getState();
    return s.elements.filter((e: any) => !e.isDeleted);
  });

/** all elements including deleted tombstones */
export const allEls = (page: Page): Promise<El[]> =>
  page.evaluate(() => (window as any).__sketch.useCanvasStore.getState().elements);

export const view = (page: Page): Promise<View> =>
  page.evaluate(() => {
    const a = (window as any).__sketch.useCanvasStore.getState().appState;
    return {
      zoom: a.zoom,
      scrollX: a.scrollX,
      scrollY: a.scrollY,
      activeTool: a.activeTool,
      toolLocked: a.toolLocked,
      selectedIds: Object.keys(a.selectedElementIds),
      editingTextId: a.editingTextId,
      theme: a.theme,
      drawingId: a.drawingId,
      saveStatus: a.saveStatus,
      name: a.name,
      viewModeEnabled: a.viewModeEnabled,
      showMinimap: a.showMinimap,
      openDialog: a.openDialog,
      presentation: a.presentation,
    };
  });

export const history = (page: Page): Promise<{ undo: number; redo: number }> =>
  page.evaluate(() => {
    const h = (window as any).__sketch.useHistoryStore.getState();
    return { undo: h.undoStack?.length ?? -1, redo: h.redoStack?.length ?? -1 };
  });

export const typesOf = async (page: Page) => (await els(page)).map((e) => e.type);

/** scene -> page (client) coordinates (canvas is at the page origin) */
export async function toScreen(page: Page, x: number, y: number) {
  const v = await view(page);
  const box = (await page.getByTestId('canvas-interactive').boundingBox())!;
  return { x: box.x + (x + v.scrollX) * v.zoom, y: box.y + (y + v.scrollY) * v.zoom };
}

export async function toScene(page: Page, sx: number, sy: number) {
  const v = await view(page);
  const box = (await page.getByTestId('canvas-interactive').boundingBox())!;
  return { x: (sx - box.x) / v.zoom - v.scrollX, y: (sy - box.y) / v.zoom - v.scrollY };
}

export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { steps?: number; button?: 'left' | 'middle' | 'right' } = {},
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: opts.button ?? 'left' });
  await page.mouse.move(to.x, to.y, { steps: opts.steps ?? 8 });
  await page.mouse.up({ button: opts.button ?? 'left' });
}

/** draw a shape with a keyboard shortcut (or a toolbar test id) by dragging between screen points */
export async function drawWith(page: Page, key: string, x1: number, y1: number, x2: number, y2: number) {
  await pressKey(page, key);
  await drag(page, { x: x1, y: y1 }, { x: x2, y: y2 });
}

/** press a key with focus on the canvas area (not a toolbar button / input) */
export async function pressKey(page: Page, key: string) {
  await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body) a.blur();
  });
  await page.keyboard.press(key);
}

export const tool = (page: Page, type: string): Locator => page.getByTestId(`tool-${type}`);

export async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await drawWith(page, 'r', x1, y1, x2, y2);
  const all = await els(page);
  return all[all.length - 1];
}

/** handle centre for the single selected element (page coords), computed with the engine's own geometry */
export async function handlePos(page: Page, id: string, handle: string) {
  const p = await page.evaluate(
    async ([id, handle]) => {
      const mod = await import('/src/engine/transformations/handles.ts' as string);
      const s = (window as any).__sketch.useCanvasStore.getState();
      const a = s.appState;
      const h = mod.getTransformHandles(s.elementsById[id], a.zoom)[handle];
      return { x: (h.x + a.scrollX) * a.zoom, y: (h.y + a.scrollY) * a.zoom };
    },
    [id, handle] as const,
  );
  const box = (await page.getByTestId('canvas-interactive').boundingBox())!;
  return { x: box.x + p.x, y: box.y + p.y };
}

export async function elCenterScreen(page: Page, id: string) {
  const e = (await els(page)).find((x) => x.id === id)!;
  return toScreen(page, e.x + e.width / 2, e.y + e.height / 2);
}

/** a point on the left edge (stroke) of a box element, in page coords — hits transparent shapes */
export async function elEdgeScreen(page: Page, id: string) {
  const e = (await els(page)).find((x) => x.id === id)!;
  return toScreen(page, e.x, e.y + e.height / 2);
}

export const byId = async (page: Page, id: string) => (await allEls(page)).find((e) => e.id === id);

export const close = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

export const versionMap = async (page: Page) => {
  const m: Record<string, string> = {};
  for (const e of await allEls(page)) m[e.id] = `${e.version}:${e.isDeleted ? 'D' : 'L'}`;
  return m;
};

export const mod = 'Control';
