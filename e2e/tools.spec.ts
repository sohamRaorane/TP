import { test, expect } from '@playwright/test';
import { openApp, els, view, drag, pressKey, tool, typesOf } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

const SHAPES: Array<{ type: string; key: string }> = [
  { type: 'rectangle', key: 'r' },
  { type: 'diamond', key: 'd' },
  { type: 'ellipse', key: 'o' },
  { type: 'arrow', key: 'a' },
  { type: 'line', key: 'l' },
  { type: 'freedraw', key: 'p' },
];

test('draw every shape via keyboard shortcuts; tool returns to selection', async ({ page }) => {
  let x = 200;
  for (const s of SHAPES) {
    await pressKey(page, s.key);
    await expect.poll(async () => (await view(page)).activeTool).toBe(s.type);
    await drag(page, { x, y: 250 }, { x: x + 90, y: 340 }, { steps: 10 });
    const v = await view(page);
    // freedraw (like Excalidraw) keeps the pen active; all others return to selection
    if (s.type === 'freedraw') expect(v.activeTool).toBe('freedraw');
    else expect(v.activeTool).toBe('selection');
    const all = await els(page);
    const last = all[all.length - 1];
    expect(last.type).toBe(s.type);
    expect(last.width).toBeGreaterThan(50);
    expect(last.height).toBeGreaterThan(50);
    x += 130;
  }
  expect(await typesOf(page)).toEqual(SHAPES.map((s) => s.type));
  await page.screenshot({ path: '/tmp/e2e-shots/tools-shapes.png' });
  // V returns to selection
  await pressKey(page, 'v');
  await expect.poll(async () => (await view(page)).activeTool).toBe('selection');
});

test('draw every shape via toolbar clicks', async ({ page }) => {
  let x = 200;
  for (const s of SHAPES) {
    await tool(page, s.type).click();
    await expect(tool(page, s.type)).toHaveAttribute('aria-checked', 'true');
    await drag(page, { x, y: 450 }, { x: x + 80, y: 530 }, { steps: 10 });
    x += 120;
  }
  expect(await typesOf(page)).toEqual(SHAPES.map((s) => s.type));
  // toolbar reflects the active tool after drawing a rectangle
  await tool(page, 'rectangle').click();
  await drag(page, { x: 300, y: 650 }, { x: 380, y: 720 });
  await expect(tool(page, 'selection')).toHaveAttribute('aria-checked', 'true');
  await expect(tool(page, 'rectangle')).toHaveAttribute('aria-checked', 'false');
});

test('numeric shortcuts select tools', async ({ page }) => {
  const map: Record<string, string> = { '2': 'rectangle', '3': 'diamond', '4': 'ellipse', '5': 'arrow', '6': 'line', '7': 'freedraw', '8': 'text', '1': 'selection' };
  for (const [k, t] of Object.entries(map)) {
    await pressKey(page, k);
    await expect.poll(async () => (await view(page)).activeTool).toBe(t);
  }
});

test('text tool: type multi-line text and commit', async ({ page }) => {
  await pressKey(page, 't');
  await expect.poll(async () => (await view(page)).activeTool).toBe('text');
  await page.mouse.click(400, 300);
  const editor = page.getByTestId('text-editor');
  await expect(editor).toBeVisible();
  await page.keyboard.type('Hello');
  await page.keyboard.press('Enter');
  await page.keyboard.type('World');
  await page.screenshot({ path: '/tmp/e2e-shots/tools-text-editing.png' });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: '/tmp/e2e-shots/tools-text.png' });
  await expect(editor).toBeHidden();
  const all = await els(page);
  expect(all).toHaveLength(1);
  expect(all[0].type).toBe('text');
  expect(all[0].text).toBe('Hello\nWorld');
  expect(all[0].height).toBeGreaterThan(all[0].fontSize! * 1.5); // two lines tall
  expect((await view(page)).activeTool).toBe('selection');
});

test('text via toolbar button; committing by clicking elsewhere', async ({ page }) => {
  await tool(page, 'text').click();
  await page.mouse.click(500, 400);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('Clicked away');
  await page.mouse.click(900, 700);
  await expect(page.getByTestId('text-editor')).toBeHidden();
  const all = await els(page);
  expect(all.map((e) => e.text)).toEqual(['Clicked away']);
});

test('empty text is discarded', async ({ page }) => {
  await pressKey(page, 't');
  await page.mouse.click(400, 300);
  await expect(page.getByTestId('text-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('text-editor')).toBeHidden();
  expect(await els(page)).toHaveLength(0);
});

test('tool lock keeps the tool active (button and Q)', async ({ page }) => {
  await page.getByTestId('tool-lock').click();
  await expect(page.getByTestId('tool-lock')).toHaveAttribute('aria-pressed', 'true');
  await pressKey(page, 'r');
  await drag(page, { x: 200, y: 200 }, { x: 280, y: 280 });
  await drag(page, { x: 320, y: 200 }, { x: 400, y: 280 });
  expect((await view(page)).activeTool).toBe('rectangle');
  expect(await typesOf(page)).toEqual(['rectangle', 'rectangle']);
  // Q toggles it off again
  await pressKey(page, 'q');
  await expect(page.getByTestId('tool-lock')).toHaveAttribute('aria-pressed', 'false');
  await pressKey(page, 'o');
  await drag(page, { x: 500, y: 200 }, { x: 580, y: 280 });
  expect((await view(page)).activeTool).toBe('selection');
});

test('a click without drag does not create a zero-size shape', async ({ page }) => {
  await pressKey(page, 'r');
  await page.mouse.click(300, 300);
  const all = await els(page);
  expect(all.filter((e) => e.width < 2 || e.height < 2)).toHaveLength(0);
});

test('shift constrains rectangle to a square', async ({ page }) => {
  await pressKey(page, 'r');
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(420, 360, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const [r] = await els(page);
  expect(Math.round(r.width)).toBe(Math.round(r.height));
});
