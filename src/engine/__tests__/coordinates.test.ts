import { describe, expect, it } from 'vitest';
import { fitBounds, sceneToScreen, screenToScene, zoomAt } from '@/engine/coordinates';

describe('coordinates', () => {
  it('round-trips scene <-> screen', () => {
    const v = { scrollX: 13, scrollY: -40, zoom: 1.7 };
    const s = sceneToScreen(100, 50, v);
    const back = screenToScene(s.x, s.y, v);
    expect(back.x).toBeCloseTo(100);
    expect(back.y).toBeCloseTo(50);
  });

  it('zoomAt keeps the scene point under the cursor fixed (no drift over many steps)', () => {
    let v = { scrollX: 0, scrollY: 0, zoom: 1 };
    const before = screenToScene(400, 300, v);
    for (let i = 0; i < 50; i++) v = zoomAt(v, v.zoom * (i % 2 ? 1.1 : 0.93), 400, 300);
    const after = screenToScene(400, 300, v);
    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
  });

  it('zoomAt clamps zoom', () => {
    expect(zoomAt({ scrollX: 0, scrollY: 0, zoom: 1 }, 1000, 0, 0).zoom).toBe(30);
    expect(zoomAt({ scrollX: 0, scrollY: 0, zoom: 1 }, 0.0001, 0, 0).zoom).toBe(0.1);
  });

  it('fitBounds centers content', () => {
    const v = fitBounds({ x: 0, y: 0, width: 100, height: 100 }, 800, 600);
    const c = sceneToScreen(50, 50, v);
    expect(c.x).toBeCloseTo(400);
    expect(c.y).toBeCloseTo(300);
  });
});
