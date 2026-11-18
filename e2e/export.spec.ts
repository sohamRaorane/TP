import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, els, drawRect, pressKey } from './helpers';

async function sampleScene(page: Page) {
  await drawRect(page, 300, 300, 450, 400);
  await page.getByRole('button', { name: 'Background #a5d8ff' }).click();
  await pressKey(page, 'o');
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(620, 400, { steps: 5 });
  await page.mouse.up();
  await pressKey(page, 'a');
  await page.mouse.move(460, 350);
  await page.mouse.down();
  await page.mouse.move(495, 350, { steps: 5 });
  await page.mouse.up();
  await pressKey(page, 't');
  await page.mouse.click(320, 450);
  await page.keyboard.type('Export me');
  await page.keyboard.press('Escape');
  await pressKey(page, 'Escape');
  expect(await els(page)).toHaveLength(4);
}

async function downloadFrom(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: readFileSync(path!) };
}

test('export dialog: PNG download is a real PNG of non-trivial size', async ({ page }) => {
  await openApp(page);
  await sampleScene(page);
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-preview')).toBeVisible();
  await page.waitForTimeout(800); // settle the open animation for the screenshot only
  await page.screenshot({ path: '/tmp/e2e-shots/export-dialog.png' });
  const { name, bytes } = await downloadFrom(page, () => page.getByTestId('export-png').click());
  expect(name).toMatch(/\.png$/);
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.length).toBeGreaterThan(3000);
  // IHDR dimensions roughly match the scene bounds * scale (default 2x?) and are not tiny
  const w = bytes.readUInt32BE(16);
  const h = bytes.readUInt32BE(20);
  expect(w).toBeGreaterThan(200);
  expect(h).toBeGreaterThan(100);
});

test('export dialog: SVG download parses and contains paths and the text', async ({ page }) => {
  await openApp(page);
  await sampleScene(page);
  await page.getByTestId('export-button').click();
  const { name, bytes } = await downloadFrom(page, () => page.getByTestId('export-svg').click());
  expect(name).toMatch(/\.svg$/);
  const svg = bytes.toString('utf8');
  const info = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, 'image/svg+xml');
    return {
      err: doc.querySelector('parsererror')?.textContent ?? null,
      root: doc.documentElement.nodeName,
      paths: doc.querySelectorAll('path').length,
      text: [...doc.querySelectorAll('text')].map((t) => t.textContent).join(' '),
      viewBox: doc.documentElement.getAttribute('viewBox'),
    };
  }, svg);
  expect(info.err).toBeNull();
  expect(info.root).toBe('svg');
  expect(info.paths).toBeGreaterThan(3);
  expect(info.text).toContain('Export me');
  expect(info.viewBox).toBeTruthy();
});

test('save JSON via the menu, import it into a fresh page via the file chooser', async ({ page, browser }) => {
  await openApp(page);
  await sampleScene(page);
  await page.getByTestId('main-menu-button').click();
  const { name, bytes } = await downloadFrom(page, () => page.getByRole('menuitem', { name: /Save to file/ }).click());
  expect(name).toMatch(/\.json$/);
  const json = JSON.parse(bytes.toString('utf8'));
  expect(json.elements.filter((e: { isDeleted: boolean }) => !e.isDeleted)).toHaveLength(4);
  const srcTypes = (await els(page)).map((e) => e.type).sort();

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await openApp(p2);
  expect(await els(p2)).toHaveLength(0);
  await p2.getByTestId('main-menu-button').click();
  const [chooser] = await Promise.all([p2.waitForEvent('filechooser'), p2.getByRole('menuitem', { name: /Open file/ }).click()]);
  await chooser.setFiles({ name, mimeType: 'application/json', buffer: bytes });
  await expect.poll(async () => (await els(p2)).length).toBe(4);
  expect((await els(p2)).map((e) => e.type).sort()).toEqual(srcTypes);
  await expect(p2.getByTestId('toast').filter({ hasText: /Imported 4/ })).toBeVisible();
  await p2.screenshot({ path: '/tmp/e2e-shots/export-imported.png' });
  await ctx.close();
});

test('invalid JSON import shows an error toast and does not crash', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page);
  await drawRect(page, 300, 300, 400, 400);
  for (const [fname, content] of [
    ['broken.json', '{ "type": "excalidraw", "elements": [ {'],
    ['wrong.json', JSON.stringify({ hello: 'world' })],
  ]) {
    await page.getByTestId('main-menu-button').click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: /Open file/ }).click()]);
    await chooser.setFiles({ name: fname, mimeType: 'application/json', buffer: Buffer.from(content) });
    const toast = page.getByTestId('toast').last();
    await expect(toast).toBeVisible();
    await expect(page.locator('[data-testid="toast"]').filter({ hasText: /not valid|invalid|not a sketchboard|does not contain/i }).first()).toBeVisible();
    expect(await els(page)).toHaveLength(1); // scene untouched
  }
  expect(errors).toEqual([]);
  // app still works
  await drawRect(page, 500, 300, 600, 400);
  expect(await els(page)).toHaveLength(2);
});

test('PNG export embeds the scene: re-importing the PNG restores the elements', async ({ page, browser }) => {
  await openApp(page);
  await sampleScene(page);
  await page.getByTestId('export-button').click();
  const { name, bytes } = await downloadFrom(page, () => page.getByTestId('export-png').click());
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await openApp(p2);
  await p2.getByTestId('main-menu-button').click();
  const [chooser] = await Promise.all([p2.waitForEvent('filechooser'), p2.getByRole('menuitem', { name: /Open file/ }).click()]);
  await chooser.setFiles({ name, mimeType: 'image/png', buffer: bytes });
  await expect.poll(async () => (await els(p2)).length).toBe(4);
  await ctx.close();
});
