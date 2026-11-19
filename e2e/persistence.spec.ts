import { test, expect, type Page } from '@playwright/test';
import { openApp, els, view, drawRect, pressKey } from './helpers';

const saveStatus = (page: Page) => page.getByTestId('save-status');

async function waitSaved(page: Page) {
  await expect(saveStatus(page)).toHaveText('Saved', { timeout: 10_000 });
  await expect.poll(async () => (await view(page)).drawingId).not.toBeNull();
}

async function renameDrawing(page: Page, name: string) {
  await page.getByTestId('drawing-name').click();
  const input = page.getByTestId('drawing-name-input');
  await input.fill(name);
  await input.press('Enter');
  await expect(page.getByTestId('drawing-name')).toHaveText(name);
}

const unique = (p: string) => `${p} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

test('autosave to the server, URL gets #drawing=id, reload restores the scene', async ({ page }) => {
  await openApp(page);
  await drawRect(page, 300, 300, 400, 400);
  await pressKey(page, 'o');
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(600, 380, { steps: 5 });
  await page.mouse.up();
  await expect(saveStatus(page)).toHaveText(/Unsaved|Saving/);
  await waitSaved(page);
  const id = (await view(page)).drawingId!;
  await expect(page).toHaveURL(new RegExp(`#drawing=${id}`));
  const before = (await els(page)).map((e) => [e.id, e.type, e.x, e.y]);

  // a completely fresh browser context (no local storage) opening the URL gets the scene from the server
  const ctx2 = await page.context().browser()!.newContext();
  const p2 = await ctx2.newPage();
  await openApp(p2, page.url());
  await expect.poll(async () => (await els(p2)).map((e) => [e.id, e.type, e.x, e.y])).toEqual(before);
  expect((await view(p2)).drawingId).toBe(id);
  await ctx2.close();

  // plain reload in the same tab
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__sketch);
  await expect.poll(async () => (await els(page)).map((e) => [e.id, e.type, e.x, e.y])).toEqual(before);
});

test('later edits are saved too (PUT) and survive a reload', async ({ page }) => {
  await openApp(page);
  await drawRect(page, 300, 300, 400, 400);
  await waitSaved(page);
  await drawRect(page, 500, 300, 600, 400);
  await expect(saveStatus(page)).toHaveText(/Unsaved|Saving/);
  await waitSaved(page);
  const ctx2 = await page.context().browser()!.newContext();
  const p2 = await ctx2.newPage();
  await openApp(p2, page.url());
  await expect.poll(async () => (await els(p2)).length).toBe(2);
  await ctx2.close();
});

test('local recovery after reload when the server is unreachable', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
  await openApp(page);
  await drawRect(page, 300, 300, 400, 400);
  await drawRect(page, 500, 300, 600, 400);
  await expect(saveStatus(page)).toHaveText(/Offline|Unsaved|Save failed/, { timeout: 10_000 });
  const before = (await els(page)).map((e) => e.id);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__sketch);
  await expect.poll(async () => (await els(page)).map((e) => e.id)).toEqual(before);
  // no crash: still drawable
  await drawRect(page, 300, 500, 400, 600);
  expect(await els(page)).toHaveLength(3);
});

// REGRESSION TEST (bug found by e2e, now fixed) (dev / StrictMode): routing calls requestSave() for unsynced recovered work, but the
// StrictMode effect cleanup of initPersistence() cancels serverDebounced, so nothing is sent until the
// next local edit (status stays "Unsaved").
test('unsaved local work is recovered and then saved once the server is back', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
  await openApp(page);
  await drawRect(page, 300, 300, 400, 400);
  await expect.poll(async () => (await view(page)).saveStatus).not.toBe('saved');
  // let the 500ms recovery debounce flush (reload also flushes it on beforeunload)
  await page.unroute('**/api/**');
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__sketch);
  await expect.poll(async () => (await els(page)).length).toBe(1);
  await waitSaved(page);
});

test('recovered work is saved after the next edit once the server is back', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
  await openApp(page);
  await drawRect(page, 300, 300, 400, 400);
  await page.unroute('**/api/**');
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__sketch);
  await expect.poll(async () => (await els(page)).length).toBe(1);
  await drawRect(page, 500, 300, 600, 400);
  await waitSaved(page);
  const ctx2 = await page.context().browser()!.newContext();
  const p2 = await ctx2.newPage();
  await openApp(p2, page.url());
  await expect.poll(async () => (await els(p2)).length).toBe(2);
  await ctx2.close();
});

// REGRESSION TEST (bug found by e2e, now fixed): renaming the CURRENT drawing from its dashboard card calls actions.rename but never
// refreshes the list (DashboardDialog.tsx commitRename: `if (current) run(...)` without onChanged()),
// so the card keeps showing the old name.
test('dashboard card shows the new name after renaming the current drawing', async ({ page }) => {
  await openApp(page);
  const name = unique('E2E stale');
  await drawRect(page, 300, 300, 400, 400);
  await waitSaved(page);
  await renameDrawing(page, name);
  await pressKey(page, 'Control+o');
  const list = page.getByTestId('drawing-list');
  await list.getByRole('button', { name: `Rename ${name}` }).click();
  const input = list.getByRole('textbox', { name: 'Drawing name' });
  await input.fill(`${name} x`);
  await input.press('Enter');
  await expect(list.getByTestId('drawing-card').filter({ hasText: `${name} x` })).toHaveCount(1, { timeout: 3000 });
});

test('dashboard lists the drawing; rename, duplicate, delete', async ({ page }) => {
  await openApp(page);
  const name = unique('E2E dash');
  await drawRect(page, 300, 300, 400, 400);
  await waitSaved(page);
  await renameDrawing(page, name);

  await page.getByTestId('main-menu-button').click();
  await page.getByTestId('menu-open').click();
  const list = page.getByTestId('drawing-list');
  await expect(list).toBeVisible();
  const card = list.getByTestId('drawing-card').filter({ hasText: name });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('1 element');

  // rename from the dashboard (current drawing)
  const renamed = `${name} renamed`;
  await card.getByRole('button', { name: `Rename ${name}` }).click();
  // (while renaming, the card shows an input instead of the name, so locate via the list)
  const input = list.getByRole('textbox', { name: 'Drawing name' });
  await input.fill(renamed);
  await input.press('Enter');
  await expect(page.getByTestId('drawing-name')).toHaveText(renamed);
  // (work around the stale-card bug below: reopen the dashboard to refresh the list)
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await pressKey(page, 'Control+o');
  const card2 = list.getByTestId('drawing-card').filter({ hasText: renamed });
  await expect(card2).toHaveCount(1, { timeout: 5000 });

  // duplicate
  await card2.first().getByRole('button', { name: `Duplicate ${renamed}` }).click();
  await expect(page.getByTestId('toast').filter({ hasText: /duplicated/i })).toBeVisible();
  const dupCards = list.getByTestId('drawing-card').filter({ hasText: renamed });
  await expect(dupCards).toHaveCount(2);

  // delete the duplicate (not the current one)
  const notCurrent = dupCards.filter({ hasNotText: 'Current' });
  await expect(notCurrent).toHaveCount(1);
  const dupName = (await notCurrent.locator('div.truncate').first().textContent())!.trim();
  await notCurrent.getByRole('button', { name: `Delete ${dupName}` }).click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByTestId('toast').filter({ hasText: /deleted/i })).toBeVisible();
  await expect(list.getByTestId('drawing-card').filter({ hasText: renamed })).toHaveCount(1);

  // the server agrees
  const res = await page.request.get(`/api/drawings?search=${encodeURIComponent(renamed)}`);
  const body = await res.json();
  expect(body.drawings.map((d: { name: string }) => d.name).filter((n: string) => n.startsWith(renamed))).toHaveLength(1);
});

test('dashboard: open another drawing', async ({ page }) => {
  await openApp(page);
  const nameA = unique('E2E A');
  await drawRect(page, 300, 300, 400, 400);
  await waitSaved(page);
  await renameDrawing(page, nameA);
  const idA = (await view(page)).drawingId;

  // new drawing via the dashboard
  await pressKey(page, 'Control+o');
  await page.getByTestId('dashboard-new').click();
  await expect.poll(async () => (await els(page)).length).toBe(0);
  await drawRect(page, 500, 300, 650, 450);
  await drawRect(page, 700, 300, 750, 350);
  await waitSaved(page);
  expect((await view(page)).drawingId).not.toBe(idA);

  await pressKey(page, 'Control+o');
  await page.getByRole('button', { name: `Open ${nameA}` }).click();
  await expect.poll(async () => (await view(page)).drawingId).toBe(idA);
  await expect.poll(async () => (await els(page)).length).toBe(1);
  await expect(page.getByTestId('drawing-name')).toHaveText(nameA);
  await expect(page).toHaveURL(new RegExp(`#drawing=${idA}`));
});
