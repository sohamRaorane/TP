import { describe, expect, it } from 'vitest';
import type { SketchElement } from '@/types/appState';
import { resizeMultipleElements, resizeSingleElement } from '@/engine/transformations/resize';
import { rotateElements, rotateSingleElement, rotationDelta } from '@/engine/transformations/rotate';
import { flipElements } from '@/engine/transformations/flip';
import { getCommonBounds } from '@/engine/transformations/bounds';
import { getTransformHandles, hitTestHandle } from '@/engine/transformations/handles';
import { getSnapTargets, snapBounds, snapPoint } from '@/engine/transformations/snapping';
import { getElementCenter, localToScene, rotatePoint } from '@/engine/math';
import { image, linear, rect, text } from './helpers';

const apply = <T extends SketchElement>(el: T, ch: object) => ({ ...el, ...ch }) as T;
const noMods = { keepAspect: false, fromCenter: false };

describe('single resize', () => {
  it('se handle grows width/height, nw stays fixed', () => {
    const r = rect(0, 0, 100, 50);
    const n = apply(r, resizeSingleElement(r, 'se', 150, 120, noMods));
    expect(n).toMatchObject({ x: 0, y: 0, width: 150, height: 120 });
  });

  it('nw handle keeps se corner fixed', () => {
    const r = rect(0, 0, 100, 50);
    const n = apply(r, resizeSingleElement(r, 'nw', 20, 10, noMods));
    expect(n.x).toBeCloseTo(20);
    expect(n.y).toBeCloseTo(10);
    expect(n.x + n.width).toBeCloseTo(100);
    expect(n.y + n.height).toBeCloseTo(50);
  });

  it('side handle changes one axis only', () => {
    const r = rect(0, 0, 100, 50);
    const n = apply(r, resizeSingleElement(r, 'e', 180, 999, noMods));
    expect(n).toMatchObject({ x: 0, y: 0, width: 180, height: 50 });
  });

  it('shift keeps aspect ratio on corners', () => {
    const r = rect(0, 0, 100, 50);
    const n = apply(r, resizeSingleElement(r, 'se', 300, 60, { keepAspect: true, fromCenter: false }));
    expect(n.width / n.height).toBeCloseTo(2);
    expect(n.width).toBeCloseTo(300);
  });

  it('alt resizes from center', () => {
    const r = rect(0, 0, 100, 100);
    const n = apply(r, resizeSingleElement(r, 'e', 120, 50, { keepAspect: false, fromCenter: true }));
    expect(n.x).toBeCloseTo(-20);
    expect(n.width).toBeCloseTo(140);
    expect(getElementCenter(n).x).toBeCloseTo(50);
  });

  it('dragging past the opposite edge flips without negative sizes', () => {
    const r = rect(0, 0, 100, 50);
    const n = apply(r, resizeSingleElement(r, 'e', -50, 25, noMods));
    expect(n.width).toBeCloseTo(50);
    expect(n.x).toBeCloseTo(-50);
  });

  it('rotated element keeps the opposite corner fixed in scene space (no drift)', () => {
    const r = rect(100, 100, 200, 100, { angle: 0.7 });
    const nwBefore = localToScene(r, 0, 0);
    // drag se handle to an arbitrary point several times (simulated drag)
    let cur = r;
    for (const [px, py] of [[400, 300], [420, 350], [380, 330], [450, 400]]) {
      cur = apply(r, resizeSingleElement(r, 'se', px, py, noMods));
    }
    const nwAfter = localToScene(cur, 0, 0);
    expect(nwAfter[0]).toBeCloseTo(nwBefore[0], 6);
    expect(nwAfter[1]).toBeCloseTo(nwBefore[1], 6);
    // and the se corner is where the pointer is (projected into the rotated frame)
    const se = localToScene(cur, cur.width, cur.height);
    expect(se[0]).toBeCloseTo(450, 6);
    expect(se[1]).toBeCloseTo(400, 6);
  });

  it('rotated element with side handle keeps the opposite side fixed', () => {
    const r = rect(0, 0, 100, 60, { angle: Math.PI / 3 });
    const wBefore = localToScene(r, 0, 30);
    const p = localToScene(r, 160, 30);
    const n = apply(r, resizeSingleElement(r, 'e', p[0], p[1], noMods));
    const wAfter = localToScene(n, 0, n.height / 2);
    expect(n.width).toBeCloseTo(160);
    expect(wAfter[0]).toBeCloseTo(wBefore[0]);
    expect(wAfter[1]).toBeCloseTo(wBefore[1]);
  });

  it('text resize scales fontSize and keeps aspect', () => {
    const t = text(0, 0, 'hello', { width: 100, height: 25 } as never);
    const n = apply(t, resizeSingleElement(t, 'se', 200, 30, noMods));
    expect((n as { fontSize: number }).fontSize).toBeCloseTo(40);
    expect(n.height).toBeCloseTo(50);
  });

  it('image keeps aspect by default, shift frees it', () => {
    const im = image(0, 0, 100, 50);
    const a = apply(im, resizeSingleElement(im, 'se', 200, 60, noMods));
    expect(a.width / a.height).toBeCloseTo(2);
    const b = apply(im, resizeSingleElement(im, 'se', 200, 60, { keepAspect: true, fromCenter: false }));
    expect(b.width).toBeCloseTo(200);
    expect(b.height).toBeCloseTo(60);
  });

  it('linear points scale and points[0] stays [0,0]', () => {
    const l = linear('line', [[100, 100], [50, 150], [200, 120]]);
    const n = apply(l, resizeSingleElement(l, 'se', 350, 200, noMods));
    expect(n.points[0]).toEqual([0, 0]);
    expect(n.width).toBeCloseTo(300);
    expect(n.height).toBeCloseTo(100);
    const b = getCommonBounds([n])!;
    expect(b.minX).toBeCloseTo(50);
    expect(b.minY).toBeCloseTo(100);
  });
});

describe('multi resize', () => {
  it('scales positions and sizes proportionally (corner keeps aspect)', () => {
    const a = rect(0, 0, 50, 50);
    const b = rect(100, 50, 100, 50);
    const bounds = getCommonBounds([a, b])!; // 0,0 - 200,100
    const ch = resizeMultipleElements([a, b], bounds, 'se', 400, 200, noMods);
    expect(ch[a.id]).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
    expect(ch[b.id].x).toBeCloseTo(200);
    expect(ch[b.id].y).toBeCloseTo(100);
    expect(ch[b.id].width).toBeCloseTo(200);
  });

  it('scales text fontSize and linear points', () => {
    const t = text(0, 0, 'x', { width: 100, height: 25 } as never);
    const l = linear('line', [[0, 50], [100, 100]]);
    const bounds = getCommonBounds([t, l])!;
    const ch = resizeMultipleElements([t, l], bounds, 'se', 200, 200, noMods);
    expect(ch[t.id].fontSize).toBeCloseTo(40);
    expect((ch[l.id].points as number[][])[1]).toEqual([200, 100]);
  });

  it('nw handle keeps se of the group fixed', () => {
    const a = rect(0, 0, 100, 100);
    const ch = resizeMultipleElements([a], getCommonBounds([a])!, 'nw', 50, 50, noMods);
    expect((ch[a.id].x as number) + (ch[a.id].width as number)).toBeCloseTo(100);
  });
});

describe('rotation', () => {
  it('single rotation follows the pointer and snaps to 15° with shift', () => {
    const r = rect(0, 0, 100, 100);
    expect(rotateSingleElement(r, 150, 50, false).angle).toBeCloseTo(Math.PI / 2);
    const snapped = rotateSingleElement(r, 100, 40, true).angle as number;
    expect((snapped / (Math.PI / 12)) % 1).toBeCloseTo(0);
  });

  it('multi rotation rotates around the common center', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(90, 0, 10, 10);
    const ch = rotateElements([a, b], 50, 5, Math.PI);
    const na = { ...a, ...ch[a.id] } as SketchElement;
    expect(getElementCenter(na).x).toBeCloseTo(95);
    expect(na.angle).toBeCloseTo(Math.PI);
  });

  it('rotationDelta measures from the drag start', () => {
    expect(rotationDelta(0, 0, 10, 0, 0, 10, false)).toBeCloseTo(Math.PI / 2);
  });
});

describe('flip', () => {
  it('horizontal flip mirrors positions and linear points', () => {
    const a = rect(0, 0, 10, 10);
    const l = linear('arrow', [[90, 0], [100, 10]]);
    const ch = flipElements([a, l], 'horizontal');
    expect(ch[a.id].x).toBeCloseTo(90);
    const nl = { ...l, ...ch[l.id] } as typeof l;
    expect(nl.points[0]).toEqual([-0, 0]);
    expect(nl.points[1][0]).toBeCloseTo(-10);
    expect(getCommonBounds([nl])!.minX).toBeCloseTo(0);
  });

  it('flips image scale', () => {
    const im = image(0, 0, 10, 10);
    expect(flipElements([im], 'vertical')[im.id].scale).toEqual([1, -1]);
  });
});

describe('handles', () => {
  it('hit tests rotated handles', () => {
    const r = rect(0, 0, 100, 100, { angle: Math.PI / 2 });
    const h = getTransformHandles(r, 1);
    expect(hitTestHandle(h, h.se!.x, h.se!.y, 1)).toBe('se');
    expect(hitTestHandle(h, h.rotation!.x, h.rotation!.y, 1)).toBe('rotation');
    // after 90° rotation the rotation handle is to the right of center
    expect(h.rotation!.x).toBeGreaterThan(100);
    const [x, y] = rotatePoint(50, -30, 50, 50, Math.PI / 2);
    expect(x).toBeGreaterThan(100);
    expect(y).toBeCloseTo(50);
  });

  it('text only gets corner handles', () => {
    const h = getTransformHandles(text(0, 0, 'abc', { width: 200, height: 100 } as never), 1, { cornersOnly: true });
    expect(h.n).toBeUndefined();
    expect(h.ne).toBeDefined();
  });
});

describe('snapping', () => {
  it('snaps a moving box to another element edge and center within threshold', () => {
    const other = rect(200, 0, 100, 100);
    const t = getSnapTargets([other], new Set());
    const r = snapBounds({ minX: 96, minY: 300, maxX: 196, maxY: 400 }, t, 6);
    expect(r.dx).toBeCloseTo(4);
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.lines[0].x1).toBeCloseTo(200);
  });

  it('does not snap beyond threshold', () => {
    const t = getSnapTargets([rect(200, 0, 100, 100)], new Set());
    expect(snapBounds({ minX: 50, minY: 300, maxX: 150, maxY: 400 }, t, 6).dx).toBe(0);
  });

  it('snapPoint aligns to centers', () => {
    const t = getSnapTargets([rect(0, 0, 100, 100)], new Set());
    const p = snapPoint(52, 300, t, 6);
    expect(p.x).toBe(50);
    expect(p.y).toBe(300);
  });
});
