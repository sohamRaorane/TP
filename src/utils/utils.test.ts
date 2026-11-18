import { describe, it, expect, vi } from 'vitest';
import { embedSceneInPng, extractSceneFromPng } from './pngMetadata';
import { debounce, throttle } from './timing';
import { getUrlState } from './url';
import { sanitizeFileName } from './download';
import { sha1Hex } from './hash';
import { fitSize } from './image';

// smallest valid 1x1 PNG
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

describe('png metadata', () => {
  it('embeds and extracts unicode JSON', () => {
    const json = JSON.stringify({ type: 'sketchboard', name: 'Ünïcødé ✓' });
    const out = embedSceneInPng(PNG, json);
    expect(out.length).toBeGreaterThan(PNG.length);
    expect(extractSceneFromPng(out)).toBe(json);
    expect(extractSceneFromPng(PNG)).toBeNull();
    expect(extractSceneFromPng(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('timing', () => {
  it('debounce with maxWait', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100, 250);
    for (let i = 0; i < 10; i++) {
      d();
      vi.advanceTimersByTime(50);
    }
    // 500ms of continuous calls -> fired by maxWait twice
    expect(fn).toHaveBeenCalledTimes(2);
    d();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(3);
    d();
    expect(d.pending()).toBe(true);
    d.flush();
    expect(fn).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it('throttle leading + trailing', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = throttle(fn, 50);
    t(1);
    t(2);
    t(3);
    expect(fn).toHaveBeenCalledWith(1);
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenLastCalledWith(3);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('misc utils', () => {
  it('parses url state', () => {
    expect(getUrlState({ search: '?room=abc', hash: '' })).toEqual({ room: 'abc', drawing: null });
    expect(getUrlState({ search: '', hash: '#drawing=xyz' })).toEqual({ room: null, drawing: 'xyz' });
  });
  it('sanitizes file names', () => {
    expect(sanitizeFileName('a/b:c?')).toBe('a_b_c_');
    expect(sanitizeFileName('   ')).toBe('Untitled drawing');
  });
  it('sha1', async () => {
    expect(await sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });
  it('fitSize keeps aspect', () => {
    expect(fitSize(800, 400, 400)).toEqual({ width: 400, height: 200 });
    expect(fitSize(100, 50, 400)).toEqual({ width: 100, height: 50 });
  });
});
