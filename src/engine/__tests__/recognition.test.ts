import { describe, expect, it } from 'vitest';
import { recognizeShape } from '@/engine/drawing/shapeRecognition';
import type { P2 } from '@/engine/math';

// deterministic jitter
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
const jitter = (pts: P2[], amt: number) => pts.map(([x, y]) => [x + rnd() * amt, y + rnd() * amt] as P2);
const seg = (a: P2, b: P2, n = 20): P2[] => Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);

describe('shape recognition', () => {
  it('recognizes a rectangle', () => {
    const pts = jitter([...seg([0, 0], [200, 0]), ...seg([200, 0], [200, 120]), ...seg([200, 120], [0, 120]), ...seg([0, 120], [0, 3])], 2);
    const r = recognizeShape(pts);
    expect(r?.type).toBe('rectangle');
    if (r && 'width' in r) {
      expect(r.width).toBeGreaterThan(190);
      expect(r.height).toBeGreaterThan(110);
    }
  });

  it('recognizes an ellipse', () => {
    const pts: P2[] = [];
    for (let i = 0; i <= 80; i++) pts.push([100 + 90 * Math.cos((i / 80) * Math.PI * 2), 60 + 50 * Math.sin((i / 80) * Math.PI * 2)]);
    expect(recognizeShape(jitter(pts, 2))?.type).toBe('ellipse');
  });

  it('recognizes a diamond', () => {
    const pts = jitter([...seg([100, 0], [200, 80]), ...seg([200, 80], [100, 160]), ...seg([100, 160], [0, 80]), ...seg([0, 80], [98, 2])], 2);
    expect(recognizeShape(pts)?.type).toBe('diamond');
  });

  it('recognizes a straight line', () => {
    const r = recognizeShape(jitter(seg([0, 0], [300, 100], 40), 2));
    expect(r?.type).toBe('line');
  });

  it('recognizes an arrow drawn as shaft + hook', () => {
    const pts = [...seg([0, 0], [300, 0], 40), ...seg([300, 0], [270, -25], 8)];
    const r = recognizeShape(pts);
    expect(r?.type).toBe('arrow');
    if (r && 'end' in r) expect(r.end[0]).toBeGreaterThan(290);
  });

  it('returns null for scribbles and tiny strokes', () => {
    const scribble: P2[] = Array.from({ length: 60 }, (_, i) => [i * 5, Math.sin(i / 2) * 40]);
    expect(recognizeShape(scribble)).toBeNull();
    expect(recognizeShape([[0, 0], [2, 2], [3, 1]])).toBeNull();
  });
});
