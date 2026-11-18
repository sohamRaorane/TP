import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
vi.mock('@/engine/rendering', () => ({ exportToCanvas: vi.fn(), exportToSvg: vi.fn() }));
vi.mock('@/engine/rendering/thumbnail', () => ({ renderThumbnail: () => null }));

import { initPersistence, saveNow, __resetPersistenceForTests } from './persistence';
import { initRouting, __resetRouting } from './routing';
import { RECOVERY_KEY, readRecovery, writeRecovery, snapshotRecovery } from './recovery';
import { useCanvasStore } from '@/store/canvasStore';
import { useCollaborationStore } from '@/store/collaborationStore';
import { resetStores, rect } from '@/test/helpers';
import type { Drawing } from '@shared/protocol';
import type { SketchElement } from '@/types/appState';

const st = () => useCanvasStore.getState();

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let server: { up: boolean; drawings: Record<string, Drawing> };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const mkDrawing = (id: string, elements: SketchElement[], updatedAt: string): Drawing => ({
  id, name: 'Server name', thumbnail: null, elementCount: elements.length, createdAt: updatedAt, updatedAt, revision: 1,
  data: { type: 'sketchboard', version: 1, elements, appState: {}, files: {} },
});

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, url, body });
  if (!server.up) throw new TypeError('Failed to fetch');
  if (url === '/api/health') return json({ ok: true, db: true });
  if (url === '/api/drawings' && method === 'POST') {
    const d = mkDrawing('new-1', body.data?.elements ?? [], new Date().toISOString());
    server.drawings[d.id] = d;
    return json(d, 201);
  }
  const m = /^\/api\/drawings\/([^/]+)$/.exec(url);
  if (m) {
    const d = server.drawings[m[1]];
    if (!d) return json({ error: 'Not found' }, 404);
    if (method === 'PUT') {
      server.drawings[d.id] = { ...d, data: body.data ?? d.data, name: body.name ?? d.name, updatedAt: new Date().toISOString() };
      return json(server.drawings[d.id]);
    }
    return json(d);
  }
  return json({ error: 'unexpected' }, 500);
});

const puts = () => calls.filter((c) => c.method === 'PUT');
const posts = () => calls.filter((c) => c.method === 'POST');
const draw = (...els: SketchElement[]) => {
  st().addElements(els.length ? els : [rect(Math.random() * 100, 0)]);
  st().commit();
};

let cleanup: () => void = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  resetStores();
  localStorage.clear();
  calls = [];
  server = { up: true, drawings: {} };
  vi.stubGlobal('fetch', fetchMock);
  useCollaborationStore.setState({ roomId: null });
  __resetPersistenceForTests();
  __resetRouting();
  history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('local recovery', () => {
  it('debounces recovery writes to 500ms after the last change', async () => {
    cleanup = initPersistence();
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const recoveryWrites = () => spy.mock.calls.filter((c) => c[0] === RECOVERY_KEY).length;
    draw();
    await vi.advanceTimersByTimeAsync(300);
    draw();
    await vi.advanceTimersByTimeAsync(300);
    expect(recoveryWrites()).toBe(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(recoveryWrites()).toBe(1);
    expect(readRecovery()!.elements).toHaveLength(2);
    spy.mockRestore();
  });

  it('drops files when the quota is exceeded', async () => {
    cleanup = initPersistence();
    const img = { ...rect(0, 0), type: 'image' as const, fileId: 'f', status: 'saved' as const, scale: [1, 1] as [number, number] };
    st().addFiles({ f: { id: 'f', mimeType: 'image/png', dataURL: 'data:image/png;base64,' + 'A'.repeat(100), created: 1 } });
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === RECOVERY_KEY && v.includes('base64')) throw new DOMException('full', 'QuotaExceededError');
      return real.call(this, k, v);
    });
    draw(img);
    await vi.advanceTimersByTimeAsync(600);
    const r = readRecovery()!;
    expect(r.elements).toHaveLength(1);
    expect(r.files).toEqual({});
    spy.mockRestore();
  });

  it('restores recovery on startup when no drawing is in the URL', async () => {
    const a = rect(1, 2);
    st().setAppState({ name: 'Local work' });
    writeRecovery(snapshotRecovery([a], {}, st().appState, false));
    resetStores();
    __resetRouting();
    await initRouting();
    expect(st().elements.map((e) => e.id)).toEqual([a.id]);
    expect(st().appState.name).toBe('Local work');
  });
});

describe('server autosave', () => {
  it('PUTs 1500ms after the last change and marks saved', async () => {
    server.drawings.d1 = mkDrawing('d1', [], new Date().toISOString());
    st().setAppState({ drawingId: 'd1' });
    cleanup = initPersistence();
    draw();
    expect(st().appState.saveStatus).toBe('unsaved');
    await vi.advanceTimersByTimeAsync(1000);
    draw();
    await vi.advanceTimersByTimeAsync(1000);
    expect(puts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(puts()).toHaveLength(1);
    expect(puts()[0].url).toBe('/api/drawings/d1');
    expect((puts()[0].body as { data: { elements: unknown[] } }).data.elements).toHaveLength(2);
    expect(st().appState.saveStatus).toBe('saved');
    expect(st().appState.lastSavedAt).toBeTypeOf('number');
    expect(readRecovery()!.synced).toBe(true);
  });

  it('saves at least every 10s during continuous editing', async () => {
    server.drawings.d1 = mkDrawing('d1', [], new Date().toISOString());
    st().setAppState({ drawingId: 'd1' });
    cleanup = initPersistence();
    for (let i = 0; i < 11; i++) {
      draw();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(puts()).toHaveLength(1);
  });

  it('goes offline on network failure and retries with backoff', async () => {
    server.drawings.d1 = mkDrawing('d1', [], new Date().toISOString());
    st().setAppState({ drawingId: 'd1' });
    cleanup = initPersistence();
    server.up = false;
    draw();
    await vi.advanceTimersByTimeAsync(1600);
    expect(st().appState.saveStatus).toBe('offline');
    server.up = true;
    await vi.advanceTimersByTimeAsync(2100);
    expect(st().appState.saveStatus).toBe('saved');
    expect(puts().length).toBe(2);
  });

  it('auto-creates a drawing once the user draws and the server is reachable', async () => {
    cleanup = initPersistence();
    await vi.advanceTimersByTimeAsync(2000);
    expect(posts()).toHaveLength(0); // nothing drawn yet
    draw();
    await vi.advanceTimersByTimeAsync(1600);
    expect(posts()).toHaveLength(1);
    expect(st().appState.drawingId).toBe('new-1');
    expect(location.hash).toBe('#drawing=new-1');
  });

  it('skips PUT while in a collaboration room but keeps recovery', async () => {
    st().setAppState({ drawingId: 'd1' });
    useCollaborationStore.setState({ roomId: 'd1' });
    cleanup = initPersistence();
    draw();
    await vi.advanceTimersByTimeAsync(3000);
    expect(puts()).toHaveLength(0);
    expect(readRecovery()!.elements).toHaveLength(1);
  });

  it('saveNow saves immediately', async () => {
    server.drawings.d1 = mkDrawing('d1', [], new Date().toISOString());
    st().setAppState({ drawingId: 'd1' });
    cleanup = initPersistence();
    draw();
    await saveNow();
    expect(puts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(puts()).toHaveLength(1); // debounced save was cancelled
  });

  it('beforeunload flushes recovery and does not warn', () => {
    st().setAppState({ drawingId: 'd1' });
    cleanup = initPersistence();
    draw();
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(readRecovery()!.elements).toHaveLength(1);
  });
});

describe('routing', () => {
  it('opens #drawing=<id> from the server', async () => {
    const el = rect(5, 5);
    server.drawings.d9 = mkDrawing('d9', [el], new Date().toISOString());
    history.replaceState(null, '', '/#drawing=d9');
    await initRouting();
    expect(st().elements.map((e) => e.id)).toEqual([el.id]);
    expect(st().appState.drawingId).toBe('d9');
    expect(st().appState.name).toBe('Server name');
    expect(st().appState.saveStatus).toBe('saved');
  });

  it('prefers newer unsynced local recovery over the server copy and re-saves it', async () => {
    const serverEl = rect(0, 0);
    const localEl = rect(50, 50);
    server.drawings.d9 = mkDrawing('d9', [serverEl], new Date(Date.now() - 60_000).toISOString());
    st().setAppState({ drawingId: 'd9' });
    writeRecovery(snapshotRecovery([localEl], {}, st().appState, false));
    resetStores();
    cleanup = initPersistence();
    history.replaceState(null, '', '/#drawing=d9');
    await initRouting();
    expect(st().elements.map((e) => e.id)).toEqual([localEl.id]);
    await vi.advanceTimersByTimeAsync(1600);
    expect(puts()).toHaveLength(1);
  });

  it('uses the server copy when recovery is synced', async () => {
    const serverEl = rect(0, 0);
    server.drawings.d9 = mkDrawing('d9', [serverEl], new Date(Date.now() - 60_000).toISOString());
    st().setAppState({ drawingId: 'd9' });
    writeRecovery(snapshotRecovery([rect(9, 9)], {}, st().appState, true));
    resetStores();
    history.replaceState(null, '', '/#drawing=d9');
    await initRouting();
    expect(st().elements.map((e) => e.id)).toEqual([serverEl.id]);
  });

  it('shows a readable toast for a missing drawing', async () => {
    history.replaceState(null, '', '/#drawing=nope');
    await initRouting();
    expect(st().appState.toast?.message).toMatch(/does not exist/);
    expect(location.hash).toBe('');
  });

  it('falls back to recovery when the server is offline', async () => {
    const localEl = rect(1, 1);
    st().setAppState({ drawingId: 'd9' });
    writeRecovery(snapshotRecovery([localEl], {}, st().appState, false));
    resetStores();
    server.up = false;
    history.replaceState(null, '', '/#drawing=d9');
    await initRouting();
    expect(st().elements.map((e) => e.id)).toEqual([localEl.id]);
    expect(st().appState.saveStatus).toBe('offline');
  });
});
