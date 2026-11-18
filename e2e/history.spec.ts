import { test, expect, type Page } from '@playwright/test';
import { openApp, els, drag, drawRect, byId, pressKey, history, handlePos, toScreen } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

const undoKey = (page: Page) => pressKey(page, 'Control+z');
const redoKey = (page: Page) => pressKey(page, 'Control+Shift+z');
const undoBtn = (page: Page) => page.getByTestId('undo').click();
const redoBtn = (page: Page) => page.getByTestId('redo').click();

test('undo/redo create via keyboard and buttons', async ({ page }) => {
  await expect(page.getByTestId('undo')).toBeDisabled();
  await drawRect(page, 300, 300, 400, 400);
  await drawRect(page, 500, 300, 600, 400);
  expect((await history(page)).undo).toBe(2);
  await undoKey(page);
  expect(await els(page)).toHaveLength(1);
  await undoBtn(page);
  expect(await els(page)).toHaveLength(0);
  await expect(page.getByTestId('undo')).toBeDisabled();
  await redoBtn(page);
  expect(await els(page)).toHaveLength(1);
  await redoKey(page);
  expect(await els(page)).toHaveLength(2);
  await expect(page.getByTestId('redo')).toBeDisabled();
  // Ctrl+Y also redoes
  await undoKey(page);
  await pressKey(page, 'Control+y');
  expect(await els(page)).toHaveLength(2);
});

test('a drag with many pointer moves is ONE history entry (move)', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 400, 400);
  const h0 = (await history(page)).undo;
  const c = await toScreen(page, 350, 350);
  await drag(page, c, { x: c.x + 200, y: c.y + 100 }, { steps: 40 });
  expect((await history(page)).undo).toBe(h0 + 1);
  expect((await byId(page, r.id))!.x).toBeCloseTo(500, 0);
  await undoKey(page);
  const e = (await byId(page, r.id))!;
  expect(e.x).toBe(300);
  expect(e.y).toBe(300);
  expect(await els(page)).toHaveLength(1); // the creation is not undone too
  await redoBtn(page);
  expect((await byId(page, r.id))!.x).toBeCloseTo(500, 0);
});

test('drawing with many moves is one entry', async ({ page }) => {
  await pressKey(page, 'p');
  await page.mouse.move(300, 300);
  await page.mouse.down();
  for (let i = 0; i < 30; i++) await page.mouse.move(300 + i * 8, 300 + Math.sin(i / 3) * 40);
  await page.mouse.up();
  expect((await history(page)).undo).toBe(1);
  await undoKey(page);
  expect(await els(page)).toHaveLength(0);
});

test('undo resize', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 400, 400);
  const se = await handlePos(page, r.id, 'se');
  await drag(page, se, { x: se.x + 80, y: se.y + 50 }, { steps: 20 });
  expect((await byId(page, r.id))!.width).toBeCloseTo(180, 0);
  await undoKey(page);
  const e = (await byId(page, r.id))!;
  expect(e.width).toBe(100);
  expect(e.height).toBe(100);
});

test('undo delete restores the element; redo deletes again', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 400, 400);
  await pressKey(page, 'Delete');
  expect(await els(page)).toHaveLength(0);
  await undoKey(page);
  expect((await els(page)).map((e) => e.id)).toEqual([r.id]);
  await redoKey(page);
  expect(await els(page)).toHaveLength(0);
});

test('undo style change (one entry per click)', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 400, 400);
  await page.getByRole('button', { name: 'Stroke #e03131' }).click();
  await page.getByTestId('stroke-width-extra').click();
  await expect.poll(async () => (await byId(page, r.id))!.strokeWidth).toBe(4);
  await undoBtn(page);
  let e = (await byId(page, r.id))!;
  expect(e.strokeWidth).toBe(2);
  expect(e.strokeColor).toBe('#e03131');
  await undoBtn(page);
  e = (await byId(page, r.id))!;
  expect(e.strokeColor).toBe('#1e1e1e');
  expect(await els(page)).toHaveLength(1);
});

test('opacity slider drag is one history entry', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 400, 400);
  const h0 = (await history(page)).undo;
  const slider = page.getByTestId('opacity-slider');
  const box = (await slider.boundingBox())!;
  await drag(page, { x: box.x + box.width - 4, y: box.y + box.height / 2 }, { x: box.x + box.width * 0.3, y: box.y + box.height / 2 }, { steps: 15 });
  await expect.poll(async () => (await byId(page, r.id))!.opacity).toBeLessThan(60);
  expect((await history(page)).undo).toBe(h0 + 1);
  await undoKey(page);
  expect((await byId(page, r.id))!.opacity).toBe(100);
});

test('undo group / ungroup', async ({ page }) => {
  await drawRect(page, 300, 300, 400, 400);
  await drawRect(page, 500, 300, 600, 400);
  await pressKey(page, 'Control+a');
  await pressKey(page, 'Control+g');
  expect((await els(page)).every((e) => e.groupIds.length === 1)).toBe(true);
  await undoKey(page);
  expect((await els(page)).every((e) => e.groupIds.length === 0)).toBe(true);
  await redoKey(page);
  expect((await els(page)).every((e) => e.groupIds.length === 1)).toBe(true);
});

test('a new action clears the redo stack', async ({ page }) => {
  await drawRect(page, 300, 300, 400, 400);
  await undoKey(page);
  await expect(page.getByTestId('redo')).toBeEnabled();
  await drawRect(page, 500, 300, 600, 400);
  await expect(page.getByTestId('redo')).toBeDisabled();
});

test('undo a text edit restores the previous text; Ctrl+Z inside the editor does not undo the scene', async ({ page }) => {
  await pressKey(page, 't');
  await page.mouse.click(400, 300);
  await page.keyboard.type('one');
  await page.keyboard.press('Escape');
  const [t] = await els(page);
  await page.mouse.dblclick(t.x + 5, t.y + 5);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type(' two');
  await page.keyboard.press('Control+z'); // native textarea undo only
  expect(await els(page)).toHaveLength(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const edited = (await els(page))[0].text;
  expect(edited?.startsWith('one')).toBe(true);
  if (edited !== 'one') {
    await pressKey(page, 'Control+z');
    expect((await els(page))[0].text).toBe('one');
  }
});
