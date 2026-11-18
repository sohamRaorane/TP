// Performance smoke test with 2000 elements. Seeding uses the store's replaceScene
// (assertion hook, seeding only); the measured interactions use real input.
import { test, expect, type Page } from '@playwright/test';
import { openApp, els, drag, pressKey, view, toScreen } from './helpers';

const N = 2000;

async function seed(page: Page) {
  // draw one template of each kind through the UI
  const kinds: Array<[string, number]> = [['r', 0], ['o', 1], ['d', 2], ['a', 3], ['p', 4]];
  for (const [k, i] of kinds) {
    await pressKey(page, k);
    await page.mouse.move(200 + i * 120, 200);
    await page.mouse.down();
    await page.mouse.move(260 + i * 120, 230, { steps: 3 });
    await page.mouse.move(280 + i * 120, 260, { steps: 3 });
    await page.mouse.up();
    await pressKey(page, 'Escape');
  }
  await pressKey(page, 'v');
  expect(await els(page)).toHaveLength(5);
  await page.evaluate((n) => {
    const st = (window as any).__sketch.useCanvasStore.getState();
    const tpl = st.elements.filter((e: any) => !e.isDeleted);
    const out: any[] = [];
    const cols = 50;
    for (let i = 0; i < n; i++) {
      const t = tpl[i % tpl.length];
      out.push({
        ...t,
        id: `perf-${i}`,
        x: (i % cols) * 90,
        y: Math.floor(i / cols) * 90,
        seed: (i * 7919) % 100000,
        version: 1,
        versionNonce: i,
        backgroundColor: i % 3 === 0 ? '#a5d8ff' : t.backgroundColor,
        fillStyle: i % 6 === 0 ? 'hachure' : 'solid',
      });
    }
    st.replaceScene(out);
  }, N);
  await expect.poll(async () => (await els(page)).length).toBe(N);
}

/** start recording rAF frame durations in the page */
const startFrames = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    w.__frames = [];
    w.__recording = true;
    let last = performance.now();
    const loop = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (w.__recording) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

const stopFrames = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    w.__recording = false;
    const f: number[] = w.__frames.slice(1);
    const sorted = [...f].sort((a, b) => a - b);
    return {
      frames: f.length,
      avg: f.reduce((a, b) => a + b, 0) / Math.max(1, f.length),
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      long: f.filter((x) => x > 200).length,
    };
  });

test('2000 elements: wheel pan and drag-move stay responsive', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  await seed(page);
  // zoom out a bit so that many elements are visible at once
  await page.mouse.move(700, 450);
  await page.keyboard.down('Control');
  for (let i = 0; i < 2; i++) await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await page.screenshot({ path: '/tmp/e2e-shots/perf-scene.png' });

  // ---- wheel pan x30 (15 one way, 15 back so the grid stays where it was)
  await startFrames(page);
  const t0 = Date.now();
  const s0 = (await view(page)).scrollY;
  let minScroll = s0;
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, i < 15 ? 40 : -40);
    if (i === 14) minScroll = (await view(page)).scrollY;
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const panMs = Date.now() - t0;
  const pan = await stopFrames(page);
  expect(minScroll).toBeLessThan(s0 - 1000);
  expect((await view(page)).scrollY).toBeCloseTo(s0, 0);

  // ---- box-select a block of elements and drag-move them
  await pressKey(page, 'Escape');
  const ba = await toScreen(page, -20, -20);
  const bb = await toScreen(page, 880, 440);
  await drag(page, ba, bb, { steps: 10 });
  const selected = (await view(page)).selectedIds.length;
  expect(selected).toBeGreaterThan(20);
  const firstSel = (await view(page)).selectedIds[0];
  const before = (await els(page)).find((e) => e.id === firstSel)!;
  // grab a selected element's centre
  const z = (await view(page)).zoom;
  const grab = await toScreen(page, before.x + before.width / 2, before.y + before.height / 2);
  await startFrames(page);
  const t1 = Date.now();
  await drag(page, grab, { x: grab.x + 150, y: grab.y + 90 }, { steps: 30 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const dragMs = Date.now() - t1;
  const mv = await stopFrames(page);
  const after = (await els(page)).find((e) => e.id === firstSel)!;
  // (object snapping may adjust the delta by up to SNAP_DISTANCE_PX / zoom)
  expect(Math.abs(after.x - before.x - 150 / z)).toBeLessThanOrEqual(6 / z + 0.5);

  // ---- all 2000 on screen (zoom to fit), pan again
  await pressKey(page, 'Escape');
  await pressKey(page, 'Shift+Digit1');
  await page.mouse.move(700, 450);
  await startFrames(page);
  for (let i = 0; i < 30; i++) await page.mouse.wheel(i % 2 ? 30 : -30, 0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const panAll = await stopFrames(page);

  // ---- responsiveness: a trivial evaluate round-trip is fast
  const t2 = Date.now();
  await page.evaluate(() => 1);
  const rtt = Date.now() - t2;

  const report = { elements: N, zoom: +z.toFixed(2), selected, panMs, pan, dragMs, drag: mv, fitZoom: (await view(page)).zoom, panAll, rtt };
  console.log('[perf]', JSON.stringify(report, (_, x) => (typeof x === 'number' ? Math.round(x * 10) / 10 : x)));
  expect(pan.avg).toBeLessThan(200);
  expect(mv.avg).toBeLessThan(200);
  expect(panAll.avg).toBeLessThan(200);
  expect(rtt).toBeLessThan(500);
});
