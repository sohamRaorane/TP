import { describe, expect, it } from 'vitest';
import { appendKey, generateKeyBetween, generateNKeysBetween, repairIndices, sortByIndex } from './fractionalIndex';

describe('fractional index', () => {
  it('generates keys strictly between neighbours', () => {
    const cases: Array<[string | null, string | null]> = [[null, null], [null, 'V'], ['V', null], ['A', 'B'], ['A1', 'A2'], ['z', null], ['0001', '0002']];
    for (const [a, b] of cases) {
      const k = generateKeyBetween(a, b);
      if (a) expect(k > a).toBe(true);
      if (b) expect(k < b).toBe(true);
      expect(k.endsWith('0')).toBe(false);
    }
  });
  it('supports many repeated insertions between the same pair', () => {
    let lo = 'A', hi = 'B';
    for (let i = 0; i < 200; i++) {
      const k = generateKeyBetween(lo, hi);
      expect(k > lo && k < hi).toBe(true);
      if (i % 2) lo = k; else hi = k;
    }
  });
  it('appendKey is increasing and time-ordered across users', () => {
    let k: string | undefined;
    for (let i = 0; i < 500; i++) {
      const n = appendKey(k, 1_700_000_000_000);
      if (k) expect(n > k).toBe(true);
      k = n;
    }
    expect(appendKey(null, 1_000) < appendKey(null, 2_000)).toBe(true);
  });
  it('generateNKeysBetween is ascending', () => {
    const ks = generateNKeysBetween('a', 'b', 20);
    expect([...ks].sort()).toEqual(ks);
  });
  it('repairIndices fills missing / out-of-order keys keeping array order', () => {
    const els = [{ id: '1' }, { id: '2', index: 'M' }, { id: '3', index: 'C' }, { id: '4' }, { id: '5', index: 'z' }];
    const fixes = repairIndices(els);
    const fixed = els.map((e) => ({ ...e, index: fixes[e.id] ?? e.index }));
    expect(sortByIndex(fixed).map((e) => e.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(fixes['2']).toBeUndefined();
  });
});
