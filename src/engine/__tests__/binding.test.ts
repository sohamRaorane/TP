import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/store/canvasStore';
import type { LinearElement, SketchElement, TextElement } from '@/types/appState';
import { applyBinding, bindingPoint, computeBinding, getBindableElementAt, updateBoundArrows } from '@/engine/drawing/binding';
import { layoutBoundText, textSizeChanges } from '@/engine/drawing/boundText';
import { getPointsInScene } from '@/engine/transformations/handles';
import { linear, rect, text, ellipse } from './helpers';

const s = () => useCanvasStore.getState();
const get = <T extends SketchElement>(id: string) => s().elementsById[id] as T;

beforeEach(() => s().replaceScene([]));

describe('binding geometry', () => {
  it('finds bindable elements near the outline', () => {
    const r = rect(100, 100, 100, 100);
    expect(getBindableElementAt(95, 150, [r], 1)?.id).toBe(r.id);
    expect(getBindableElementAt(150, 150, [r], 1)?.id).toBe(r.id);
    expect(getBindableElementAt(50, 150, [r], 1)).toBeNull();
    // at higher zoom the screen distance shrinks
    expect(getBindableElementAt(90, 150, [r], 4)).toBeNull();
  });

  it('bindingPoint lands on the outline (minus the gap) aiming by focus', () => {
    const r = rect(100, 100, 100, 100, { roundness: false });
    const b = computeBinding(r, [150, 150], [0, 150]);
    expect(b.focus).toBeCloseTo(0);
    const p = bindingPoint(b, r, [0, 150]);
    expect(p[0]).toBeCloseTo(100 - b.gap);
    expect(p[1]).toBeCloseTo(150);
  });

  it('works for ellipses', () => {
    const e = ellipse(100, 100, 100, 100);
    const p = bindingPoint({ elementId: e.id, focus: 0, gap: 0 }, e, [150, 0]);
    expect(p[0]).toBeCloseTo(150, 0);
    expect(p[1]).toBeCloseTo(100, 0);
  });
});

describe('bound arrows in the store', () => {
  it('binds, follows the target on move, and records boundElements', () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(300, 0, 100, 100);
    const arrow = linear('arrow', [[100, 50], [300, 50]]);
    s().addElements([a, b, arrow]);
    applyBinding(arrow.id, 'start', get(a.id));
    applyBinding(arrow.id, 'end', get(b.id));
    expect(get<LinearElement>(arrow.id).startBinding?.elementId).toBe(a.id);
    expect(get(a.id).boundElements).toEqual([{ id: arrow.id, type: 'arrow' }]);
    expect(get(b.id).boundElements).toEqual([{ id: arrow.id, type: 'arrow' }]);

    s().updateElements({ [b.id]: { y: 200 } });
    updateBoundArrows([b.id]);
    const pts = getPointsInScene(get(arrow.id));
    const end = pts[pts.length - 1];
    // end now sits on the moved rect's outline (within gap)
    expect(end[1]).toBeGreaterThan(190);
    expect(end[0]).toBeGreaterThan(290);
    expect(get<LinearElement>(arrow.id).points[0]).toEqual([0, 0]);
  });

  it('unbinding removes the boundElements ref', () => {
    const a = rect(0, 0, 100, 100);
    const arrow = linear('arrow', [[100, 50], [300, 50]]);
    s().addElements([a, arrow]);
    applyBinding(arrow.id, 'start', get(a.id));
    applyBinding(arrow.id, 'start', null);
    expect(get<LinearElement>(arrow.id).startBinding).toBeNull();
    expect(get(a.id).boundElements).toEqual([]);
  });

  it('follows rotation of the target', () => {
    const a = rect(0, 0, 200, 20, { roundness: false });
    const arrow = linear('arrow', [[100, 200], [100, 30]]);
    s().addElements([a, arrow]);
    applyBinding(arrow.id, 'end', get(a.id));
    s().updateElements({ [a.id]: { angle: Math.PI / 2 } });
    updateBoundArrows([a.id]);
    const pts = getPointsInScene(get(arrow.id));
    // rotated rect spans y -90..110 around (100,10): end must be below 110
    expect(pts[1][1]).toBeGreaterThan(105);
    expect(pts[1][1]).toBeLessThan(125);
  });
});

describe('bound text', () => {
  it('wraps the label to the container width, grows only its height, and keeps the source text', () => {
    const c = rect(0, 0, 160, 30);
    const t = text(0, 0, 'a fairly long label that needs wrapping', { containerId: c.id } as never) as TextElement;
    const ch = layoutBoundText(c, t);
    expect(ch[c.id].height as number).toBeGreaterThan(30);
    expect(ch[c.id].width ?? 160).toBe(160);
    expect(String(ch[t.id].text)).toContain('\n');
    expect(ch[t.id].originalText).toBe('a fairly long label that needs wrapping');
    expect(ch[t.id].width as number).toBeLessThanOrEqual(160 - 16);
    // re-layout in a wider container un-wraps from the original text
    const wide = { ...c, width: 1000, height: 200 } as SketchElement;
    const t2 = { ...t, ...ch[t.id] } as TextElement;
    expect(String(layoutBoundText(wide, t2)[t.id].text)).not.toContain('\n');
  });

  it('centers the label in its container', () => {
    const c = rect(0, 0, 40, 30);
    const t = text(0, 0, 'a fairly long label', { containerId: c.id } as never) as TextElement;
    const ch = layoutBoundText(c, t);
    const nc = { ...c, ...ch[c.id] } as SketchElement;
    const nt = { ...t, ...ch[t.id] } as TextElement;
    expect(nt.x + nt.width / 2).toBeCloseTo(nc.x + nc.width / 2);
    expect(nt.y + nt.height / 2).toBeCloseTo(nc.y + nc.height / 2);
  });

  it('free text size follows content and keeps center alignment anchor', () => {
    const t = text(100, 0, 'ab', { textAlign: 'center', width: 20 } as never) as TextElement;
    const ch = textSizeChanges(t, 'abcdef\nx');
    expect(ch.height).toBeCloseTo(2 * 20 * 1.25);
    expect((ch.x as number) + (ch.width as number) / 2).toBeCloseTo(110);
  });
});
