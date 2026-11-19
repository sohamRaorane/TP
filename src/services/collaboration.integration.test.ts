// @vitest-environment node
// Two independent client instances (fresh module graphs = two "tabs") against a real
// server. Skipped unless SKETCH_SERVER=http://localhost:<port> is set.
import { describe, it, expect, vi } from 'vitest';
import { io } from 'socket.io-client';

const URL = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SKETCH_SERVER;

async function makeClient(name: string) {
  vi.resetModules();
  const collabMod = await import('./collaboration');
  const canvas = await import('@/store/canvasStore');
  const collabStore = await import('@/store/collaborationStore');
  const history = await import('@/store/historyStore');
  const factory = await import('@/engine/drawing/newElement');
  collabStore.useCollaborationStore.setState({ me: { userId: name, name, color: '#123456' } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- socket typing differs across module instances
  collabMod.__setSocketFactory(() => io(URL!, { transports: ['websocket'], autoConnect: false, reconnection: true }) as any);
  return { collab: collabMod.collab, canvas: canvas.useCanvasStore, cs: collabStore.useCollaborationStore, history: history.useHistoryStore, factory };
}

const until = async (fn: () => boolean, ms = 4000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe.skipIf(!URL)('collaboration against a real server', () => {
  it('syncs creates, edits and deletes between two clients without echo', async () => {
    const res = await fetch(`${URL}/api/drawings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"int"}' });
    const { id } = (await res.json()) as { id: string };
    const A = await makeClient('alice');
    const B = await makeClient('bob');
    await A.collab.connect(id);
    await B.collab.connect(id);
    await until(() => A.cs.getState().collaborators.length === 1 && B.cs.getState().collaborators.length === 1);

    const style = A.canvas.getState().appState.currentItem;
    const r = A.factory.newShape('rectangle', { x: 10, y: 20, width: 100, height: 50, style });
    A.canvas.getState().addElements([r]);
    A.canvas.getState().commit();
    await until(() => !!B.canvas.getState().elementsById[r.id]);
    expect(B.canvas.getState().elementsById[r.id].x).toBe(10);
    // remote change is not undoable on B
    expect(B.history.getState().canUndo).toBe(false);

    B.canvas.getState().updateElement(r.id, { x: 300 });
    B.canvas.getState().commit();
    await until(() => A.canvas.getState().elementsById[r.id].x === 300);

    A.canvas.getState().deleteElements([r.id]);
    A.canvas.getState().commit();
    await until(() => B.canvas.getState().elementsById[r.id].isDeleted);

    // pointer + presence
    A.collab.sendPointer({ x: 1, y: 2, tool: 'selection', button: 'up', selectedElementIds: [] });
    await until(() => Object.keys(B.cs.getState().pointers).length === 1);

    // late joiner gets the full scene
    const C = await makeClient('carol');
    await C.collab.connect(id);
    await until(() => !!C.canvas.getState().elementsById[r.id]);
    expect(C.canvas.getState().elementsById[r.id].isDeleted).toBe(true);

    A.collab.disconnect();
    await until(() => B.cs.getState().collaborators.length === 1);
    B.collab.disconnect();
    C.collab.disconnect();
  }, 20_000);
});
