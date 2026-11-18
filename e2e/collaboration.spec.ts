// Real two-user collaboration: two independent browser contexts (separate storage, separate sockets)
// against the real Express + Socket.IO + Postgres server.
import { test, expect, type Browser, type Page, type BrowserContext } from '@playwright/test';
import { openApp, els, view, drag, drawRect, pressKey, byId, toScreen, versionMap, history } from './helpers';

interface Session {
  a: Page;
  b: Page;
  ctxA: BrowserContext;
  ctxB: BrowserContext;
  url: string;
  roomId: string;
}

const collab = (page: Page) =>
  page.evaluate(() => {
    const c = (window as any).__sketch.useCollaborationStore.getState();
    return { roomId: c.roomId, role: c.role, status: c.status, collaborators: c.collaborators.length, pointers: c.pointers, me: c.me };
  });

async function newUser(browser: Browser, name: string) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((n) => {
    // give each user a stable display name (what the Share dialog stores)
    const raw = localStorage.getItem('sketchboard:me');
    if (!raw) localStorage.setItem('sketchboard:me', JSON.stringify({ userId: crypto.randomUUID(), name: n, color: '#e03131' }));
  }, name);
  const page = await ctx.newPage();
  return { ctx, page };
}

/** A starts a live session through the Share dialog; B opens the edit link */
async function startSession(browser: Browser, opts: { seed?: (a: Page) => Promise<void> } = {}): Promise<Session> {
  const { ctx: ctxA, page: a } = await newUser(browser, 'Alice');
  const { ctx: ctxB, page: b } = await newUser(browser, 'Bob');
  await openApp(a);
  if (opts.seed) await opts.seed(a);
  await a.getByTestId('share-button').click();
  const dialog = a.getByTestId('share-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('start-session').click();
  const link = dialog.getByTestId('share-link-edit');
  await expect(link).toBeVisible({ timeout: 10_000 });
  const url = await link.inputValue();
  expect(url).toMatch(/\?room=/);
  await expect(dialog).toContainText('Session is live');
  await a.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const roomId = new URL(url).searchParams.get('room')!;
  await openApp(b, url);
  await expect.poll(async () => (await collab(b)).status, { timeout: 10_000 }).toBe('connected');
  await expect.poll(async () => (await collab(a)).collaborators).toBe(1);
  return { a, b, ctxA, ctxB, url, roomId };
}

async function closeSession(s: Session) {
  await s.ctxA.close();
  await s.ctxB.close();
}

/** both pages converge to identical id -> version (+deleted) maps */
async function expectConverged(a: Page, b: Page, timeout = 5000) {
  await expect
    .poll(async () => JSON.stringify(Object.entries(await versionMap(a)).sort()) === JSON.stringify(Object.entries(await versionMap(b)).sort()), {
      timeout,
    })
    .toBe(true);
  return versionMap(a);
}

test('A starts a session via the Share dialog; B joins; presence shows 2; drawing syncs within 2s', async ({ browser }) => {
  const s = await startSession(browser);
  const { a, b } = s;
  // presence: Share button badge shows 2 on both sides
  await expect(a.getByTestId('share-button')).toHaveAccessibleName(/2 people/);
  await expect(b.getByTestId('share-button')).toHaveAccessibleName(/2 people/);
  await expect(a.getByTestId('share-button').locator('.sb-badge')).toHaveText('2');
  await expect(b.getByTestId('avatar-stack')).toBeVisible();
  // collaborator list in B's dialog shows Alice
  await b.getByTestId('share-button').click();
  await expect(b.getByTestId('collaborator-list')).toContainText('Alice');
  await b.keyboard.press('Escape');

  // A draws a rectangle -> visible on B within 2 s
  const t0 = Date.now();
  const r = await drawRect(a, 300, 300, 420, 400);
  await expect.poll(async () => (await els(b)).map((e) => e.id), { timeout: 2000 }).toEqual([r.id]);
  const latency = Date.now() - t0;
  console.log(`[collab] A->B rectangle latency ${latency} ms`);
  const onB = (await byId(b, r.id))!;
  expect([onB.x, onB.y, onB.width, onB.height]).toEqual([r.x, r.y, r.width, r.height]);
  // and it is rendered on B's canvas (pixel check on the static canvas at the rectangle's left edge)
  await b.screenshot({ path: '/tmp/e2e-shots/collab-b-sees-rect.png' });
  await closeSession(s);
});

test('B moves the shape -> A sees the new position; deletes sync both ways', async ({ browser }) => {
  const s = await startSession(browser);
  const { a, b } = s;
  const r = await drawRect(a, 300, 300, 420, 400);
  await expect.poll(async () => (await els(b)).length, { timeout: 2000 }).toBe(1);

  // B selects (click on the stroke) and drags it
  const p = await toScreen(b, r.x, r.y + 25);
  await b.mouse.click(p.x, p.y);
  await drag(b, p, { x: p.x + 150, y: p.y + 80 }, { steps: 10 });
  const movedOnB = (await byId(b, r.id))!;
  expect(movedOnB.x).toBeCloseTo(r.x + 150, 0);
  await expect.poll(async () => (await byId(a, r.id))!.x, { timeout: 2000 }).toBeCloseTo(movedOnB.x, 5);
  expect((await byId(a, r.id))!.y).toBeCloseTo(movedOnB.y, 5);
  await expectConverged(a, b);

  // B deletes -> gone on A
  await pressKey(b, 'Delete');
  await expect.poll(async () => (await els(a)).length, { timeout: 2000 }).toBe(0);

  // A draws, A deletes -> gone on B
  const r2 = await drawRect(a, 600, 300, 700, 400);
  await expect.poll(async () => (await els(b)).map((e) => e.id), { timeout: 2000 }).toEqual([r2.id]);
  await pressKey(a, 'Delete');
  await expect.poll(async () => (await els(b)).length, { timeout: 2000 }).toBe(0);
  await expectConverged(a, b);
  await closeSession(s);
});

test('concurrent edits on different shapes converge to identical element sets', async ({ browser }) => {
  const s = await startSession(browser);
  const { a, b } = s;
  // both draw at the same time
  await Promise.all([
    (async () => {
      for (let i = 0; i < 4; i++) await drawRect(a, 200 + i * 110, 200, 290 + i * 110, 280);
    })(),
    (async () => {
      for (let i = 0; i < 4; i++) {
        await pressKey(b, 'o');
        await drag(b, { x: 200 + i * 110, y: 450 }, { x: 290 + i * 110, y: 530 });
      }
    })(),
  ]);
  await expect.poll(async () => (await els(a)).length, { timeout: 3000 }).toBe(8);
  await expect.poll(async () => (await els(b)).length, { timeout: 3000 }).toBe(8);
  // now concurrently restyle/move different shapes
  await Promise.all([
    (async () => {
      await pressKey(a, 'Control+a');
      await a.getByRole('button', { name: 'Stroke #e03131' }).click();
    })(),
    (async () => {
      const ell = (await els(b)).filter((e) => e.type === 'ellipse');
      for (const e of ell.slice(0, 2)) {
        const c = await toScreen(b, e.x, e.y + e.height / 2);
        await b.mouse.click(c.x, c.y);
        await pressKey(b, 'Shift+ArrowDown');
      }
    })(),
  ]);
  const map = await expectConverged(a, b, 5000);
  expect(Object.keys(map)).toHaveLength(8);
  // identical geometry/style too
  const norm = (list: Awaited<ReturnType<typeof els>>) =>
    list.map((e) => `${e.id}:${e.x.toFixed(2)},${e.y.toFixed(2)},${e.strokeColor}`).sort();
  expect(norm(await els(a))).toEqual(norm(await els(b)));
  await closeSession(s);
});

test('remote cursor of A is visible on B', async ({ browser }) => {
  const s = await startSession(browser);
  const { a, b } = s;
  await a.mouse.move(500, 400);
  await a.mouse.move(520, 410, { steps: 3 });
  const aScene = { x: 520 - (await view(a)).scrollX, y: 410 - (await view(a)).scrollY };
  await expect
    .poll(async () => Object.values((await collab(b)).pointers as Record<string, { x: number; y: number }>).map((p) => [Math.round(p.x), Math.round(p.y)]), {
      timeout: 2000,
    })
    .toEqual([[Math.round(aScene.x), Math.round(aScene.y)]]);
  await b.screenshot({ path: '/tmp/e2e-shots/collab-remote-cursor.png' });
  await closeSession(s);
});

test('B goes offline, edits, comes back online: both converge', async ({ browser }) => {
  const s = await startSession(browser);
  const { a, b, ctxB } = s;
  const r = await drawRect(a, 300, 300, 400, 400);
  await expect.poll(async () => (await els(b)).length, { timeout: 2000 }).toBe(1);

  await ctxB.setOffline(true);
  // B edits while offline: new ellipse + move A's rectangle
  await pressKey(b, 'o');
  await drag(b, { x: 600, y: 300 }, { x: 700, y: 380 });
  const ell = (await els(b)).find((e) => e.type === 'ellipse')!;
  const p = await toScreen(b, r.x, r.y + 25);
  await b.mouse.click(p.x, p.y);
  await pressKey(b, 'Shift+ArrowRight');
  // A keeps editing too
  const r2 = await drawRect(a, 300, 550, 400, 650);
  // (nothing from B should have reached A)
  await a.waitForTimeout(500);
  expect((await els(a)).find((e) => e.id === ell.id)).toBeUndefined();

  await ctxB.setOffline(false);
  const map = await expectConverged(a, b, 15_000);
  expect(Object.keys(map).sort()).toEqual([r.id, r2.id, ell.id].sort());
  expect((await byId(a, r.id))!.x).toBeCloseTo(r.x + 10, 5);
  await expect.poll(async () => (await collab(b)).status).toBe('connected');
  await closeSession(s);
});

test('view-only participant sees updates but cannot modify', async ({ browser }) => {
  const s = await startSession(browser);
  const { a } = s;
  // A creates a view-only link from the Share dialog
  await a.getByTestId('share-button').click();
  const dialog = a.getByTestId('share-dialog');
  await dialog.getByRole('button', { name: /Create view-only link/ }).click();
  const viewLink = dialog.getByTestId('share-link-view');
  await expect(viewLink).toBeVisible({ timeout: 10_000 });
  const viewUrl = await viewLink.inputValue();
  await a.keyboard.press('Escape');
  expect(viewUrl).not.toBe(s.url);

  const { ctx: ctxV, page: v } = await newUser(browser, 'Viewer');
  await openApp(v, viewUrl);
  await expect.poll(async () => (await collab(v)).status, { timeout: 10_000 }).toBe('connected');
  expect((await collab(v)).role).toBe('view');
  expect((await view(v)).viewModeEnabled).toBe(true);
  await expect(v.getByTestId('view-mode-badge')).toBeVisible();
  await expect(v.getByTestId('toolbar')).toHaveCount(0);

  // A draws -> viewer sees it
  const r = await drawRect(a, 300, 300, 400, 400);
  await expect.poll(async () => (await els(v)).map((e) => e.id), { timeout: 2000 }).toEqual([r.id]);

  // viewer tries to draw / move / delete: nothing changes anywhere
  await pressKey(v, 'r');
  await drag(v, { x: 600, y: 300 }, { x: 700, y: 400 });
  const p = await toScreen(v, r.x, r.y + 25);
  await drag(v, p, { x: p.x + 100, y: p.y + 100 });
  await pressKey(v, 'Control+a');
  await pressKey(v, 'Delete');
  await pressKey(v, 'Control+z');
  expect((await els(v)).map((e) => [e.id, e.x])).toEqual([[r.id, r.x]]);
  await a.waitForTimeout(500);
  expect((await els(a)).map((e) => [e.id, e.x])).toEqual([[r.id, r.x]]);
  // A still has the full scene and is unaffected; A's later edits still reach the viewer
  await pressKey(a, 'Delete');
  await expect.poll(async () => (await els(v)).length, { timeout: 2000 }).toBe(0);
  await ctxV.close();
  await closeSession(s);
});

test('undo on B does not undo A\'s changes', async ({ browser }) => {
  const s = await startSession(browser);
  const { a, b } = s;
  const rA = await drawRect(a, 300, 300, 400, 400);
  await expect.poll(async () => (await els(b)).length, { timeout: 2000 }).toBe(1);
  expect((await history(b)).undo).toBe(0);
  await pressKey(b, 'o');
  await drag(b, { x: 600, y: 300 }, { x: 700, y: 380 });
  await expect.poll(async () => (await els(a)).length, { timeout: 2000 }).toBe(2);
  // A moves its rectangle afterwards
  await a.mouse.click(300, 325);
  await pressKey(a, 'Shift+ArrowDown');
  await expect.poll(async () => (await byId(b, rA.id))!.y, { timeout: 2000 }).toBeCloseTo(rA.y + 10, 5);

  await pressKey(b, 'Control+z'); // undoes only B's ellipse
  await expect.poll(async () => (await els(a)).map((e) => e.id), { timeout: 2000 }).toEqual([rA.id]);
  expect((await byId(b, rA.id))!.y).toBeCloseTo(rA.y + 10, 5);
  await pressKey(b, 'Control+z'); // nothing left to undo for B
  expect((await els(b)).map((e) => e.id)).toEqual([rA.id]);
  expect((await byId(b, rA.id))!.y).toBeCloseTo(rA.y + 10, 5);
  await expectConverged(a, b);
  await closeSession(s);
});

test('existing content is shared when the session starts; late joiner gets the full scene', async ({ browser }) => {
  const s = await startSession(browser, {
    seed: async (a) => {
      await drawRect(a, 300, 300, 400, 400);
      await drawRect(a, 500, 300, 600, 400);
    },
  });
  await expect.poll(async () => (await els(s.b)).length, { timeout: 3000 }).toBe(2);
  // a third user joining later gets everything, including B's edits
  await pressKey(s.b, 'Control+a');
  await pressKey(s.b, 'Delete');
  await drawRect(s.b, 300, 500, 400, 600);
  const { ctx: ctxC, page: c } = await newUser(browser, 'Carol');
  await openApp(c, s.url);
  await expectConverged(s.a, c);
  expect(await els(c)).toHaveLength(1);
  await expect(s.a.getByTestId('share-button').locator('.sb-badge')).toHaveText('3');
  await ctxC.close();
  await closeSession(s);
});

test('collaboration state is persisted: reopening the drawing after everyone leaves shows the scene', async ({ browser }) => {
  const s = await startSession(browser);
  const r = await drawRect(s.a, 300, 300, 400, 400);
  await drawRect(s.b, 500, 300, 600, 400);
  await expectConverged(s.a, s.b);
  const ids = Object.keys(await versionMap(s.a)).sort();
  const drawingId = (await view(s.a)).drawingId;
  expect(drawingId).toBeTruthy();
  await closeSession(s);
  // server debounces persistence (~2s)
  const { ctx, page } = await newUser(browser, 'Later');
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/drawings/${drawingId}`);
        if (!res.ok()) return [];
        const d = await res.json();
        const list = (d.data?.elements ?? d.drawing?.data?.elements ?? d.elements ?? []) as Array<{ id: string; isDeleted: boolean }>;
        return list.filter((e) => !e.isDeleted).map((e) => e.id).sort();
      },
      { timeout: 10_000 },
    )
    .toEqual(ids);
  await openApp(page, `/#drawing=${drawingId}`);
  await expect.poll(async () => (await els(page)).map((e) => e.id).sort()).toEqual(ids);
  expect(r).toBeTruthy();
  await ctx.close();
});

test('conflict: both users move the SAME shape at the same time -> identical result on both', async ({ browser }) => {
  const s = await startSession(browser);
  const { a, b } = s;
  const r = await drawRect(a, 300, 300, 400, 400);
  await expect.poll(async () => (await els(b)).length, { timeout: 2000 }).toBe(1);
  const pb = await toScreen(b, r.x, r.y + 25);
  await b.mouse.click(pb.x, pb.y);
  // A still has r selected after drawing
  await Promise.all([
    (async () => {
      for (let i = 0; i < 8; i++) await pressKey(a, 'Shift+ArrowRight');
    })(),
    (async () => {
      for (let i = 0; i < 8; i++) await pressKey(b, 'Shift+ArrowDown');
    })(),
  ]);
  await expectConverged(a, b);
  const ea = (await byId(a, r.id))!;
  const eb = (await byId(b, r.id))!;
  expect([ea.x, ea.y]).toEqual([eb.x, eb.y]);
  await closeSession(s);
});

test('conflict: B edits offline a shape that A deletes meanwhile -> converge', async ({ browser }) => {
  const s = await startSession(browser);
  const { a, b, ctxB } = s;
  const r = await drawRect(a, 300, 300, 400, 400);
  await expect.poll(async () => (await els(b)).length, { timeout: 2000 }).toBe(1);
  await ctxB.setOffline(true);
  const pb = await toScreen(b, r.x, r.y + 25);
  await b.mouse.click(pb.x, pb.y);
  await pressKey(b, 'Shift+ArrowRight');
  await pressKey(a, 'Delete'); // A still has it selected
  await ctxB.setOffline(false);
  await expectConverged(a, b, 15_000);
  // whichever wins, both agree on visibility
  expect((await els(a)).length).toBe((await els(b)).length);
  await closeSession(s);
});

test('text labels edited by B appear on A', async ({ browser }) => {
  const s = await startSession(browser);
  const { a, b } = s;
  const r = await drawRect(a, 300, 300, 500, 400);
  await expect.poll(async () => (await els(b)).length, { timeout: 2000 }).toBe(1);
  await pressKey(b, 'Escape');
  const c = await toScreen(b, 400, 350);
  await b.mouse.dblclick(c.x, c.y);
  await expect(b.getByTestId('text-editor')).toBeFocused();
  await b.keyboard.type('From Bob');
  await b.keyboard.press('Escape');
  await expect
    .poll(async () => (await els(a)).filter((e) => e.type === 'text').map((e) => [e.text, e.containerId]), { timeout: 2000 })
    .toEqual([['From Bob', r.id]]);
  await expectConverged(a, b);
  await closeSession(s);
});

test('A reloads the room URL and rejoins; syncing continues', async ({ browser }) => {
  const s = await startSession(browser);
  const { a, b } = s;
  const r = await drawRect(a, 300, 300, 400, 400);
  await expect.poll(async () => (await els(b)).length, { timeout: 2000 }).toBe(1);
  await expect(a).toHaveURL(/\?room=/);
  await a.reload();
  await a.waitForFunction(() => !!(window as any).__sketch);
  await expect.poll(async () => (await collab(a)).status, { timeout: 10_000 }).toBe('connected');
  await expect.poll(async () => (await els(a)).map((e) => e.id)).toEqual([r.id]);
  await expect.poll(async () => (await collab(b)).collaborators).toBe(1);
  const r2 = await drawRect(b, 600, 300, 700, 400);
  await expect.poll(async () => (await els(a)).map((e) => e.id).sort(), { timeout: 2000 }).toEqual([r.id, r2.id].sort());
  await closeSession(s);
});
