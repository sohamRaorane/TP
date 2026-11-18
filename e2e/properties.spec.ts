import { test, expect } from '@playwright/test';
import { openApp, els, view, drawRect, byId, pressKey } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('change every style property of a selected rectangle via the panel', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 450, 400);
  const panel = page.getByTestId('properties-panel');
  await expect(panel).toBeVisible();

  await panel.getByRole('button', { name: 'Stroke #e03131' }).click();
  await expect.poll(async () => (await byId(page, r.id))!.strokeColor).toBe('#e03131');

  await panel.getByRole('button', { name: 'Background #a5d8ff' }).click();
  await expect.poll(async () => (await byId(page, r.id))!.backgroundColor).toBe('#a5d8ff');

  // fill appears once there is a background
  await panel.getByTestId('fill-solid').click();
  await expect.poll(async () => (await byId(page, r.id))!.fillStyle).toBe('solid');
  await panel.getByTestId('fill-cross-hatch').click();
  await expect.poll(async () => (await byId(page, r.id))!.fillStyle).toBe('cross-hatch');

  await panel.getByTestId('stroke-width-extra').click();
  await expect.poll(async () => (await byId(page, r.id))!.strokeWidth).toBe(4);

  await panel.getByRole('radiogroup', { name: 'Stroke style' }).getByRole('radio', { name: 'Dashed' }).click();
  await expect.poll(async () => (await byId(page, r.id))!.strokeStyle).toBe('dashed');

  await panel.getByRole('radiogroup', { name: 'Sloppiness' }).getByRole('radio', { name: 'Architect' }).click();
  await expect.poll(async () => (await byId(page, r.id))!.roughness).toBe(0);

  // opacity via keyboard on the slider (each step = 10)
  const slider = panel.getByTestId('opacity-slider');
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await byId(page, r.id))!.opacity).toBe(70);

  // the radio state reflects the element
  await expect(panel.getByTestId('stroke-width-extra')).toHaveAttribute('aria-checked', 'true');
  // still a single element and still selected
  expect(await els(page)).toHaveLength(1);
  expect((await view(page)).selectedIds).toEqual([r.id]);
  await page.screenshot({ path: '/tmp/e2e-shots/properties.png' });
});

test('opacity slider via mouse drag', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 450, 400);
  const slider = page.getByTestId('opacity-slider');
  const box = (await slider.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect.poll(async () => (await byId(page, r.id))!.opacity).toBeLessThan(70);
  await expect.poll(async () => (await byId(page, r.id))!.opacity).toBeGreaterThan(30);
});

test('custom color via hex input in the color picker', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 450, 400);
  await page.getByRole('button', { name: /Stroke color: .* Open color picker/ }).click();
  const picker = page.getByTestId('color-picker');
  await expect(picker).toBeVisible();
  await picker.getByTestId('hex-input').fill('12ab34');
  await expect.poll(async () => (await byId(page, r.id))!.strokeColor).toBe('#12ab34');
});

test('style changes on the tool apply to the next element', async ({ page }) => {
  await pressKey(page, 'o');
  await page.getByTestId('properties-panel').getByRole('button', { name: 'Stroke #2f9e44' }).click();
  await pressKey(page, 'o');
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(400, 400, { steps: 5 });
  await page.mouse.up();
  const [e] = await els(page);
  expect(e.type).toBe('ellipse');
  expect(e.strokeColor).toBe('#2f9e44');
});

test('layer buttons change z-order', async ({ page }) => {
  const a = await drawRect(page, 300, 300, 400, 400);
  const b = await drawRect(page, 350, 350, 450, 450);
  const c = await drawRect(page, 400, 400, 500, 500);
  const order = async () => (await els(page)).map((e) => e.id);
  expect(await order()).toEqual([a.id, b.id, c.id]);
  // c is selected
  await page.getByTestId('layer-back').click();
  await expect.poll(order).toEqual([c.id, a.id, b.id]);
  await page.getByTestId('layer-forward').click();
  await expect.poll(order).toEqual([a.id, c.id, b.id]);
  await page.getByTestId('layer-front').click();
  await expect.poll(order).toEqual([a.id, b.id, c.id]);
  await page.getByTestId('layer-backward').click();
  await expect.poll(order).toEqual([a.id, c.id, b.id]);
  // keyboard: Ctrl+Shift+] brings to front
  await pressKey(page, 'Control+Shift+]');
  await expect.poll(order).toEqual([a.id, b.id, c.id]);
});

test('multi-selection with mixed values shows mixed state and applies to all', async ({ page }) => {
  const a = await drawRect(page, 300, 300, 400, 400);
  await drawRect(page, 500, 300, 600, 400);
  // (style changes also become the default for new elements, so recolor b only)
  await page.getByRole('button', { name: 'Stroke #e03131' }).click();
  await pressKey(page, 'Control+a');
  await expect(page.getByRole('button', { name: /Stroke color: mixed/ })).toBeVisible();
  await page.getByRole('button', { name: 'Stroke #1971c2' }).click();
  await expect.poll(async () => (await els(page)).map((e) => e.strokeColor)).toEqual(['#1971c2', '#1971c2']);
  expect(a).toBeTruthy();
});
