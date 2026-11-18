import { describe, expect, it } from 'vitest';
import { getElementAtPoint, getElementsInRect, hitTestElement, hitTestScene } from '@/engine/hitTesting';
import { diamond, ellipse, frame, freedraw, image, linear, rect, text } from './helpers';

const T = 5;

describe('hit testing', () => {
  it('transparent rectangle: stroke yes, interior no (unless selected)', () => {
    const r = rect(0, 0, 100, 100, { roundness: false });
    expect(hitTestElement(r, 0, 50, T)).toBe(true);
    expect(hitTestElement(r, 103, 50, T)).toBe(true);
    expect(hitTestElement(r, 50, 50, T)).toBe(false);
    expect(hitTestElement(r, 50, 50, T, { selected: true })).toBe(true);
    expect(hitTestElement(r, 120, 50, T)).toBe(false);
  });

  it('filled rectangle interior hits', () => {
    expect(hitTestElement(rect(0, 0, 100, 100, { backgroundColor: '#f00' }), 50, 50, T)).toBe(true);
  });

  it('rotated rectangle uses rotated geometry', () => {
    const r = rect(0, 0, 200, 20, { angle: Math.PI / 2, backgroundColor: '#f00' });
    // center (100,10); rotated it spans x 90..110, y -90..110
    expect(hitTestElement(r, 100, -80, T)).toBe(true);
    expect(hitTestElement(r, 10, 10, T)).toBe(false);
  });

  it('ellipse true geometry: box corner misses', () => {
    const e = ellipse(0, 0, 100, 100, { backgroundColor: '#0f0' });
    expect(hitTestElement(e, 50, 50, T)).toBe(true);
    expect(hitTestElement(e, 3, 3, T)).toBe(false);
    expect(hitTestElement(e, 0, 50, T)).toBe(true);
  });

  it('diamond true geometry', () => {
    const d = diamond(0, 0, 100, 100, { backgroundColor: '#00f' });
    expect(hitTestElement(d, 50, 50, T)).toBe(true);
    expect(hitTestElement(d, 8, 8, T)).toBe(false);
    expect(hitTestElement(d, 25, 25, T)).toBe(true); // on the edge
  });

  it('rotated diamond', () => {
    const d = diamond(0, 0, 100, 100, { angle: Math.PI / 4 });
    // rotated 45° the diamond becomes axis-aligned square-ish; its old top vertex moves to the right
    const r = 50 * Math.SQRT1_2;
    expect(hitTestElement(d, 50 + r, 50 - r, T)).toBe(true);
  });

  it('line: distance to segments', () => {
    const l = linear('line', [[0, 0], [100, 0], [100, 100]]);
    expect(hitTestElement(l, 50, 3, T)).toBe(true);
    expect(hitTestElement(l, 103, 50, T)).toBe(true);
    expect(hitTestElement(l, 50, 50, T)).toBe(false);
  });

  it('rotated arrow', () => {
    const a = linear('arrow', [[0, 0], [100, 0]], { angle: Math.PI / 2 });
    // center (50,0) -> rotated vertical segment x=50, y -50..50
    expect(hitTestElement(a, 50, -40, T)).toBe(true);
    expect(hitTestElement(a, 10, 0, T)).toBe(false);
  });

  it('curved line uses sampled curve', () => {
    const l = { ...linear('line', [[0, 0], [50, 50], [100, 0]]), roundness: true };
    expect(hitTestElement(l, 50, 50, T)).toBe(true);
    expect(hitTestElement(l, 50, 0, T)).toBe(false);
  });

  it('freedraw: distance to polyline', () => {
    const f = freedraw([[0, 0], [10, 10], [20, 0], [30, 10]]);
    expect(hitTestElement(f, 10, 10, T)).toBe(true);
    expect(hitTestElement(f, 15, 30, T)).toBe(false);
  });

  it('text and image are bbox', () => {
    expect(hitTestElement(text(0, 0, 'hi'), 50, 12, T)).toBe(true);
    expect(hitTestElement(image(0, 0, 100, 100), 50, 50, T)).toBe(true);
    expect(hitTestElement(image(0, 0, 100, 100), 150, 50, T)).toBe(false);
  });

  it('frame hits only border or name label', () => {
    const f = frame(0, 0, 300, 200);
    expect(hitTestElement(f, 150, 100, T, { zoom: 1 })).toBe(false);
    expect(hitTestElement(f, 0, 100, T, { zoom: 1 })).toBe(true);
    expect(hitTestElement(f, 10, -10, T, { zoom: 1 })).toBe(true);
  });

  it('getElementAtPoint returns the topmost element and maps labels to containers', () => {
    const a = rect(0, 0, 100, 100, { backgroundColor: '#f00' });
    const b = rect(50, 50, 100, 100, { backgroundColor: '#0f0' });
    expect(getElementAtPoint(75, 75, [a, b], T)?.id).toBe(b.id);
    const label = text(20, 40, 'x', { containerId: a.id } as never);
    expect(getElementAtPoint(30, 50, [a, label], T)?.id).toBe(a.id);
  });

  it('hitTestScene skips locked when asked and prefers selected interiors', () => {
    const a = rect(0, 0, 100, 100, { locked: true, backgroundColor: '#f00' });
    expect(hitTestScene(50, 50, [a], T, { skipLocked: true })).toBeNull();
    const t = rect(0, 0, 100, 100);
    expect(hitTestScene(50, 50, [t], T, { selectedIds: { [t.id]: true } })?.id).toBe(t.id);
  });

  it('getElementsInRect requires full containment (rotation-aware)', () => {
    const a = rect(10, 10, 50, 50);
    const b = rect(10, 10, 100, 10, { angle: Math.PI / 2 }); // spans y -35..65 when rotated
    const res = getElementsInRect({ x: 0, y: 0, width: 120, height: 70 }, [a, b]);
    expect(res.map((e) => e.id)).toEqual([a.id]);
    // negative-size rect also works
    expect(getElementsInRect({ x: 120, y: 70, width: -120, height: -70 }, [a]).length).toBe(1);
  });
});
