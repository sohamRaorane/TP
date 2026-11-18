import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseDiagram, layoutDiagram, assignLayers, orderLayers, insertDiagramFromText, outlinePoint, estimateText,
} from './textToDiagram';
import { resetStores } from '@/test/helpers';
import { useCanvasStore } from '@/store/canvasStore';
import { useHistoryStore } from '@/store/historyStore';
import type { LinearElement, TextElement } from '@/types/appState';

beforeEach(resetStores);

describe('parser', () => {
  it('parses header, shapes, edges, labels, chains and comments', () => {
    const d = parseDiagram(`graph LR
      %% a comment
      A[Start here] --> B(Rounded) --> C{Choice?}
      C -->|yes| D((Done)); C -- no --> E
      E --- A  %% trailing comment
      E -.-> F ==> G`);
    expect(d.direction).toBe('LR');
    expect(d.nodes.map((n) => [n.id, n.shape, n.label])).toEqual([
      ['A', 'rect', 'Start here'],
      ['B', 'round', 'Rounded'],
      ['C', 'diamond', 'Choice?'],
      ['D', 'circle', 'Done'],
      ['E', 'rect', 'E'],
      ['F', 'rect', 'F'],
      ['G', 'rect', 'G'],
    ]);
    expect(d.edges.map((e) => [e.from, e.to, e.kind, e.label])).toEqual([
      ['A', 'B', 'arrow', null],
      ['B', 'C', 'arrow', null],
      ['C', 'D', 'arrow', 'yes'],
      ['C', 'E', 'arrow', 'no'],
      ['E', 'A', 'open', null],
      ['E', 'F', 'dotted', null],
      ['F', 'G', 'thick', null],
    ]);
  });

  it('defaults to TD, supports flowchart TB and quoted labels with brackets', () => {
    const d = parseDiagram('flowchart TB\nA["x [1]"] --> B');
    expect(d.direction).toBe('TD');
    expect(d.nodes[0].label).toBe('x [1]');
    expect(parseDiagram('X-->Y').direction).toBe('TD');
  });

  it('later labeled definitions override bare references', () => {
    const d = parseDiagram('A --> B\nB{Is it?}');
    expect(d.nodes[1]).toEqual({ id: 'B', label: 'Is it?', shape: 'diamond' });
  });

  it('reports line-numbered errors', () => {
    expect(() => parseDiagram('graph TD\nA --> B\nA ->> C')).toThrow(/^Line 3: unexpected/);
    expect(() => parseDiagram('A[unclosed --> B')).toThrow(/Line 1: missing "\]"/);
    expect(() => parseDiagram('A -->')).toThrow(/Line 1: expected a node id/);
    expect(() => parseDiagram('A --> B\ngraph TD')).toThrow(/Line 2: .*header must be the first/);
    expect(() => parseDiagram('%% only comments')).toThrow(/No nodes found/);
    expect(() => parseDiagram('subgraph x')).toThrow(/Line 1: subgraphs are not supported/);
  });
});

describe('layout', () => {
  it('longest-path layering with cycles', () => {
    const layers = assignLayers(['A', 'B', 'C', 'D'], [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'A', to: 'C' }, { from: 'C', to: 'A' }, { from: 'C', to: 'D' },
    ]);
    expect(layers).toEqual({ A: 0, B: 1, C: 2, D: 3 });
  });

  it('barycenter ordering removes a crossing', () => {
    // A->D, B->C : initial order [C, D] crosses
    const ids = ['A', 'B', 'C', 'D'];
    const edges = [{ from: 'A', to: 'D' }, { from: 'B', to: 'C' }];
    const layers = orderLayers(['A', 'B', 'D', 'C'].filter((x) => ids.includes(x)), edges, { A: 0, B: 0, C: 1, D: 1 });
    expect(layers[1]).toEqual(['D', 'C']);
  });

  it('TD stacks layers vertically with 80 spacing, LR horizontally, BT reversed', () => {
    const d = parseDiagram('A --> B\nA --> C');
    const td = layoutDiagram(d);
    const { A, B, C } = td.boxes;
    expect(B.y).toBe(A.y + A.height + 80);
    expect(B.y).toBe(C.y);
    expect(C.x - (B.x + B.width)).toBe(80);
    // A centered over its layer
    expect(A.x + A.width / 2).toBeCloseTo(td.width / 2);
    const lr = layoutDiagram({ ...d, direction: 'LR' });
    expect(lr.boxes.B.x).toBe(lr.boxes.A.x + lr.boxes.A.width + 80);
    const bt = layoutDiagram({ ...d, direction: 'BT' });
    expect(bt.boxes.A.y).toBeGreaterThan(bt.boxes.B.y);
  });

  it('sizes nodes from labels (9px/char estimate)', () => {
    const d = parseDiagram('A[' + 'x'.repeat(20) + ']');
    expect(layoutDiagram(d).boxes.A.width).toBe(20 * 9 + 48);
    expect(estimateText('abc\nde')).toEqual({ width: 27, height: 50 });
  });

  it('outline points for each shape', () => {
    const c = { x: 0, y: 0 };
    expect(outlinePoint('rect', c, 50, 20, 0, 1)).toEqual({ x: 0, y: 28 });
    expect(outlinePoint('circle', c, 50, 50, 1, 0).x).toBeCloseTo(58);
    expect(outlinePoint('diamond', c, 50, 20, 1, 0).x).toBeCloseTo(58);
  });
});

describe('insertDiagramFromText', () => {
  it('creates bound labels, bound arrows and edge labels as one undo step', () => {
    insertDiagramFromText('A[One] -->|go| B{Two}');
    const s = useCanvasStore.getState();
    const els = s.elements;
    const shapes = els.filter((e) => e.type === 'rectangle' || e.type === 'diamond');
    const texts = els.filter((e): e is TextElement => e.type === 'text');
    const arrows = els.filter((e): e is LinearElement => e.type === 'arrow');
    expect(shapes).toHaveLength(2);
    expect(arrows).toHaveLength(1);
    expect(texts).toHaveLength(3);
    const [a, b] = shapes;
    const label = texts.find((t) => t.containerId === a.id)!;
    expect(label.text).toBe('One');
    expect(a.boundElements).toEqual([{ id: label.id, type: 'text' }, { id: arrows[0].id, type: 'arrow' }]);
    expect(arrows[0].startBinding).toEqual({ elementId: a.id, focus: 0, gap: 8 });
    expect(arrows[0].endBinding).toEqual({ elementId: b.id, focus: 0, gap: 8 });
    expect(b.boundElements.some((r) => r.id === arrows[0].id)).toBe(true);
    expect(texts.find((t) => t.text === 'go')!.containerId).toBeNull();
    // arrow starts below A and ends above B (TD)
    expect(arrows[0].y).toBeGreaterThan(a.y + a.height);
    expect(arrows[0].y + arrows[0].points[1][1]).toBeLessThan(b.y);
    // centered in viewport (1000x800 at zoom 1, scroll 0)
    const minX = Math.min(...shapes.map((e) => e.x)), maxX = Math.max(...shapes.map((e) => e.x + e.width));
    expect((minX + maxX) / 2).toBeCloseTo(500);
    // shapes + arrow + edge label (bound labels follow their containers)
    expect(Object.keys(s.appState.selectedElementIds)).toHaveLength(4);
    expect(useHistoryStore.getState().undoStack).toHaveLength(1);
  });

  it('throws parse errors and inserts nothing', () => {
    expect(() => insertDiagramFromText('A -> B')).toThrow(/Line 1/);
    expect(useCanvasStore.getState().elements).toHaveLength(0);
  });
});
