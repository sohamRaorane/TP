import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { SketchElement } from '../../../shared/element';
import type { ClientToServerEvents, ServerToClientEvents } from '../../../shared/protocol';
import type { CreateServerOptions } from '../app';
import { BACKENDS, DEFAULT_BACKEND, makeElement, scene, startTestServer, type Backend } from '../test/helpers';

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
type TestServer = Awaited<ReturnType<typeof startTestServer>>;
type JoinResult = Parameters<Parameters<ClientToServerEvents['room:join']>[1]>[0];

let server: TestServer | undefined;
const clients: Client[] = [];

async function start(backend: Backend = DEFAULT_BACKEND, opts: CreateServerOptions = {}) {
  server = await startTestServer(backend, { persistDebounceMs: 50, persistMaxWaitMs: 200, roomEvictMs: 100, ...opts });
  return server;
}

function connect(): Promise<Client> {
  const c: Client = ioClient(server!.url, { transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(c);
  return new Promise((resolve, reject) => {
    c.once('connect', () => resolve(c));
    c.once('connect_error', reject);
  });
}

function next<E extends keyof ServerToClientEvents>(
  c: Client,
  event: E,
  timeoutMs = 2000,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${String(event)}`)), timeoutMs);
    // socket.io-client's typed `once` is awkward with generic event names
    (c as unknown as { once(e: string, fn: (p: unknown) => void): void }).once(event, (p) => {
      clearTimeout(timer);
      resolve(p as Parameters<ServerToClientEvents[E]>[0]);
    });
  });
}

/** Collects every `event` payload received by `c`. */
function record<E extends keyof ServerToClientEvents>(c: Client, event: E) {
  const got: Parameters<ServerToClientEvents[E]>[0][] = [];
  (c as unknown as { on(e: string, fn: (p: unknown) => void): void }).on(event, (p) =>
    got.push(p as Parameters<ServerToClientEvents[E]>[0]),
  );
  return got;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function join(c: Client, roomId: string, name = 'user'): Promise<{ res: JoinResult; init: { elements: SketchElement[] } }> {
  const initP = next(c, 'scene:init');
  const res = await new Promise<JoinResult>((resolve) =>
    c.emit('room:join', { roomId, user: { userId: `u-${name}`, name, color: '#f00' } }, resolve),
  );
  const init = res.ok ? await initP : { elements: [] };
  return { res, init };
}

async function createDrawing(elements: SketchElement[] = []) {
  return server!.service.create({ name: 'Collab', data: scene(elements) });
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await server?.cleanup();
  server = undefined;
});

describe('collaboration (Socket.IO)', () => {
  it('joins a drawing room and receives the stored scene', async () => {
    await start();
    const el = makeElement({ id: 'r1' });
    const d = await createDrawing([el]);
    const a = await connect();
    const { res, init } = await join(a, d.id, 'alice');
    expect(res).toEqual({ ok: true, role: 'edit', drawingId: d.id });
    expect(init.elements).toEqual([el]);
  });

  it('rejects invalid joins', async () => {
    await start();
    const a = await connect();
    const res = await new Promise<JoinResult>((resolve) =>
      a.emit('room:join', { roomId: '../bad', user: { userId: 'u', name: 'n', color: '#000' } }, resolve),
    );
    expect(res.ok).toBe(false);
  });

  it('broadcasts only accepted elements to other clients, in order', async () => {
    await start();
    const r1 = makeElement({ id: 'r1', version: 3, versionNonce: 10 });
    const r2 = makeElement({ id: 'r2', version: 3, versionNonce: 10 });
    const d = await createDrawing([r1, r2]);
    const [a, b] = [await connect(), await connect()];
    await join(a, d.id, 'a');
    await join(b, d.id, 'b');
    const aGot = record(a, 'scene:update');

    const updated = { ...r1, x: 500, version: 4 };
    const stale = { ...r2, x: 777, version: 2 };
    const fresh = makeElement({ id: 'new1' });
    const bUpdate = next(b, 'scene:update');
    a.emit('scene:update', { roomId: d.id, elements: [updated, stale, fresh] });
    const msg = await bUpdate;
    expect(msg.from).toBe(a.id);
    expect(msg.elements.map((e) => e.id)).toEqual(['r1', 'new1']);
    expect(msg.elements[0]!.x).toBe(500);

    const initP = next(b, 'scene:init');
    b.emit('scene:sync', { roomId: d.id });
    const init = await initP;
    expect(init.elements.map((e) => e.id)).toEqual(['r1', 'r2', 'new1']);
    expect(init.elements[1]!.x).toBe(r2.x);
    await sleep(50);
    expect(aGot).toHaveLength(0); // never echoed to the sender
  });

  it('does not broadcast stale updates', async () => {
    await start();
    const r1 = makeElement({ id: 'r1', version: 5 });
    const d = await createDrawing([r1]);
    const [a, b] = [await connect(), await connect()];
    await join(a, d.id, 'a');
    await join(b, d.id, 'b');
    const bGot = record(b, 'scene:update');
    a.emit('scene:update', { roomId: d.id, elements: [{ ...r1, x: 1, version: 4 }, { ...r1, x: 2, version: 5 }] });
    await sleep(200);
    expect(bGot).toHaveLength(0);
  });

  it('breaks version ties by the lower versionNonce', async () => {
    await start();
    const r1 = makeElement({ id: 'r1', version: 2, versionNonce: 100 });
    const d = await createDrawing([r1]);
    const [a, b] = [await connect(), await connect()];
    await join(a, d.id, 'a');
    await join(b, d.id, 'b');
    const bGot = record(b, 'scene:update');
    a.emit('scene:update', { roomId: d.id, elements: [{ ...r1, x: 1, versionNonce: 200 }] }); // loses
    a.emit('scene:update', { roomId: d.id, elements: [{ ...r1, x: 2, versionNonce: 50 }] }); // wins
    await sleep(200);
    expect(bGot).toHaveLength(1);
    expect(bGot[0]!.elements[0]).toMatchObject({ x: 2, versionNonce: 50 });
  });

  it('view-only clients share the room but cannot edit', async () => {
    await start();
    const d = await createDrawing([makeElement({ id: 'r1' })]);
    const { roomId } = await server!.service.share(d.id, 'view');
    const [editor, viewer] = [await connect(), await connect()];
    await join(editor, d.id, 'ed');
    const { res, init } = await join(viewer, roomId, 'viewer');
    expect(res).toEqual({ ok: true, role: 'view', drawingId: d.id });
    expect(init.elements.map((e) => e.id)).toEqual(['r1']);

    const editorGot = record(editor, 'scene:update');
    const err = next(viewer, 'room:error');
    viewer.emit('scene:update', { roomId, elements: [makeElement({ id: 'hack' })] });
    expect((await err).error).toMatch(/Read-only/);
    const fileErr = next(viewer, 'room:error');
    viewer.emit('files:add', { roomId, files: {} });
    expect((await fileErr).error).toMatch(/Read-only/);

    // viewers still receive edits
    const viewerUpdate = next(viewer, 'scene:update');
    editor.emit('scene:update', { roomId: d.id, elements: [makeElement({ id: 'legit' })] });
    expect((await viewerUpdate).elements[0]!.id).toBe('legit');
    await sleep(50);
    expect(editorGot).toHaveLength(0);
  });

  it('emits presence on join, user:update and leave', async () => {
    await start();
    const d = await createDrawing();
    const [a, b] = [await connect(), await connect()];
    await join(a, d.id, 'alice');
    const presence = next(a, 'presence');
    await join(b, d.id, 'bob');
    const p1 = await presence;
    expect(p1.users.map((u) => u.name).sort()).toEqual(['alice', 'bob']);
    expect(p1.users.find((u) => u.name === 'bob')).toMatchObject({ socketId: b.id, role: 'edit', userId: 'u-bob' });

    const renamed = next(a, 'presence');
    b.emit('user:update', { roomId: d.id, name: 'Bobby', color: '#0f0' });
    expect((await renamed).users.find((u) => u.socketId === b.id)).toMatchObject({ name: 'Bobby', color: '#0f0' });

    const left = next(a, 'presence');
    b.disconnect();
    expect((await left).users.map((u) => u.name)).toEqual(['alice']);

    const c = await connect();
    const withCarol = next(a, 'presence');
    await join(c, d.id, 'carol');
    expect((await withCarol).users).toHaveLength(2);
    const afterLeave = next(a, 'presence');
    c.emit('room:leave', { roomId: d.id });
    expect((await afterLeave).users.map((u) => u.name)).toEqual(['alice']);
  });

  it('relays pointers and lasers to others only', async () => {
    await start();
    const d = await createDrawing();
    const [a, b] = [await connect(), await connect()];
    await join(a, d.id, 'a');
    await join(b, d.id, 'b');
    const aGot = record(a, 'pointer:update');
    const pointer = { x: 1, y: 2, tool: 'selection', button: 'up' as const, selectedElementIds: ['x'] };
    const pb = next(b, 'pointer:update');
    a.emit('pointer:update', { roomId: d.id, pointer });
    expect(await pb).toEqual({ socketId: a.id, pointer });

    const lb = next(b, 'laser:update');
    a.emit('laser:update', { roomId: d.id, points: [[1, 2, 3], [4, 5, 6]] });
    expect(await lb).toEqual({ socketId: a.id, points: [[1, 2, 3], [4, 5, 6]] });
    await sleep(50);
    expect(aGot).toHaveLength(0);
  });

  it('rejects invalid payloads and messages for rooms not joined', async () => {
    await start();
    const d = await createDrawing();
    const a = await connect();
    const notIn = next(a, 'room:error');
    a.emit('scene:update', { roomId: d.id, elements: [] });
    expect((await notIn).error).toMatch(/Not in room/);

    await join(a, d.id);
    const invalid = next(a, 'room:error');
    a.emit('scene:update', { roomId: d.id, elements: [{ id: 'x', type: 'rectangle' } as unknown as SketchElement] });
    expect((await invalid).error).toMatch(/Invalid scene:update/);

    const tooMany = next(a, 'room:error');
    const many = Array.from({ length: 5001 }, (_, i) => makeElement({ id: `m${i}` }));
    a.emit('scene:update', { roomId: d.id, elements: many });
    expect((await tooMany).error).toMatch(/Invalid scene:update/);
  });

  it('relays files and returns them in scene:init', async () => {
    await start();
    const d = await createDrawing();
    const [a, b] = [await connect(), await connect()];
    await join(a, d.id, 'a');
    await join(b, d.id, 'b');
    const file = { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA', created: 1 };
    const got = next(b, 'files:add');
    a.emit('files:add', { roomId: d.id, files: { f1: file } });
    expect(await got).toEqual({ files: { f1: file }, from: a.id });
    const c = await connect();
    const { init } = await join(c, d.id, 'c');
    expect((init as { files?: unknown }).files).toEqual({ f1: file });
  });

  it('serves the latest scene after reconnect + scene:sync', async () => {
    await start();
    const r1 = makeElement({ id: 'r1' });
    const d = await createDrawing([r1]);
    const [a, b] = [await connect(), await connect()];
    await join(a, d.id, 'a');
    await join(b, d.id, 'b');
    b.disconnect();
    a.emit('scene:update', { roomId: d.id, elements: [{ ...r1, x: 42, version: 2 }, makeElement({ id: 'r2' })] });
    await sleep(100);

    const b2 = await connect();
    await join(b2, d.id, 'b');
    const sync = next(b2, 'scene:init');
    b2.emit('scene:sync', { roomId: d.id });
    const init = await sync;
    expect(init.elements.map((e) => [e.id, e.x])).toEqual([
      ['r1', 42],
      ['r2', expect.any(Number)],
    ]);
  });

  it('supports ad-hoc rooms kept in memory only', async () => {
    await start();
    const [a, b] = [await connect(), await connect()];
    const { res } = await join(a, 'adhoc-room', 'a');
    expect(res).toEqual({ ok: true, role: 'edit', drawingId: null });
    await join(b, 'adhoc-room', 'b');
    const got = next(b, 'scene:update');
    a.emit('scene:update', { roomId: 'adhoc-room', elements: [makeElement({ id: 'z' })] });
    expect((await got).elements[0]!.id).toBe('z');
    expect((await server!.repo.list({ limit: 10, offset: 0 })).total).toBe(0);
  });

  it('rate-limits scene:update per socket', async () => {
    await start(DEFAULT_BACKEND, { maxUpdatesPerSecond: 3 });
    const d = await createDrawing();
    const [a, b] = [await connect(), await connect()];
    await join(a, d.id, 'a');
    await join(b, d.id, 'b');
    const bGot = record(b, 'scene:update');
    const err = next(a, 'room:error');
    for (let i = 0; i < 6; i++) a.emit('scene:update', { roomId: d.id, elements: [makeElement({ id: `q${i}` })] });
    expect((await err).error).toMatch(/Rate limit/);
    await sleep(150);
    expect(bGot).toHaveLength(3);
  });

  it('pushes REST updates of a drawing into its live room', async () => {
    await start();
    const r1 = makeElement({ id: 'r1' });
    const d = await createDrawing([r1]);
    const a = await connect();
    await join(a, d.id, 'a');
    const got = next(a, 'scene:update');
    await server!.service.update(d.id, { data: scene([{ ...r1, x: 9, version: 2 }]) });
    const msg = await got;
    expect(msg.from).toBe('server');
    expect(msg.elements[0]).toMatchObject({ id: 'r1', x: 9 });
  });

  describe.each<Backend>(BACKENDS)('persistence (%s)', (backend) => {
    it('persists room changes to the drawing after the debounce', async () => {
      await start(backend);
      const r1 = makeElement({ id: 'r1' });
      const d = await createDrawing([r1]);
      const a = await connect();
      await join(a, d.id, 'a');
      const oldTombstone = makeElement({ id: 'old', isDeleted: true, updated: Date.now() - 2 * 3600_000 });
      const recentTombstone = makeElement({ id: 'gone', isDeleted: true });
      a.emit('scene:update', {
        roomId: d.id,
        elements: [{ ...r1, x: 321, version: 2 }, makeElement({ id: 'r2' }), oldTombstone, recentTombstone],
      });
      await sleep(400);
      const saved = (await server!.repo.get(d.id))!;
      expect(saved.data.elements.map((e) => e.id)).toEqual(['r1', 'r2', 'gone']);
      expect(saved.data.elements[0]!.x).toBe(321);
      expect(saved.elementCount).toBe(2);
      expect(saved.revision).toBe(2);
      expect(saved.name).toBe('Collab');
    });

    it('persists on last leave and evicts the empty room', async () => {
      await start(backend, { persistDebounceMs: 10_000, persistMaxWaitMs: 10_000 });
      const d = await createDrawing();
      const a = await connect();
      await join(a, d.id, 'a');
      a.emit('scene:update', { roomId: d.id, elements: [makeElement({ id: 'k' })] });
      await sleep(50);
      expect(server!.hub.rooms.size).toBe(1);
      a.disconnect();
      await sleep(300);
      const saved = (await server!.repo.get(d.id))!;
      expect(saved.data.elements.map((e) => e.id)).toEqual(['k']);
      expect(server!.hub.rooms.size).toBe(0);
    });
  });

  it('flushes dirty rooms on close (graceful shutdown)', async () => {
    const s = await start(DEFAULT_BACKEND, { persistDebounceMs: 60_000, persistMaxWaitMs: 60_000 });
    const d = await createDrawing();
    const a = await connect();
    await join(a, d.id, 'a');
    a.emit('scene:update', { roomId: d.id, elements: [makeElement({ id: 'late' })] });
    await sleep(50);
    const repo = s.repo;
    await s.hub.close();
    expect((await repo.get(d.id))!.data.elements.map((e) => e.id)).toEqual(['late']);
  });
});
