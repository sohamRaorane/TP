// Text -> diagram: a Mermaid-like flowchart subset, laid out in layers.
//
//   graph TD | graph LR | flowchart TB | flowchart RL | graph BT   (optional header)
//   A[Rectangle]  B(Rounded)  C{Diamond}  D((Circle))  E            (nodes)
//   A --> B   A --- B   A -.-> B   A ==> B   A -->|label| B   A -- label --> B
//   A --> B --> C   ;-separated statements   %% comments
import { v4 as uuid } from 'uuid';
import type { LinearElement, PointBinding, SketchElement, TextElement, GenericElement, CurrentItemStyle } from '@/types/appState';
import { newLinear, newShape, newText } from '@/engine/drawing/newElement';
import { useCanvasStore } from '@/store/canvasStore';
import { measureText } from '@/utils/textMeasure';
import { viewportCenter } from './scene';

export type Direction = 'TD' | 'LR' | 'BT' | 'RL';
export type NodeShape = 'rect' | 'round' | 'diamond' | 'circle';
export type EdgeKind = 'arrow' | 'open' | 'dotted' | 'thick';

export interface DiagramNode {
  id: string;
  label: string;
  shape: NodeShape;
}
export interface DiagramEdge {
  from: string;
  to: string;
  label: string | null;
  kind: EdgeKind;
  line: number;
}
export interface ParsedDiagram {
  direction: Direction;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

const SHAPES: Array<{ open: string; close: string; shape: NodeShape }> = [
  { open: '((', close: '))', shape: 'circle' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'round' },
  { open: '{', close: '}', shape: 'diamond' },
];

const IGNORED = /^(classDef|class|style|linkStyle|click)\b/;

class ParseError extends Error {}
const fail = (line: number, msg: string): never => {
  throw new ParseError(`Line ${line}: ${msg}`);
};

const unquote = (s: string) => {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
};

/** split a line on ';' outside brackets / quotes / pipes */
function splitStatements(line: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = false, pipe = false, cur = '';
  for (const ch of line) {
    if (ch === '"') quote = !quote;
    else if (!quote && ch === '|') pipe = !pipe;
    else if (!quote && !pipe && '[({'.includes(ch)) depth++;
    else if (!quote && !pipe && '])}'.includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0 && !quote && !pipe) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const EDGE_PATTERNS: Array<{ re: RegExp; kind: EdgeKind; labelGroup?: number }> = [
  // -- label -->   -- label ---
  { re: /^--\s+(.+?)\s+(-->|---)/, kind: 'arrow', labelGroup: 1 },
  { re: /^-\.\s+(.+?)\s+\.->/, kind: 'dotted', labelGroup: 1 },
  { re: /^==\s+(.+?)\s+==>/, kind: 'thick', labelGroup: 1 },
  { re: /^-\.->/, kind: 'dotted' },
  { re: /^-\.-/, kind: 'dotted' },
  { re: /^==>/, kind: 'thick' },
  { re: /^===/, kind: 'thick' },
  { re: /^-->/, kind: 'arrow' },
  { re: /^---/, kind: 'open' },
];

export function parseDiagram(text: string): ParsedDiagram {
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  let direction: Direction = 'TD';
  let sawStatement = false;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const commentAt = rawLine.indexOf('%%');
    const line = commentAt >= 0 ? rawLine.slice(0, commentAt) : rawLine;
    for (const stmtRaw of splitStatements(line)) {
      const stmt = stmtRaw.trim();
      if (!stmt) continue;
      const header = /^(graph|flowchart)(?:\s+(TD|TB|LR|RL|BT))?$/i.exec(stmt);
      if (header) {
        if (sawStatement) fail(lineNo, `"${header[1]}" header must be the first statement`);
        const d = (header[2] ?? 'TD').toUpperCase();
        direction = d === 'TB' ? 'TD' : (d as Direction);
        sawStatement = true;
        continue;
      }
      sawStatement = true;
      if (IGNORED.test(stmt)) continue;
      if (/^(subgraph|end)\b/.test(stmt)) fail(lineNo, 'subgraphs are not supported');
      parseStatement(stmt, lineNo, nodes, edges);
    }
  });
  if (!nodes.size) throw new ParseError('No nodes found. Example: "graph TD; A[Start] --> B{Decision?}"');
  return { direction, nodes: [...nodes.values()], edges };
}

function parseStatement(stmt: string, lineNo: number, nodes: Map<string, DiagramNode>, edges: DiagramEdge[]) {
  let pos = 0;
  const skipWs = () => {
    while (pos < stmt.length && /\s/.test(stmt[pos])) pos++;
  };
  const readNode = (): string => {
    skipWs();
    const m = /^[\p{L}\p{N}_][\p{L}\p{N}_.]*/u.exec(stmt.slice(pos));
    if (!m) fail(lineNo, `expected a node id at "${stmt.slice(pos, pos + 15) || 'end of line'}"`);
    // ids may contain '-' only when not starting an edge, e.g. "my-node"
    let id = m![0];
    pos += id.length;
    while (stmt[pos] === '-' && /^-[\p{L}\p{N}_]/u.test(stmt.slice(pos))) {
      const more = /^-[\p{L}\p{N}_]+/u.exec(stmt.slice(pos))![0];
      id += more;
      pos += more.length;
    }
    let label: string | null = null;
    let shape: NodeShape = 'rect';
    for (const s of SHAPES) {
      if (stmt.startsWith(s.open, pos)) {
        const start = pos + s.open.length;
        const end = findClose(stmt, start, s.close);
        if (end < 0) fail(lineNo, `missing "${s.close}" for node "${id}"`);
        label = unquote(stmt.slice(start, end)).replace(/<br\s*\/?>/gi, '\n');
        shape = s.shape;
        pos = end + s.close.length;
        break;
      }
    }
    const existing = nodes.get(id);
    if (!existing) nodes.set(id, { id, label: label ?? id, shape });
    else if (label !== null) nodes.set(id, { id, label, shape });
    return id;
  };
  const readEdge = (): { kind: EdgeKind; label: string | null } | null => {
    skipWs();
    if (pos >= stmt.length) return null;
    const rest = stmt.slice(pos);
    for (const p of EDGE_PATTERNS) {
      const m = p.re.exec(rest);
      if (!m) continue;
      pos += m[0].length;
      let label = p.labelGroup ? unquote(m[p.labelGroup]) : null;
      let kind = p.kind;
      if (p.labelGroup === 1 && m[2] === '---') kind = 'open';
      skipWs();
      if (stmt[pos] === '|') {
        const end = stmt.indexOf('|', pos + 1);
        if (end < 0) fail(lineNo, 'missing closing "|" in edge label');
        label = unquote(stmt.slice(pos + 1, end));
        pos = end + 1;
      }
      return { kind, label: label || null };
    }
    return fail(lineNo, `unexpected "${rest.slice(0, 15)}" (expected -->, ---, -.-> or ==>)`);
  };

  let from = readNode();
  for (;;) {
    const edge = readEdge();
    if (!edge) break;
    const to = readNode();
    edges.push({ from, to, label: edge.label, kind: edge.kind, line: lineNo });
    from = to;
  }
}

function findClose(s: string, start: number, close: string) {
  let quote = false;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '"') quote = !quote;
    else if (!quote && s.startsWith(close, i)) return i;
  }
  return -1;
}

// ---------------------------------------------------------------- layout
export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
  order: number;
}
export interface Layout {
  boxes: Record<string, NodeBox>;
  width: number;
  height: number;
}

export const SPACING = 80;
export const FONT_SIZE = 20;

export const nodeSize = (n: DiagramNode, measure: (t: string) => { width: number; height: number }) => {
  const t = measure(n.label);
  switch (n.shape) {
    case 'diamond':
      return { width: Math.max(140, t.width * 2 + 40), height: Math.max(90, t.height * 2 + 30) };
    case 'circle': {
      const d = Math.max(90, Math.hypot(t.width, t.height) + 30);
      return { width: d, height: d };
    }
    default:
      return { width: Math.max(120, t.width + 48), height: Math.max(60, t.height + 32) };
  }
};

export const estimateText = (t: string) => {
  const lines = t.split('\n');
  return { width: Math.max(...lines.map((l) => l.length)) * 9 * (FONT_SIZE / 20), height: lines.length * FONT_SIZE * 1.25 };
};

/** layer assignment by longest path (cycles broken with DFS back edges) */
export function assignLayers(nodeIds: string[], edges: Array<{ from: string; to: string }>): Record<string, number> {
  const out = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const e of edges) if (e.from !== e.to) out.get(e.from)?.push(e.to);
  // DFS: drop back edges to get a DAG
  const state = new Map<string, 0 | 1 | 2>();
  const dag = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  const order: string[] = [];
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of out.get(u) ?? []) {
      const sv = state.get(v) ?? 0;
      if (sv === 1) continue; // back edge
      dag.get(u)!.push(v);
      if (sv === 0) visit(v);
    }
    state.set(u, 2);
    order.push(u);
  };
  for (const id of nodeIds) if (!state.get(id)) visit(id);
  order.reverse(); // topological order
  const layer: Record<string, number> = {};
  for (const id of nodeIds) layer[id] = 0;
  for (const u of order) for (const v of dag.get(u)!) layer[v] = Math.max(layer[v], layer[u] + 1);
  return layer;
}

/** order nodes within layers by barycenter sweeps to reduce crossings */
export function orderLayers(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
  layer: Record<string, number>,
): string[][] {
  const maxLayer = Math.max(0, ...Object.values(layer));
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const id of nodeIds) layers[layer[id]].push(id);
  const preds = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  const succs = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const e of edges) {
    if (e.from === e.to) continue;
    preds.get(e.to)?.push(e.from);
    succs.get(e.from)?.push(e.to);
  }
  const pos = new Map<string, number>();
  const index = () => layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  index();
  const sweep = (l: string[], neigh: Map<string, string[]>) => {
    const bary = new Map<string, number>();
    l.forEach((id, i) => {
      const ns = (neigh.get(id) ?? []).filter((n) => pos.has(n));
      bary.set(id, ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : i);
    });
    l.sort((a, b) => bary.get(a)! - bary.get(b)! || pos.get(a)! - pos.get(b)!);
    l.forEach((id, i) => pos.set(id, i));
  };
  for (let iter = 0; iter < 4; iter++) {
    for (let i = 1; i < layers.length; i++) sweep(layers[i], preds);
    for (let i = layers.length - 2; i >= 0; i--) sweep(layers[i], succs);
  }
  return layers;
}

export function layoutDiagram(
  d: ParsedDiagram,
  measure: (t: string) => { width: number; height: number } = estimateText,
): Layout {
  const ids = d.nodes.map((n) => n.id);
  const sizes = Object.fromEntries(d.nodes.map((n) => [n.id, nodeSize(n, measure)]));
  const layerOf = assignLayers(ids, d.edges);
  const layers = orderLayers(ids, d.edges, layerOf);
  const vertical = d.direction === 'TD' || d.direction === 'BT';
  // main axis = across layers, cross axis = within a layer
  const main = (id: string) => (vertical ? sizes[id].height : sizes[id].width);
  const cross = (id: string) => (vertical ? sizes[id].width : sizes[id].height);
  const boxes: Record<string, NodeBox> = {};
  const layerSize = layers.map((l) => Math.max(0, ...l.map(main)));
  const layerCross = layers.map((l) => l.reduce((s, id) => s + cross(id), 0) + SPACING * Math.max(0, l.length - 1));
  const maxCross = Math.max(0, ...layerCross);
  let mainPos = 0;
  layers.forEach((l, li) => {
    let c = (maxCross - layerCross[li]) / 2;
    l.forEach((id, oi) => {
      const m = mainPos + (layerSize[li] - main(id)) / 2;
      const { width, height } = sizes[id];
      boxes[id] = vertical
        ? { x: c, y: m, width, height, layer: li, order: oi }
        : { x: m, y: c, width, height, layer: li, order: oi };
      c += cross(id) + SPACING;
    });
    mainPos += layerSize[li] + SPACING;
  });
  const totalMain = Math.max(0, mainPos - SPACING);
  if (d.direction === 'BT' || d.direction === 'RL') {
    for (const b of Object.values(boxes)) {
      if (vertical) b.y = totalMain - b.y - b.height;
      else b.x = totalMain - b.x - b.width;
    }
  }
  return { boxes, width: vertical ? maxCross : totalMain, height: vertical ? totalMain : maxCross };
}

// ---------------------------------------------------------------- elements
const ARROW_GAP = 8;

/** point on the outline of a shape centered at c (half sizes hw/hh) in direction (dx, dy) */
export function outlinePoint(shape: NodeShape, c: { x: number; y: number }, hw: number, hh: number, dx: number, dy: number) {
  const len = Math.hypot(dx, dy) || 1;
  let t: number;
  if (shape === 'circle') t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
  else if (shape === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  if (!Number.isFinite(t)) t = 0;
  return { x: c.x + dx * t + (dx / len) * ARROW_GAP, y: c.y + dy * t + (dy / len) * ARROW_GAP };
}

export function buildDiagramElements(
  d: ParsedDiagram,
  layout: Layout,
  style: CurrentItemStyle,
  origin: { x: number; y: number },
  measure: (t: string) => { width: number; height: number },
): SketchElement[] {
  const shapes = new Map<string, GenericElement>();
  const texts: TextElement[] = [];
  const arrows: LinearElement[] = [];
  const edgeLabels: TextElement[] = [];
  const shapeStyle = { ...style, fontSize: FONT_SIZE };
  const nodeById = new Map(d.nodes.map((n) => [n.id, n]));

  for (const n of d.nodes) {
    const b = layout.boxes[n.id];
    const type = n.shape === 'diamond' ? 'diamond' : n.shape === 'circle' ? 'ellipse' : 'rectangle';
    const el = newShape(type, {
      x: origin.x + b.x, y: origin.y + b.y, width: b.width, height: b.height,
      style: { ...shapeStyle, roundness: n.shape === 'round' },
    });
    shapes.set(n.id, el);
    if (n.label) {
      const m = measure(n.label);
      const t = newText({
        x: el.x + (el.width - m.width) / 2, y: el.y + (el.height - m.height) / 2,
        width: m.width, height: m.height, style: shapeStyle, text: n.label, containerId: el.id,
      });
      texts.push(t);
      el.boundElements = [{ id: t.id, type: 'text' }];
    }
  }

  for (const e of d.edges) {
    const a = shapes.get(e.from)!, b = shapes.get(e.to)!;
    if (e.from === e.to) continue; // self loops are not drawn
    const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const dx = cb.x - ca.x, dy = cb.y - ca.y;
    const start = outlinePoint(nodeById.get(e.from)!.shape, ca, a.width / 2, a.height / 2, dx, dy);
    const end = outlinePoint(nodeById.get(e.to)!.shape, cb, b.width / 2, b.height / 2, -dx, -dy);
    const arrow = newLinear('arrow', {
      x: start.x, y: start.y,
      style: {
        ...style,
        roundness: false,
        strokeStyle: e.kind === 'dotted' ? 'dashed' : style.strokeStyle,
        strokeWidth: e.kind === 'thick' ? Math.max(4, style.strokeWidth * 2) : style.strokeWidth,
      },
    });
    const ex = end.x - start.x, ey = end.y - start.y;
    const binding = (id: string): PointBinding => ({ elementId: id, focus: 0, gap: ARROW_GAP });
    const full: LinearElement = {
      ...arrow,
      points: [[0, 0], [ex, ey]],
      width: Math.abs(ex),
      height: Math.abs(ey),
      startArrowhead: null,
      endArrowhead: e.kind === 'open' ? null : 'arrow',
      startBinding: binding(a.id),
      endBinding: binding(b.id),
    };
    arrows.push(full);
    a.boundElements = [...a.boundElements, { id: full.id, type: 'arrow' }];
    b.boundElements = [...b.boundElements, { id: full.id, type: 'arrow' }];
    if (e.label) {
      const m = measure(e.label);
      edgeLabels.push(
        newText({
          x: start.x + ex / 2 - m.width / 2, y: start.y + ey / 2 - m.height / 2,
          width: m.width, height: m.height, style: { ...shapeStyle, fontSize: 16, textAlign: 'center' }, text: e.label,
        }),
      );
    }
  }
  // shapes first, then their labels, arrows, edge labels on top
  return [...shapes.values(), ...texts, ...arrows, ...edgeLabels];
}

/** parse, lay out and insert a diagram centered in the viewport; selects it; one undo step */
export function insertDiagramFromText(text: string): void {
  const s = useCanvasStore.getState();
  if (s.appState.viewModeEnabled) throw new Error('The drawing is read-only');
  const parsed = parseDiagram(text);
  const family = s.appState.currentItem.fontFamily;
  const measure = (t: string) => measureText(t, FONT_SIZE, family, 1.25);
  const layout = layoutDiagram(parsed, measure);
  const c = viewportCenter(s.appState);
  const els = buildDiagramElements(parsed, layout, s.appState.currentItem, { x: c.x - layout.width / 2, y: c.y - layout.height / 2 }, measure);
  // group the whole diagram so it moves as one; double-click enters it
  const groupId = uuid();
  const grouped = els.map((e) => ({ ...e, groupIds: [...e.groupIds, groupId] }));
  s.addElements(grouped);
  s.setSelection(grouped.filter((e) => !(e.type === 'text' && e.containerId)).map((e) => e.id));
  s.commit();
}

export const DIAGRAM_EXAMPLE = `graph TD
  A[Start] --> B{Is it working?}
  B -->|Yes| C(Ship it)
  B -->|No| D[Debug]
  D --> B`;
