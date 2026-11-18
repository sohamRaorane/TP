import { describe, expect, it } from 'vitest';
import { getCommonBounds, getElementBounds } from '@/engine/transformations/bounds';
import { ellipse, linear, rect } from './helpers';

describe('bounds', () => {
  it('unrotated rectangle', () => {
    expect(getElementBounds(rect(10, 20, 100, 50))).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
  });

  it('rectangle rotated 90° swaps extents around the center', () => {
    const b = getElementBounds(rect(0, 0, 100, 50, { angle: Math.PI / 2 }));
    expect(b.minX).toBeCloseTo(25);
    expect(b.maxX).toBeCloseTo(75);
    expect(b.minY).toBeCloseTo(-25);
    expect(b.maxY).toBeCloseTo(75);
  });

  it('rotated ellipse uses exact extents (tighter than its box)', () => {
    const b = getElementBounds(ellipse(0, 0, 100, 100, { angle: Math.PI / 4 }));
    expect(b.minX).toBeCloseTo(0);
    expect(b.maxX).toBeCloseTo(100);
  });

  it('linear element with negative points', () => {
    const l = linear('line', [[100, 100], [50, 150], [200, 120]]);
    expect(getElementBounds(l)).toEqual({ minX: 50, minY: 100, maxX: 200, maxY: 150 });
  });

  it('common bounds skips deleted', () => {
    const b = getCommonBounds([rect(0, 0, 10, 10), rect(100, 100, 10, 10, { isDeleted: true }), rect(-5, 3, 1, 1)]);
    expect(b).toEqual({ minX: -5, minY: 0, maxX: 10, maxY: 10 });
  });
});
