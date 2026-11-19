// Small timing helpers (debounce with max-wait, throttle) that work with fake timers.

export interface Debounced {
  (): void;
  flush: () => void;
  cancel: () => void;
  pending: () => boolean;
}

/** trailing debounce; with maxWait the call fires at the latest maxWait ms after the first pending call */
export function debounce(fn: () => void, wait: number, maxWait?: number): Debounced {
  let t: ReturnType<typeof setTimeout> | null = null;
  let firstAt: number | null = null;
  const run = () => {
    if (t) clearTimeout(t);
    t = null;
    firstAt = null;
    fn();
  };
  const d = (() => {
    const now = Date.now();
    if (firstAt === null) firstAt = now;
    if (t) clearTimeout(t);
    let delay = wait;
    if (maxWait !== undefined) delay = Math.max(0, Math.min(wait, firstAt + maxWait - now));
    t = setTimeout(run, delay);
  }) as Debounced;
  d.flush = () => {
    if (t) run();
  };
  d.cancel = () => {
    if (t) clearTimeout(t);
    t = null;
    firstAt = null;
  };
  d.pending = () => t !== null;
  return d;
}

/** leading + trailing throttle */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0;
  let t: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: A | null = null;
  const th = (...args: A) => {
    const now = Date.now();
    if (now < last) last = 0; // clock moved backwards
    const remaining = ms - (now - last);
    if (remaining <= 0 && !t) {
      last = now;
      fn(...args);
      return;
    }
    pendingArgs = args;
    if (!t)
      t = setTimeout(() => {
        t = null;
        last = Date.now();
        const a = pendingArgs;
        pendingArgs = null;
        if (a) fn(...a);
      }, Math.max(0, remaining));
  };
  th.cancel = () => {
    if (t) clearTimeout(t);
    t = null;
    pendingArgs = null;
    last = 0;
  };
  return th;
}
