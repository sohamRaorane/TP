import { test, expect, type Page } from '@playwright/test';
import { openApp, els, view, drag, pressKey, drawRect, handlePos, toScreen, byId, close } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** two rectangles with a solid background so their interiors are hittable */
async function twoRects(page: Page) {
  const a = await drawRect(page, 300, 300, 400, 380);
  const b = await drawRect(page, 600, 300, 700, 380);
  await pressKey(page, 'Escape');
  return { a, b };
}

const sel = async (page: Page) => (await view(page)).selectedIds.sort();

test('click selects, click on empty canvas deselects, shift-click multi-selects', async ({ page }) => {
  const { a, b } = await twoRects(page);
  expect(await sel(page)).toEqual([]);
  // click on the stroke of a transparent rectangle
  await page.mouse.click(300, 340);
  expect(await sel(page)).toEqual([a.id]);
  await page.keyboard.down('Shift');
  await page.mouse.click(600, 340);
  await page.keyboard.up('Shift');
  expect(await sel(page)).toEqual([a.id, b.id].sort());
  // shift-click again toggles off
  await page.keyboard.down('Shift');
  await page.mouse.click(600, 340);
  await page.keyboard.up('Shift');
  expect(await sel(page)).toEqual([a.id]);
  await page.mouse.click(900, 700);
  expect(await sel(page)).toEqual([]);
});

test('box selection selects fully enclosed elements only', async ({ page }) => {
  const { a, b } = await twoRects(page);
  const c = await drawRect(page, 300, 500, 400, 580);
  await pressKey(page, 'Escape');
  await drag(page, { x: 250, y: 250 }, { x: 750, y: 420 });
  expect(await sel(page)).toEqual([a.id, b.id].sort());
  expect(c).toBeTruthy();
});

test('drag moves the element by the drag delta / zoom', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 400, 380);
  // zoom in twice so that screen delta != scene delta
  await pressKey(page, 'Control+=');
  await pressKey(page, 'Control+=');
  const z = (await view(page)).zoom;
  expect(z).toBeGreaterThan(1.05);
  const before = (await byId(page, r.id))!;
  // selected elements are hittable in their interior (edge midpoints are resize handles)
  const c = await toScreen(page, before.x + before.width / 2, before.y + before.height / 2);
  await drag(page, c, { x: c.x + 120, y: c.y + 60 }, { steps: 12 });
  const after = (await byId(page, r.id))!;
  expect(after.x - before.x).toBeCloseTo(120 / z, 0);
  expect(after.y - before.y).toBeCloseTo(60 / z, 0);
  expect(after.width).toBe(before.width);
});

test('resize via SE handle; Shift keeps aspect ratio', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 400, 350); // 100x50, still selected
  const se = await handlePos(page, r.id, 'se');
  await drag(page, se, { x: se.x + 60, y: se.y + 40 });
  let e = (await byId(page, r.id))!;
  expect(e.x).toBeCloseTo(300, 0);
  expect(e.width).toBeCloseTo(160, 0);
  expect(e.height).toBeCloseTo(90, 0);

  const se2 = await handlePos(page, r.id, 'se');
  await page.keyboard.down('Shift');
  await drag(page, se2, { x: se2.x + 80, y: se2.y + 5 });
  await page.keyboard.up('Shift');
  e = (await byId(page, r.id))!;
  expect(e.width / e.height).toBeCloseTo(160 / 90, 1);
  expect(e.width).toBeGreaterThan(200);
});

test('rotate via the rotation handle', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 400, 400);
  const rot = await handlePos(page, r.id, 'rotation');
  const c = await toScreen(page, 350, 350);
  // drag the handle from 12 o'clock to 3 o'clock -> +90 degrees (clockwise)
  await drag(page, rot, { x: c.x + 120, y: c.y }, { steps: 15 });
  const e = (await byId(page, r.id))!;
  expect(e.angle).toBeCloseTo(Math.PI / 2, 1);
  // geometry (center) is preserved
  expect(e.x + e.width / 2).toBeCloseTo(350, 0);
});

test('arrow keys move the selection (Shift = 10)', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 400, 380);
  await pressKey(page, 'ArrowRight');
  await pressKey(page, 'ArrowRight');
  await pressKey(page, 'ArrowDown');
  await pressKey(page, 'Shift+ArrowLeft');
  const e = (await byId(page, r.id))!;
  expect(e.x).toBeCloseTo(300 + 2 - 10, 5);
  expect(e.y).toBeCloseTo(301, 5);
});

test('delete, Ctrl+D duplicate and Ctrl+A select all', async ({ page }) => {
  const { a } = await twoRects(page);
  await page.mouse.click(300, 340);
  await pressKey(page, 'Control+d');
  let all = await els(page);
  expect(all).toHaveLength(3);
  const dup = all[2];
  expect(dup.id).not.toBe(a.id);
  expect(dup.width).toBe(a.width);
  expect(dup.x !== a.x || dup.y !== a.y).toBe(true); // offset like Excalidraw
  expect(await sel(page)).toEqual([dup.id]); // duplicate becomes the selection

  await pressKey(page, 'Control+a');
  expect((await sel(page)).length).toBe(3);

  await pressKey(page, 'Delete');
  all = await els(page);
  expect(all).toHaveLength(0);
  expect(await sel(page)).toEqual([]);
});

test('Backspace deletes too', async ({ page }) => {
  await drawRect(page, 300, 300, 400, 380);
  await pressKey(page, 'Backspace');
  expect(await els(page)).toHaveLength(0);
});

test('group with Ctrl+G: clicking a member selects the group; ungroup', async ({ page }) => {
  const { a, b } = await twoRects(page);
  await pressKey(page, 'Control+a');
  await pressKey(page, 'Control+g');
  let all = await els(page);
  expect(all[0].groupIds).toHaveLength(1);
  expect(all[1].groupIds).toEqual(all[0].groupIds);
  await page.mouse.click(900, 700);
  expect(await sel(page)).toEqual([]);
  await page.mouse.click(300, 340); // click only A
  expect(await sel(page)).toEqual([a.id, b.id].sort());
  // dragging A drags the whole group
  const bBefore = (await byId(page, b.id))!;
  await drag(page, { x: 300, y: 320 }, { x: 340, y: 360 }); // stroke, away from the w handle
  const bAfter = (await byId(page, b.id))!;
  expect(bAfter.x - bBefore.x).toBeCloseTo(40, 0);

  await pressKey(page, 'Control+Shift+g');
  all = await els(page);
  expect(all.every((e) => e.groupIds.length === 0)).toBe(true);
  await page.mouse.click(900, 700);
  const aNow = (await byId(page, a.id))!;
  const p = await toScreen(page, aNow.x, aNow.y + aNow.height / 2);
  await page.mouse.click(p.x, p.y);
  expect(await sel(page)).toEqual([a.id]);
});

test('locked element cannot be moved', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 400, 380);
  await pressKey(page, 'Control+Shift+l');
  await expect.poll(async () => (await byId(page, r.id))!.locked).toBe(true);
  await page.mouse.click(900, 700);
  await drag(page, { x: 300, y: 340 }, { x: 420, y: 420 });
  const e = (await byId(page, r.id))!;
  expect(e.x).toBe(300);
  expect(e.y).toBe(300);
  // also cannot be moved with arrow keys after Ctrl+A
  await pressKey(page, 'Control+a');
  await pressKey(page, 'ArrowRight');
  expect((await byId(page, r.id))!.x).toBe(300);
});

test('Escape clears the selection', async ({ page }) => {
  await drawRect(page, 300, 300, 400, 380);
  expect((await sel(page)).length).toBe(1);
  await pressKey(page, 'Escape');
  expect(await sel(page)).toEqual([]);
  expect(close(1, 1)).toBe(true);
});
