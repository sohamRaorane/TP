import { test, expect } from '@playwright/test';
import { openApp, els, view, drag, drawRect, pressKey, toScreen, byId } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('dark mode toggle via the main menu (and Alt+Shift+D)', async ({ page }) => {
  const root = page.locator('.sb-root');
  await expect(root).toHaveAttribute('data-theme', 'light');
  const bgLight = await page.evaluate(() => getComputedStyle(document.querySelector('.sb-island')!).backgroundColor);
  await page.getByTestId('main-menu-button').click();
  await page.getByTestId('menu-theme').click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveClass(/dark/);
  const bgDark = await page.evaluate(() => getComputedStyle(document.querySelector('.sb-island')!).backgroundColor);
  expect(bgDark).not.toBe(bgLight);
  await drawRect(page, 300, 300, 400, 400);
  await page.screenshot({ path: '/tmp/e2e-shots/extras-dark.png' });
  await pressKey(page, 'Escape');
  await pressKey(page, 'Alt+Shift+D');
  await expect(root).toHaveAttribute('data-theme', 'light');
});

test('command palette opens with Ctrl+K, filters and runs an action', async ({ page }) => {
  await pressKey(page, 'Control+k');
  const input = page.getByTestId('command-palette-input');
  await expect(input).toBeFocused();
  await input.fill('dark');
  await expect(page.getByRole('option').first()).toContainText(/dark/i);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('command-palette')).toBeHidden();
  expect((await view(page)).theme).toBe('dark');
  // run a tool command
  await pressKey(page, 'Control+k');
  await page.getByTestId('command-palette-input').fill('ellipse');
  await page.getByRole('option', { name: /Ellipse/ }).first().click();
  expect((await view(page)).activeTool).toBe('ellipse');
});

test('library: add selection, then insert it', async ({ page }) => {
  await drawRect(page, 300, 300, 400, 400);
  await page.getByTestId('library-button').click();
  const sidebar = page.getByTestId('library-sidebar');
  await expect(sidebar).toBeVisible();
  await sidebar.getByTestId('library-add-selected').click();
  const grid = sidebar.getByTestId('library-grid');
  const items = grid.getByRole('button', { name: /^Insert / });
  await expect(items).toHaveCount(1);
  await items.first().click();
  await expect.poll(async () => (await els(page)).length).toBe(2);
  const all = await els(page);
  expect(all[1].type).toBe('rectangle');
  expect(all[1].id).not.toBe(all[0].id);
  // library persists in localStorage across reloads
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__sketch);
  await page.getByTestId('library-button').click();
  await expect(page.getByTestId('library-grid').getByRole('button', { name: /^Insert / })).toHaveCount(1);
});

test('text to diagram creates shapes and arrows', async ({ page }) => {
  await page.getByTestId('main-menu-button').click();
  await page.getByRole('menuitem', { name: /Text to diagram/ }).click();
  const input = page.getByTestId('text-to-diagram-input');
  await input.fill('A[Start] --> B{Ok?}');
  await page.getByTestId('text-to-diagram-insert').click();
  await expect(page.getByTestId('text-to-diagram-dialog')).toBeHidden();
  const all = await els(page);
  const types = all.map((e) => e.type);
  expect(types.filter((t) => t === 'rectangle')).toHaveLength(1);
  expect(types.filter((t) => t === 'diamond')).toHaveLength(1);
  expect(types.filter((t) => t === 'arrow')).toHaveLength(1);
  const labels = all.filter((e) => e.type === 'text').map((e) => e.text);
  expect(labels.sort()).toEqual(['Ok?', 'Start']);
  await page.screenshot({ path: '/tmp/e2e-shots/extras-t2d.png' });
});

test('text to diagram: syntax error is shown, nothing inserted', async ({ page }) => {
  await page.getByTestId('main-menu-button').click();
  await page.getByRole('menuitem', { name: /Text to diagram/ }).click();
  await page.getByTestId('text-to-diagram-input').fill('A[Start --> ');
  await page.getByTestId('text-to-diagram-insert').click();
  await expect(page.getByTestId('text-to-diagram-dialog').getByRole('alert')).toBeVisible();
  expect(await els(page)).toHaveLength(0);
});

test('frames + presentation mode: next / prev / exit', async ({ page }) => {
  for (const x of [200, 700]) {
    await pressKey(page, 'f');
    await drag(page, { x, y: 250 }, { x: x + 300, y: 450 });
  }
  await drawRect(page, 250, 300, 350, 400); // inside frame 1
  const frames = (await els(page)).filter((e) => e.type === 'frame');
  expect(frames).toHaveLength(2);
  await pressKey(page, 'Escape');
  await page.getByTestId('main-menu-button').click();
  await page.getByRole('menuitem', { name: /Present frames/ }).click();
  const bar = page.getByTestId('presentation-bar');
  await expect(bar).toBeVisible();
  expect((await view(page)).presentation).toEqual({ active: true, frameIndex: 0 });
  await expect(page.getByTestId('toolbar')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/e2e-shots/extras-presentation.png' });
  await bar.getByRole('button', { name: /Next slide/ }).click();
  expect((await view(page)).presentation.frameIndex).toBe(1);
  await pressKey(page, 'ArrowLeft');
  expect((await view(page)).presentation.frameIndex).toBe(0);
  await pressKey(page, 'ArrowRight');
  expect((await view(page)).presentation.frameIndex).toBe(1);
  // the current frame is in view
  const f = frames.sort((p, q) => p.x - q.x)[1];
  const a = await toScreen(page, f.x, f.y);
  const b = await toScreen(page, f.x + f.width, f.y + f.height);
  expect(a.x).toBeGreaterThanOrEqual(0);
  expect(b.x).toBeLessThanOrEqual(1400);
  await page.getByTestId('presentation-exit').click();
  await expect(bar).toBeHidden();
  await expect(page.getByTestId('toolbar')).toBeVisible();
  expect((await view(page)).viewModeEnabled).toBe(false);
});

test('laser pointer does not create elements', async ({ page }) => {
  await drawRect(page, 300, 300, 400, 400);
  await pressKey(page, 'k');
  expect((await view(page)).activeTool).toBe('laser');
  await drag(page, { x: 500, y: 300 }, { x: 700, y: 500 }, { steps: 20 });
  await drag(page, { x: 350, y: 350 }, { x: 600, y: 350 }, { steps: 20 });
  const all = await els(page);
  expect(all).toHaveLength(1);
  expect(all[0].x).toBe(300);
});

test('eraser deletes elements it passes over (and undo restores)', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 400, 400);
  const r2 = await drawRect(page, 600, 300, 700, 400);
  await pressKey(page, 'e');
  // swipe across the left edge of r only
  await drag(page, { x: 280, y: 350 }, { x: 320, y: 350 }, { steps: 10 });
  await expect.poll(async () => (await els(page)).map((e) => e.id)).toEqual([r2.id]);
  await pressKey(page, 'Control+z');
  await expect.poll(async () => (await els(page)).map((e) => e.id).sort()).toEqual([r.id, r2.id].sort());
});

test('minimap toggles via the footer button', async ({ page }) => {
  await expect(page.getByTestId('minimap')).toHaveCount(0);
  await page.getByTestId('minimap-toggle').click();
  await expect(page.getByTestId('minimap')).toBeVisible();
  await drawRect(page, 300, 300, 400, 400);
  await page.screenshot({ path: '/tmp/e2e-shots/extras-minimap.png' });
  await page.getByTestId('minimap-toggle').click();
  await expect(page.getByTestId('minimap')).toHaveCount(0);
});

// REGRESSION TEST (bug found by e2e, now fixed): Alt+M is advertised (footer tooltip, command palette) but hooks/keyboard.ts has no
// KeyM branch in the Alt shortcuts block (same for Alt+H / Alt+V distribute).
test('Alt+M toggles the minimap', async ({ page }) => {
  await pressKey(page, 'Alt+m');
  await expect(page.getByTestId('minimap')).toBeVisible({ timeout: 2000 });
});

test('Alt+H distributes three shapes horizontally', async ({ page }) => {
  await drawRect(page, 200, 300, 260, 360);
  await drawRect(page, 300, 300, 360, 360);
  await drawRect(page, 600, 300, 660, 360);
  await pressKey(page, 'Control+a');
  await pressKey(page, 'Alt+h');
  const xs = (await els(page)).map((e) => e.x).sort((a, b) => a - b);
  expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1], 0);
});

test('help dialog lists shortcuts', async ({ page }) => {
  await page.getByTestId('help-button').click();
  const dlg = page.getByTestId('help-dialog');
  await expect(dlg).toBeVisible();
  for (const label of ['Rectangle', 'Ellipse', 'Undo', 'Duplicate', 'Zoom in']) await expect(dlg.getByText(label, { exact: true }).first()).toBeVisible();
  expect(await dlg.locator('kbd').count()).toBeGreaterThan(20);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await pressKey(page, '?');
  await expect(dlg).toBeVisible();
});

test('context menu: right-click -> Duplicate, then Delete', async ({ page }) => {
  const r = await drawRect(page, 300, 300, 400, 400);
  await pressKey(page, 'Escape');
  await page.mouse.click(300, 350, { button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  expect((await view(page)).selectedIds).toEqual([r.id]);
  await menu.getByRole('menuitem', { name: /Duplicate/ }).click();
  await expect(menu).toBeHidden();
  expect(await els(page)).toHaveLength(2);
  const dup = (await els(page))[1];
  const p = await toScreen(page, dup.x, dup.y + 25);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await menu.getByRole('menuitem', { name: /^Delete/ }).click();
  expect((await els(page)).map((e) => e.id)).toEqual([r.id]);
  // canvas context menu (empty area) opens and closes with Escape
  await page.mouse.click(900, 650, { button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  expect(await byId(page, r.id)).toBeTruthy();
});

test('copy / paste via keyboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await drawRect(page, 300, 300, 400, 400);
  await pressKey(page, 'Control+c');
  await page.mouse.move(700, 500);
  await pressKey(page, 'Control+v');
  await expect.poll(async () => (await els(page)).length).toBe(2);
});
