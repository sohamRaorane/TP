import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore, defaultAppState } from '@/store/canvasStore';
import { useHistoryStore } from '@/store/historyStore';
import type { LinearElement, SketchElement, ToolType } from '@/types/appState';
import type { CanvasPointerEvent, ToolContext } from '@/tools/types';
import { getTool } from '@/tools';
import { transient } from '@/engine/state/transient';
import { getTransformHandles } from '@/engine/transformations/handles';
import { getElementCenter } from '@/engine/math';

const s = () => useCanvasStore.getState();
const live = () => s().elements.filter((e) => !e.isDeleted);
const undoCount = () => useHistoryStore.getState().undoStack.length;

const ctx: ToolContext = {
  requestRender: () => {},
  setTool: (t) => s().setAppState({ activeTool: t }),
  setCursor: () => {},
  startTextEditing: (id) => s().setAppState({ editingTextId: id }),
};

let t = 0;
const ev = (x: number, y: number, o: Partial<CanvasPointerEvent> = {}): CanvasPointerEvent => {
  const z = s().appState.zoom;
  return {
    scene: { x, y },
    screen: { x: x * z, y: y * z },
    button: 0,
    shiftKey: false,
    altKey: false,
    modKey: false,
    pressure: 0.5,
    pointerType: 'mouse',
    time: (t += 16),
    clickCount: 1,
    ...o,
  };
};

const drag = (tool: ToolType, x1: number, y1: number, x2: number, y2: number, o: Partial<CanvasPointerEvent> = {}) => {
  s().setAppState({ activeTool: tool });
  const tl = getTool(tool);
  tl.onPointerDown(ev(x1, y1, o), ctx);
  for (let i = 1; i <= 5; i++) tl.onPointerMove(ev(x1 + ((x2 - x1) * i) / 5, y1 + ((y2 - y1) * i) / 5, o), ctx);
  tl.onPointerUp(ev(x2, y2, o), ctx);
};

beforeEach(() => {
  s().replaceScene([]);
  s().setAppState({ ...defaultAppState(), width: 1000, height: 800, snapEnabled: false });
  transient.set({ suggestedBindingId: null, recognition: null, selectedPoints: [] });
});

describe('shape tools', () => {
  it('drag creates a rectangle, commits once, selects it and returns to selection', () => {
    drag('rectangle', 10, 20, 110, 70);
    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({ type: 'rectangle', x: 10, y: 20, width: 100, height: 50 });
    expect(undoCount()).toBe(1);
    expect(s().appState.activeTool).toBe('selection');
    expect(s().appState.selectedElementIds[live()[0].id]).toBe(true);
  });

  it('click without drag creates nothing', () => {
    s().setAppState({ activeTool: 'ellipse' });
    const tl = getTool('ellipse');
    tl.onPointerDown(ev(10, 10), ctx);
    tl.onPointerUp(ev(10, 10), ctx);
    expect(s().elements).toHaveLength(0);
    expect(undoCount()).toBe(0);
  });

  it('shift makes squares, alt draws from center, drawing up-left normalizes', () => {
    drag('rectangle', 100, 100, 150, 300, { shiftKey: true });
    expect(live()[0]).toMatchObject({ width: 200, height: 200 });
    drag('ellipse', 500, 500, 520, 530, { altKey: true });
    expect(live()[1]).toMatchObject({ x: 480, y: 470, width: 40, height: 60 });
    drag('diamond', 300, 300, 200, 250);
    expect(live()[2]).toMatchObject({ x: 200, y: 250, width: 100, height: 50 });
  });

  it('toolLocked keeps the tool active', () => {
    s().setAppState({ toolLocked: true });
    drag('rectangle', 0, 0, 50, 50);
    expect(s().appState.activeTool).toBe('rectangle');
  });

  it('frame adopts fully contained elements', () => {
    drag('rectangle', 20, 20, 60, 60);
    drag('frame', 0, 0, 200, 200);
    const [r, f] = live();
    expect(f.type).toBe('frame');
    expect(r.frameId).toBe(f.id);
  });
});

describe('selection tool', () => {
  const setup = () => {
    drag('rectangle', 0, 0, 100, 100);
    s().setSelection([]);
    return live()[0];
  };

  it('click selects (on stroke), click empty clears', () => {
    const r = setup();
    drag('selection', 0, 50, 0, 50);
    expect(s().appState.selectedElementIds[r.id]).toBe(true);
    drag('selection', 500, 500, 500, 500);
    expect(Object.keys(s().appState.selectedElementIds)).toHaveLength(0);
  });

  it('drag moves the element with exactly one commit', () => {
    const r = setup();
    const before = undoCount();
    drag('selection', 0, 50, 40, 80);
    const m = s().elementsById[r.id];
    expect(m.x).toBe(40);
    expect(m.y).toBe(30);
    expect(undoCount()).toBe(before + 1);
    s().undo();
    expect(s().elementsById[r.id].x).toBe(0);
  });

  it('alt+drag duplicates', () => {
    setup();
    drag('selection', 0, 50, 200, 50, { altKey: true });
    expect(live()).toHaveLength(2);
    expect(live().map((e) => e.x).sort((a, b) => a - b)).toEqual([0, 200]);
  });

  it('box select selects fully contained elements only and skips locked', () => {
    setup();
    drag('rectangle', 300, 300, 350, 350);
    drag('rectangle', 400, 0, 450, 50);
    s().updateElements({ [live()[2].id]: { locked: true } });
    s().setSelection([]);
    drag('selection', -10, -10, 500, 360);
    expect(Object.keys(s().appState.selectedElementIds)).toHaveLength(2);
    expect(s().appState.selectionBox).toBeNull();
  });

  it('locked elements cannot be clicked', () => {
    const r = setup();
    s().updateElements({ [r.id]: { locked: true } });
    drag('selection', 0, 50, 50, 50);
    expect(s().elementsById[r.id].x).toBe(0);
  });

  it('clicking a group member selects the whole group; double click enters it', () => {
    drag('rectangle', 0, 0, 100, 100);
    drag('rectangle', 200, 0, 300, 100);
    const [a, b] = live();
    s().updateElements({ [a.id]: { groupIds: ['g1'] }, [b.id]: { groupIds: ['g1'] } });
    s().setSelection([]);
    drag('selection', 0, 50, 0, 50);
    expect(Object.keys(s().appState.selectedElementIds).sort()).toEqual([a.id, b.id].sort());
    getTool('selection').onDoubleClick!(ev(0, 50), ctx);
    expect(s().appState.editingGroupId).toBe('g1');
    expect(Object.keys(s().appState.selectedElementIds)).toEqual([a.id]);
  });

  it('resize via se handle and rotation via handle commit once each', () => {
    const r = setup();
    s().setSelection([r.id]);
    const h = getTransformHandles(s().elementsById[r.id], 1);
    const before = undoCount();
    drag('selection', h.se!.x, h.se!.y, h.se!.x + 100, h.se!.y + 50);
    const rr = s().elementsById[r.id];
    expect(rr.width).toBeCloseTo(200, 0);
    expect(rr.height).toBeCloseTo(150, 0);
    expect(undoCount()).toBe(before + 1);
    const h2 = getTransformHandles(rr, 1);
    const c = getElementCenter(rr);
    drag('selection', h2.rotation!.x, h2.rotation!.y, c.x + 300, c.y);
    expect(s().elementsById[r.id].angle).toBeCloseTo(Math.PI / 2, 1);
    expect(undoCount()).toBe(before + 2);
  });

  it('double-click on a shape creates a bound label', () => {
    const r = setup();
    getTool('selection').onDoubleClick!(ev(50, 50), ctx);
    const id = s().appState.editingTextId!;
    const label = s().elementsById[id];
    expect(label.type === 'text' && label.containerId).toBe(r.id);
    expect(s().elementsById[r.id].boundElements.some((b) => b.id === id)).toBe(true);
  });

  it('moving a shape moves its bound arrow endpoint', () => {
    drag('rectangle', 0, 0, 100, 100);
    drag('rectangle', 400, 0, 500, 100);
    drag('arrow', 110, 50, 395, 50);
    const arrow = live()[2] as LinearElement;
    expect(arrow.startBinding?.elementId).toBe(live()[0].id);
    expect(arrow.endBinding?.elementId).toBe(live()[1].id);
    s().setSelection([]);
    drag('selection', 400, 50, 400, 250);
    const a2 = s().elementsById[arrow.id] as LinearElement;
    expect(a2.y + a2.points[a2.points.length - 1][1]).toBeGreaterThan(150);
  });
});

describe('linear tool', () => {
  it('click-click creates a multi-point line, Escape finishes', () => {
    s().setAppState({ activeTool: 'line' });
    const tl = getTool('line');
    for (const [x, y] of [[0, 0], [100, 0], [100, 100]]) {
      tl.onPointerDown(ev(x, y), ctx);
      tl.onPointerUp(ev(x, y), ctx);
      tl.onPointerMove(ev(x + 30, y + 30), ctx);
    }
    tl.cancel!(ctx);
    const l = live()[0] as LinearElement;
    expect(l.points).toEqual([[0, 0], [100, 0], [100, 100]]);
    expect(undoCount()).toBe(1);
    expect(s().appState.activeTool).toBe('selection');
  });

  it('shift snaps the angle to 15°', () => {
    drag('line', 0, 0, 100, 7, { shiftKey: true });
    const l = live()[0] as LinearElement;
    expect(l.points[1][1]).toBeCloseTo(0);
  });

  it('dragging a point of a selected line moves only that point', () => {
    drag('line', 0, 0, 100, 0);
    const l = live()[0];
    drag('selection', 100, 0, 150, 50);
    const n = s().elementsById[l.id] as LinearElement;
    expect(n.x).toBe(0);
    expect(n.points[1]).toEqual([150, 50]);
  });
});

describe('freedraw, eraser, text', () => {
  it('freedraw records points and stays active', () => {
    drag('freedraw', 0, 0, 100, 40);
    const f = live()[0];
    expect(f.type).toBe('freedraw');
    expect(f.type === 'freedraw' && f.points.length).toBeGreaterThan(3);
    expect(s().appState.activeTool).toBe('freedraw');
  });

  it('holding still converts the stroke into a recognized shape', () => {
    vi.useFakeTimers();
    s().setAppState({ activeTool: 'freedraw' });
    const tl = getTool('freedraw');
    tl.onPointerDown(ev(0, 0), ctx);
    for (let i = 1; i <= 30; i++) tl.onPointerMove(ev(i * 10, i * 3), ctx);
    vi.advanceTimersByTime(600);
    tl.onPointerUp(ev(300, 90), ctx);
    vi.useRealTimers();
    expect(live().map((e) => e.type)).toEqual(['line']);
  });

  it('eraser deletes touched elements with one commit', () => {
    drag('rectangle', 0, 0, 100, 100);
    drag('rectangle', 300, 0, 400, 100);
    const before = undoCount();
    drag('eraser', -20, 50, 20, 50);
    expect(live()).toHaveLength(1);
    expect(undoCount()).toBe(before + 1);
    expect(s().appState.eraserTrail).toEqual([]);
  });

  it('text tool creates an empty text element in editing mode', () => {
    s().setAppState({ activeTool: 'text' });
    getTool('text').onPointerDown(ev(50, 50), ctx);
    const id = s().appState.editingTextId!;
    expect(s().elementsById[id].type).toBe('text');
  });
});

void ({} as SketchElement);
