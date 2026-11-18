import { test, expect } from '@playwright/test';
import { openApp, els, view, drag, drawRect, pressKey, toScene, toScreen } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('ctrl+wheel zooms centered at the cursor (scene point stays within 1px)', async ({ page }) => {
  await drawRect(page, 300, 300, 400, 400);
  const cursor = { x: 640, y: 420 };
  await page.mouse.move(cursor.x, cursor.y);
  const scenePt = await toScene(page, cursor.x, cursor.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await view(page)).zoom).toBeGreaterThan(1.3);
  let back = await toScreen(page, scenePt.x, scenePt.y);
  expect(Math.abs(back.x - cursor.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(back.y - cursor.y)).toBeLessThanOrEqual(1);

  // zoom out at a different point
  const c2 = { x: 300, y: 600 };
  await page.mouse.move(c2.x, c2.y);
  const p2 = await toScene(page, c2.x, c2.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await view(page)).zoom).toBeLessThan(1);
  back = await toScreen(page, p2.x, p2.y);
  expect(Math.abs(back.x - c2.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(back.y - c2.y)).toBeLessThanOrEqual(1);
  // elements keep their world position
  const [r] = await els(page);
  expect([r.x, r.y, r.width]).toEqual([300, 300, 100]);
});

test('plain wheel pans; shift+wheel pans horizontally', async ({ page }) => {
  const v0 = await view(page);
  // (stay away from the centered welcome-screen menu on an empty canvas)
  await page.mouse.move(1000, 650);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await view(page)).scrollY).toBeCloseTo(v0.scrollY - 120, 0);
  expect((await view(page)).zoom).toBe(1);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 80);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await view(page)).scrollX).toBeCloseTo(v0.scrollX - 80, 0);
});

test('zoom buttons, percentage reset and keyboard', async ({ page }) => {
  await page.getByTestId('zoom-in').click();
  const z1 = (await view(page)).zoom;
  expect(z1).toBeGreaterThan(1);
  await expect(page.getByTestId('zoom-reset')).toHaveText(`${Math.round(z1 * 100)}%`);
  await page.getByTestId('zoom-in').click();
  expect((await view(page)).zoom).toBeGreaterThan(z1);
  await page.getByTestId('zoom-out').click();
  await page.getByTestId('zoom-out').click();
  await page.getByTestId('zoom-out').click();
  expect((await view(page)).zoom).toBeLessThan(1);
  await page.getByTestId('zoom-reset').click();
  expect((await view(page)).zoom).toBe(1);
  await expect(page.getByTestId('zoom-reset')).toHaveText('100%');
  await pressKey(page, 'Control+=');
  expect((await view(page)).zoom).toBeGreaterThan(1);
  await pressKey(page, 'Control+0');
  expect((await view(page)).zoom).toBe(1);
});

test('zoom buttons keep the viewport center fixed', async ({ page }) => {
  const box = (await page.getByTestId('canvas-interactive').boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const p = await toScene(page, center.x, center.y);
  await page.getByTestId('zoom-in').click();
  await page.getByTestId('zoom-in').click();
  const back = await toScreen(page, p.x, p.y);
  expect(Math.abs(back.x - center.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(back.y - center.y)).toBeLessThanOrEqual(1);
});

test('fit to screen brings all elements into view', async ({ page }) => {
  await drawRect(page, 200, 200, 300, 300);
  await drawRect(page, 900, 600, 1000, 700);
  // pan far away
  await page.mouse.move(600, 400);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await view(page)).scrollY).toBeLessThan(-3000);
  const box = (await page.getByTestId('canvas-interactive').boundingBox())!;
  const allInView = async () => {
    for (const e of await els(page)) {
      const a = await toScreen(page, e.x, e.y);
      const b = await toScreen(page, e.x + e.width, e.y + e.height);
      if (a.x < box.x || a.y < box.y || b.x > box.x + box.width || b.y > box.y + box.height) return false;
    }
    return true;
  };
  expect(await allInView()).toBe(false);
  await page.getByTestId('zoom-fit').click();
  expect(await allInView()).toBe(true);
  // pan away again, then Shift+1 does the same
  await page.mouse.move(1000, 650);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);
  await expect.poll(allInView).toBe(false);
  await pressKey(page, 'Shift+Digit1');
  await expect.poll(allInView).toBe(true);
});

test('space + drag pans; elements keep world positions', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 400, 400);
  await pressKey(page, 'Escape');
  const v0 = await view(page);
  await page.mouse.move(700, 500);
  await page.keyboard.down('Space');
  await drag(page, { x: 700, y: 500 }, { x: 600, y: 450 }, { steps: 10 });
  await page.keyboard.up('Space');
  const v1 = await view(page);
  expect(v1.scrollX - v0.scrollX).toBeCloseTo(-100, 0);
  expect(v1.scrollY - v0.scrollY).toBeCloseTo(-50, 0);
  const [e] = await els(page);
  expect([e.x, e.y]).toEqual([r.x, r.y]);
  expect(await els(page)).toHaveLength(1); // no selection box / no new element
  expect((await view(page)).selectedIds).toEqual([]);
});

test('middle-button drag pans even with a drawing tool active', async ({ page }) => {
  await pressKey(page, 'r');
  const v0 = await view(page);
  await drag(page, { x: 600, y: 400 }, { x: 680, y: 460 }, { button: 'middle' });
  const v1 = await view(page);
  expect(v1.scrollX - v0.scrollX).toBeCloseTo(80, 0);
  expect(v1.scrollY - v0.scrollY).toBeCloseTo(60, 0);
  // no shape is drawn (text pasted from the X11 primary selection is covered by the next test)
  expect((await els(page)).filter((e) => e.type !== 'text')).toHaveLength(0);
  expect(v1.activeTool).toBe('rectangle');
});

// PRODUCT BUG (Linux): a middle-button pan also triggers Chrome's X11 "primary selection" paste,
// which the document paste handler (services/clipboard.ts) turns into a text element.
test('middle-button pan does not paste the primary selection', async ({ page }) => {
  test.fail();
  await page.getByTestId('drawing-name').click();
  await page.getByTestId('drawing-name-input').selectText(); // puts "Untitled drawing" in PRIMARY
  await page.getByTestId('drawing-name-input').press('Escape');
  await drag(page, { x: 1000, y: 650 }, { x: 1080, y: 700 }, { button: 'middle' });
  await page.waitForTimeout(300); // paste would arrive right after the mouseup
  expect(await els(page)).toHaveLength(0);
});

test('hand tool pans', async ({ page }) => {
  await pressKey(page, 'h');
  const v0 = await view(page);
  await drag(page, { x: 1000, y: 650 }, { x: 900, y: 550 });
  const v1 = await view(page);
  expect(v1.scrollX - v0.scrollX).toBeCloseTo(-100, 0);
  expect(await els(page)).toHaveLength(0);
});

test('pan with zoom: screen delta / zoom', async ({ page }) => {
  await page.getByTestId('zoom-in').click();
  await page.getByTestId('zoom-in').click();
  const v0 = await view(page);
  await drag(page, { x: 1000, y: 650 }, { x: 1100, y: 650 }, { button: 'middle' });
  const v1 = await view(page);
  expect(v1.scrollX - v0.scrollX).toBeCloseTo(100 / v0.zoom, 1);
});
