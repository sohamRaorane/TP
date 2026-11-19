import { describe, expect, it } from 'vitest';
import { measureText, wrapText } from '@/engine/drawing/textMeasure';
import { exportToCanvas, exportToSvg } from '@/engine/rendering';
import { getElementShape } from '@/engine/rendering/shapes';
import { ellipse, freedraw, frame, linear, rect, text } from './helpers';

describe('text measure', () => {
  it('falls back to an estimate in jsdom', () => {
    const m = measureText('hello\nworld!!', 20, 1, 1.25);
    expect(m.height).toBe(50);
    expect(m.width).toBeGreaterThan(40);
    expect(measureText('abc', 20, 3, 1.25).width).toBeGreaterThan(measureText('abc', 10, 3, 1.25).width);
  });

  it('wraps long text', () => {
    expect(wrapText('one two three four', 20, 2, 60).split('\n').length).toBeGreaterThan(1);
  });
});

describe('shape generation', () => {
  it('is deterministic per seed and cached by version', () => {
    const r = rect(0, 0, 100, 100);
    const a = getElementShape(r);
    expect(getElementShape(r)).toBe(a);
    const r2 = { ...r, version: r.version + 1 };
    const b = getElementShape(r2);
    expect(b).not.toBe(a);
    expect(JSON.stringify(b.drawables[0].sets)).toBe(JSON.stringify(a.drawables[0].sets));
  });

  it('arrows get arrowhead drawables, freedraw gets an outline path', () => {
    expect(getElementShape(linear('arrow', [[0, 0], [100, 0]], { endArrowhead: 'triangle', startArrowhead: 'dot' })).drawables.length).toBe(3);
    expect(getElementShape(freedraw([[0, 0], [10, 5], [20, 0]])).freedrawPath).toMatch(/^M /);
  });
});

describe('exports', () => {
  it('exportToSvg builds an svg with paths, text, frame clip and background', () => {
    const f = frame(0, 0, 300, 200);
    const r = { ...rect(10, 10, 100, 50), frameId: f.id };
    const svg = exportToSvg([f, r, ellipse(400, 0, 50, 50), text(0, 300, 'Hi\nthere')], {}, { padding: 10, background: '#fff', theme: 'light' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(3);
    expect(svg.querySelectorAll('tspan').length).toBe(2);
    expect(svg.querySelector('clipPath')).not.toBeNull();
    expect(svg.querySelector(':scope > rect')?.getAttribute('fill')).toBe('#fff');
    const dark = exportToSvg([r], {}, { padding: 10, background: null, theme: 'dark' });
    expect(dark.getAttribute('style')).toContain('invert');
  });

  it('exportToCanvas sizes the canvas to content * scale', () => {
    const c = exportToCanvas([rect(0, 0, 100, 50)], {}, { scale: 2, padding: 10, background: '#fff', theme: 'light' });
    expect(c.width).toBe(240);
    expect(c.height).toBe(140);
  });
});
