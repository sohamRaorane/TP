import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { collab, __setSocketFactory } from './collaboration';
import { useCanvasStore } from '@/store/canvasStore';
import { useCollaborationStore } from '@/store/collaborationStore';
import { useHistoryStore } from '@/store/historyStore';
import { resetStores, rect, addCommitted, get } from '@/test/helpers';
import type { SketchElement } from '@/types/appState';

type Handler = (...a: unknown[]) => void;
class FakeSocket {
  id = 'me-socket';
  connected = false;
  handlers: Record<string, Handler[]> = {};
  emitted: Array<{ ev: string; p: unknown }> = [];
  role: 'edit' | 'view' = 'edit';
  on(ev: string, h: Handler) {
    (this.handlers[ev] ??= []).push(h);
    return this;
  }
  emit(ev: string, p: unknown, ack?: (r: unknown) => void) {
    this.emitted.push({ ev, p });
    if (ev === 'room:join' && ack) ack({ ok: true, role: this.role, drawingId: 'd1' });
    return this;
  }
  connect() {
    this.connected = true;
    queueMicrotask(() => this.fire('connect'));
    return this;
  }
  disconnect() {
    this.connected = false;
    return this;
  }
  removeAllListeners() {
    this.handlers = {};
    return this;
  }
  fire(ev: string, ...a: unknown[]) {
    (this.handlers[ev] ?? []).forEach((h) => h(...a));
  }
  sent(ev: string) {
    return this.emitted.filter((e) => e.ev === ev).map((e) => e.p as { elements: SketchElement[] });
  }
}

let sock: FakeSocket;
const st = () => useCanvasStore.getState();

beforeEach(() => {
  vi.useFakeTimers();
  resetStores();
  sock = new FakeSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for the socket.io client
  __setSocketFactory(() => sock as any);
});
afterEach(() => {
  collab.disconnect();
  vi.useRealTimers();
});

const connect = async (role: 'edit' | 'view' = 'edit') => {
  sock.role = role;
  const p = collab.connect('d1');
  await vi.advanceTimersByTimeAsync(0);
  await p;
};

describe('collaboration service', () => {
  it('joins, reconciles scene:init and sends only newer local elements', async () => {
    const shared = rect(0, 0);
    const localOnly = rect(100, 0);
    addCommitted(shared, localOnly);
    await connect();
    expect(useCollaborationStore.getState()).toMatchObject({ status: 'connected', role: 'edit', roomId: 'd1' });
    const remoteNew = rect(500, 500);
    sock.fire('scene:init', { elements: [shared, remoteNew], files: {} });
    expect(get(remoteNew.id)).toBeTruthy();
    const updates = sock.sent('scene:update');
    expect(updates).toHaveLength(1);
    expect(updates[0].elements.map((e) => e.id)).toEqual([localOnly.id]);
    // remote element is not undoable
    expect(useHistoryStore.getState().baseline[remoteNew.id]).toBe(get(remoteNew.id));
  });

  it('broadcasts only changed elements (throttled) and never echoes remote ones', async () => {
    const [a, b] = addCommitted(rect(0, 0), rect(50, 0));
    await connect();
    sock.fire('scene:init', { elements: [a, b], files: {} });
    sock.emitted = [];
    // remote update must not come back
    const remote = { ...b, x: 999, version: b.version + 3 };
    sock.fire('scene:update', { elements: [remote], from: 'other' });
    expect(get(b.id).x).toBe(999);
    // local change
    st().updateElement(a.id, { x: 10 });
    st().updateElement(a.id, { x: 20 });
    await vi.advanceTimersByTimeAsync(60);
    const updates = sock.sent('scene:update');
    expect(updates.flatMap((u) => u.elements.map((e) => e.id))).toEqual([a.id]);
    expect(updates.at(-1)!.elements[0].x).toBe(20);
    // deletions are sent as tombstones
    sock.emitted = [];
    st().deleteElements([a.id]);
    await vi.advanceTimersByTimeAsync(60);
    expect(sock.sent('scene:update')[0].elements[0]).toMatchObject({ id: a.id, isDeleted: true });
  });

  it('on reconnect re-joins, requests scene:sync and resends local work done offline', async () => {
    const [a] = addCommitted(rect(0, 0));
    await connect();
    sock.fire('scene:init', { elements: [a], files: {} });
    sock.connected = false;
    sock.fire('disconnect', 'transport close');
    expect(useCollaborationStore.getState().status).toBe('reconnecting');
    st().updateElement(a.id, { x: 42 });
    await vi.advanceTimersByTimeAsync(60);
    sock.emitted = [];
    sock.connected = true;
    sock.fire('connect');
    await vi.advanceTimersByTimeAsync(0);
    expect(sock.emitted.map((e) => e.ev)).toEqual(['room:join', 'scene:sync']);
    sock.fire('scene:init', { elements: [a], files: {} });
    const resent = sock.sent('scene:update').flatMap((u) => u.elements);
    expect(resent).toHaveLength(1);
    expect(resent[0].x).toBe(42);
  });

  it('view role enables view mode and never sends scene updates', async () => {
    await connect('view');
    expect(st().appState.viewModeEnabled).toBe(true);
    sock.fire('scene:init', { elements: [rect(0, 0)], files: {} });
    st().addElements([rect(5, 5)]);
    await vi.advanceTimersByTimeAsync(60);
    expect(sock.sent('scene:update')).toHaveLength(0);
  });

  it('presence excludes own socket and prunes pointers of users who left', async () => {
    await connect();
    const u = (socketId: string) => ({ userId: socketId, socketId, name: socketId, color: '#000', role: 'edit' as const });
    sock.fire('pointer:update', { socketId: 'b', pointer: { x: 1, y: 1, tool: 'selection', button: 'up', selectedElementIds: [] } });
    sock.fire('presence', { users: [u('me-socket'), u('b'), u('c')] });
    expect(useCollaborationStore.getState().collaborators.map((c) => c.socketId)).toEqual(['b', 'c']);
    expect(Object.keys(useCollaborationStore.getState().pointers)).toEqual(['b']);
    sock.fire('presence', { users: [u('me-socket'), u('c')] });
    expect(useCollaborationStore.getState().pointers).toEqual({});
  });

  it('follows a user viewport and stops when the user pans', async () => {
    await connect();
    st().setAppState({ followingSocketId: 'b' });
    sock.fire('pointer:update', {
      socketId: 'b',
      pointer: { x: 0, y: 0, tool: 'selection', button: 'up', selectedElementIds: [], viewport: { scrollX: 0, scrollY: 0, zoom: 2, width: 400, height: 400 } },
    });
    const a = st().appState;
    expect(a.zoom).toBe(2);
    expect(a.width / 2 / a.zoom - a.scrollX).toBeCloseTo(100);
    expect(a.followingSocketId).toBe('b');
    st().setAppState({ scrollX: a.scrollX + 10 });
    expect(st().appState.followingSocketId).toBeNull();
  });

  it('remote files are added and not re-broadcast; local image files are sent once', async () => {
    await connect();
    sock.fire('scene:init', { elements: [], files: {} });
    const file = { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA', created: 1 };
    sock.fire('files:add', { files: { f1: file, bad: { id: 'bad' } }, from: 'x' });
    expect(Object.keys(st().files)).toEqual(['f1']);
    const img = (fileId: string) => ({ ...rect(0, 0), type: 'image' as const, fileId, status: 'saved' as const, scale: [1, 1] as [number, number] });
    st().addFiles({ f2: { ...file, id: 'f2' } });
    st().addElements([img('f1'), img('f2')]);
    await vi.advanceTimersByTimeAsync(60);
    const filesSent = sock.emitted.filter((e) => e.ev === 'files:add').map((e) => Object.keys((e.p as { files: object }).files));
    expect(filesSent).toEqual([['f2']]);
  });

  it('lasers are stored per socket and pruned after 1.5s', async () => {
    await connect();
    sock.fire('laser:update', { socketId: 'b', points: [[0, 0, 1], [1, 1, 2]] });
    expect(useCollaborationStore.getState().lasers.b).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1700);
    expect(useCollaborationStore.getState().lasers.b).toBeUndefined();
  });

  it('emits user:update when own name or color changes while connected', async () => {
    await connect();
    collab.updateUser({ name: 'Zed' });
    expect(sock.emitted.filter((e) => e.ev === 'user:update').map((e) => e.p)).toEqual([
      { roomId: 'd1', name: 'Zed', color: useCollaborationStore.getState().me.color },
    ]);
  });

  it('accepts server-originated updates (from: "server")', async () => {
    await connect();
    const el = rect(1, 1);
    sock.fire('scene:update', { elements: [el], from: 'server' });
    expect(get(el.id)).toBeTruthy();
  });

  it('disconnect leaves the room and resets state', async () => {
    await connect();
    collab.disconnect();
    expect(sock.emitted.at(-1)!.ev).toBe('room:leave');
    expect(useCollaborationStore.getState()).toMatchObject({ status: 'disconnected', roomId: null, collaborators: [] });
  });
});
