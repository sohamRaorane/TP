// Fractional indexing for z-order that syncs between collaborators.
// Every element carries an `index` string; z-order = ascending string order
// (plain JS `<` comparison), ties broken by id. Reordering only rewrites the
// moved elements' keys, so concurrent edits from different users converge.
//
// Keys are base-62 fractions ("0.<digits>") that never end in '0'.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

const digit = (c: string | undefined) => (c === undefined ? 0 : DIGITS.indexOf(c));

/** midpoint of fractions a < b ('' = 0, null = 1). Ported from the classic fractional-indexing algorithm. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? digit(a[0]) : 0;
  const db = b !== null ? digit(b[0]) : BASE;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.slice(1), null);
}

const valid = (k: string | null | undefined): k is string =>
  typeof k === 'string' && k.length > 0 && !k.endsWith('0') && [...k].every((c) => DIGITS.includes(c));

/** a key strictly between a and b (either may be null for open ends) */
export function generateKeyBetween(a: string | null | undefined, b: string | null | undefined): string {
  const lo = valid(a) ? a : '';
  let hi: string | null = valid(b) ? b : null;
  if (hi !== null && lo >= hi) hi = null; // inconsistent neighbours: just go after `a`
  return midpoint(lo, hi);
}

/** n keys between a and b, ascending */
export function generateNKeysBetween(a: string | null | undefined, b: string | null | undefined, n: number): string[] {
  const keys: string[] = [];
  let prev = a ?? null;
  for (let i = 0; i < n; i++) {
    prev = generateKeyBetween(prev, b);
    keys.push(prev);
  }
  return keys;
}

const pad = (s: string, n: number) => s.padStart(n, '0');
const toBase62 = (num: number) => {
  let s = '';
  do {
    s = DIGITS[num % BASE] + s;
    num = Math.floor(num / BASE);
  } while (num > 0);
  return s;
};

/**
 * Key for appending after `last`. Time-based when possible so elements that two
 * users append concurrently end up in the same (creation-time) order everywhere.
 */
export function appendKey(last: string | null | undefined, now = Date.now()): string {
  const rand = toBase62(Math.floor(Math.random() * (BASE ** 2 - 1)) + 1);
  let key = pad(toBase62(now), 8) + pad(rand, 2);
  if (key.endsWith('0')) key = key.slice(0, -1) + '1';
  if (!valid(last) || key > last) return key;
  return generateKeyBetween(last, null);
}

export interface Indexed {
  id: string;
  index?: string;
}

export const compareIndexed = (a: Indexed, b: Indexed) => {
  // elements without a key keep their relative position (stable sort) and go first
  if (a.index === undefined && b.index === undefined) return 0;
  const ia = a.index ?? '';
  const ib = b.index ?? '';
  if (ia < ib) return -1;
  if (ia > ib) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/** true if the array is already in index order */
export const isSortedByIndex = (els: Indexed[]) => {
  for (let i = 1; i < els.length; i++) if (compareIndexed(els[i - 1], els[i]) > 0) return false;
  return true;
};

/** stable sort by index (returns the same array instance if already sorted) */
export const sortByIndex = <T extends Indexed>(els: T[]): T[] =>
  isSortedByIndex(els) ? els : [...els].sort(compareIndexed);

/**
 * Give keys to elements that lack valid ones (or are out of order),
 * preserving the current array order. Returns changed elements' new keys.
 */
export function repairIndices<T extends Indexed>(els: T[]): Record<string, string> {
  const fixes: Record<string, string> = {};
  let prev: string | null = null;
  for (let i = 0; i < els.length; i++) {
    const cur = els[i].index;
    if (valid(cur) && (prev === null || cur > prev)) {
      prev = cur;
      continue;
    }
    // next valid key after i that is greater than prev, as upper bound
    let next: string | null = null;
    for (let j = i + 1; j < els.length; j++) {
      const k = els[j].index;
      if (valid(k) && (prev === null || k > prev)) {
        next = k;
        break;
      }
    }
    prev = generateKeyBetween(prev, next);
    fixes[els[i].id] = prev;
  }
  return fixes;
}
