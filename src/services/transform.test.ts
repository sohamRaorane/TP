import { describe, it, expect, beforeEach } from 'vitest';
import { alignUnits, distributeUnits, flipElements, moveElements } from './transform';
import { selectionUnits } from './scene';
import { resetStores, rect, arrow } from '@/test/helpers';

beforeEach(resetStores);

describe('align', () => {
  const a = rect(0, 0, 10, 10);
  const b = rect(50, 20, 30, 40);
  it.each([
    ['left', { a: [0, 0], b: [0, 20] }],
    ['right', { a: [70, 0], b: [50, 20] }],
    ['centerX', { a: [35, 0], b: [25, 20] }],
    ['top', { a: [0, 0], b: [50, 0] }],
    ['bottom', { a: [0, 50], b: [50, 20] }],
    ['centerY', { a: [0, 25], b: [50, 10] }],
  ] as const)('%s', (edge, want) => {
    const ch = alignUnits([[a], [b]], edge);
    const pos = (el: typeof a) => [ch[el.id]?.x ?? el.x, ch[el.id]?.y ?? el.y];
    expect(pos(a)).toEqual(want.a);
    expect(pos(b)).toEqual(want.b);
  });

  it('moves groups as one unit', () => {
    const g1 = rect(0, 0, 10, 10, { groupIds: ['g'] });
    const g2 = rect(20, 50, 10, 10, { groupIds: ['g'] });
    const c = rect(100, 100, 10, 10);
    const units = selectionUnits([g1, g2, c], null);
    expect(units).toHaveLength(2);
    const ch = alignUnits(units, 'top');
    expect(ch[g1.id]).toBeUndefined(); // group already at top
    expect(ch[c.id]).toEqual({ x: 100, y: 0 });
  });

  it('needs two units', () => {
    expect(alignUnits([[rect(0, 0)]], 'left')).toEqual({});
  });
});

describe('distribute', () => {
  it('equal gaps between units, ends fixed', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(15, 0, 10, 10);
    const c = rect(90, 0, 10, 10);
    const ch = distributeUnits([[c], [a], [b]], 'horizontal');
    expect(ch[a.id]).toBeUndefined();
    expect(ch[c.id]).toBeUndefined();
    expect(ch[b.id]).toEqual({ x: 45, y: 0 });
  });

  it('vertical with different sizes', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(0, 12, 10, 30);
    const c = rect(0, 100, 10, 20);
    const ch = distributeUnits([[a], [b], [c]], 'vertical');
    // span 0..120, sizes 60 -> gap 30 -> b at 40
    expect(ch[b.id]).toEqual({ x: 0, y: 40 });
  });

  it('needs three units', () => {
    expect(distributeUnits([[rect(0, 0)], [rect(50, 0)]], 'horizontal')).toEqual({});
  });
});

describe('flip', () => {
  it('mirrors shapes and linear points horizontally', () => {
    const r = rect(0, 0, 10, 10);
    const ar = arrow(50, 0, 50, 20);
    const ch = flipElements([r, ar], 'horizontal');
    // bounds 0..100, center 50
    expect(ch[r.id].x).toBe(90);
    expect(ch[ar.id].x).toBe(50);
    expect(ch[ar.id].points).toEqual([[0, 0], [-50, 20]]);
  });

  it('flips image scale and negates angle', () => {
    const img = { ...rect(0, 0, 10, 10, { angle: 0.5 }), type: 'image' as const, fileId: 'f', status: 'saved' as const, scale: [1, 1] as [number, number] };
    const ch = flipElements([img], 'vertical');
    expect(ch[img.id].scale).toEqual([1, -1]);
    expect(ch[img.id].angle).toBeCloseTo(Math.PI * 2 - 0.5);
  });
});

describe('move', () => {
  it('skips locked elements', () => {
    const r = rect(0, 0, 10, 10, { locked: true });
    expect(moveElements([r], new Set([r.id]), 5, 5)).toEqual({});
  });

  it('moves the end point of an arrow bound at its end', () => {
    const r = rect(100, 0);
    const ar = arrow(0, 0, 90, 0, { endBinding: { elementId: r.id, focus: 0, gap: 4 } });
    const ch = moveElements([r, ar], new Set([r.id]), 0, 10);
    expect(ch[ar.id]).toMatchObject({ x: 0, y: 0, points: [[0, 0], [90, 10]], width: 90, height: 10 });
  });
});
