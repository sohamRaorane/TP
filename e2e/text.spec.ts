import { test, expect, type Page } from '@playwright/test';
import { openApp, els, view, drag, drawRect, byId, pressKey, toScreen } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

async function createText(page: Page, x: number, y: number, text: string) {
  await pressKey(page, 't');
  await page.mouse.click(x, y);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i) await page.keyboard.press('Enter');
    await page.keyboard.type(lines[i]);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('text-editor')).toBeHidden();
  const all = await els(page);
  return all[all.length - 1];
}

test('create text, then edit it with a double-click', async ({ page }) => {
  const t = await createText(page, 400, 300, 'First');
  expect(t.text).toBe('First');
  const c = await toScreen(page, t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.dblclick(c.x, c.y);
  const editor = page.getByTestId('text-editor');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('First');
  await page.keyboard.press('End');
  await page.keyboard.type(' edited');
  await page.keyboard.press('Enter');
  await page.keyboard.type('line 2');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  const all = await els(page);
  expect(all).toHaveLength(1);
  expect(all[0].id).toBe(t.id);
  expect(all[0].text).toBe('First edited\nline 2');
  expect(all[0].height).toBeGreaterThan(t.height * 1.5);
});

test('Enter on a selected text element starts editing', async ({ page }) => {
  const t = await createText(page, 400, 300, 'Hi');
  expect((await view(page)).selectedIds).toEqual([t.id]);
  await pressKey(page, 'Enter');
  await expect(page.getByTestId('text-editor')).toBeFocused();
  // like Excalidraw the existing text is selected; move the caret to the end first
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Escape');
  expect((await byId(page, t.id))!.text).toBe('Hi!');
});

test('font size change from the panel resizes the text', async ({ page }) => {
  const t = await createText(page, 400, 300, 'Size me');
  const panel = page.getByTestId('properties-panel');
  await panel.getByRole('radiogroup', { name: 'Font size' }).getByRole('radio', { name: 'Extra large' }).click();
  await expect.poll(async () => (await byId(page, t.id))!.fontSize).toBe(36);
  const e = (await byId(page, t.id))!;
  expect(e.width).toBeGreaterThan(t.width * 1.4);
  expect(e.height).toBeGreaterThan(t.height * 1.4);
  await panel.getByRole('radiogroup', { name: 'Font size' }).getByRole('radio', { name: 'Small' }).click();
  await expect.poll(async () => (await byId(page, t.id))!.fontSize).toBe(16);
});

test('double-click on a rectangle adds a bound label that moves with it', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 500, 400);
  await pressKey(page, 'Escape');
  // double-click inside the (transparent) rectangle
  await page.mouse.dblclick(400, 350);
  const editor = page.getByTestId('text-editor');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Label');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  const all = await els(page);
  expect(all).toHaveLength(2);
  const label = all.find((e) => e.type === 'text')!;
  expect(label.text).toBe('Label');
  expect(label.containerId).toBe(r.id);
  const rect = (await byId(page, r.id))!;
  expect(rect.boundElements.map((b) => b.id)).toContain(label.id);
  // label is centered in the container
  expect(label.x + label.width / 2).toBeCloseTo(400, -1);
  expect(label.y + label.height / 2).toBeCloseTo(350, -1);
  await page.screenshot({ path: '/tmp/e2e-shots/text-label.png' });

  // move the container: the label follows
  await page.mouse.click(300, 320);
  expect((await view(page)).selectedIds).toContain(r.id);
  await drag(page, { x: 300, y: 320 }, { x: 400, y: 420 }, { steps: 10 });
  const moved = (await byId(page, r.id))!;
  const lbl = (await byId(page, label.id))!;
  expect(moved.x - rect.x).toBeCloseTo(100, 0);
  expect(lbl.x - label.x).toBeCloseTo(100, 0);
  expect(lbl.y - label.y).toBeCloseTo(100, 0);

  // deleting the container deletes the label
  await pressKey(page, 'Delete');
  expect(await els(page)).toHaveLength(0);
});

test('long label stays inside its container', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 420, 400);
  await pressKey(page, 'Escape');
  await page.mouse.dblclick(360, 350);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('a fairly long label that must wrap');
  await page.keyboard.press('Escape');
  const label = (await els(page)).find((e) => e.type === 'text')!;
  const rect = (await byId(page, r.id))!;
  expect(label.width).toBeLessThanOrEqual(rect.width);
  expect(label.x).toBeGreaterThanOrEqual(rect.x);
  expect(label.x + label.width).toBeLessThanOrEqual(rect.x + rect.width);
});

// REGRESSION TEST (bug found by e2e, now fixed): labels never wrap (wrapText in engine/drawing/textMeasure.ts is unused);
// layoutBoundText widens the container around its center instead.
test('long label wraps to the container width (Excalidraw behaviour)', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 420, 400);
  await pressKey(page, 'Escape');
  await page.mouse.dblclick(360, 350);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('a fairly long label that must wrap');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: '/tmp/e2e-shots/text-wrap.png' });
  const label = (await els(page)).find((e) => e.type === 'text')!;
  const rect = (await byId(page, r.id))!;
  expect(rect.width).toBeCloseTo(120, 0);
  expect(rect.x).toBeCloseTo(300, 0);
  expect(label.height).toBeGreaterThan(label.fontSize! * 2); // several lines
});
