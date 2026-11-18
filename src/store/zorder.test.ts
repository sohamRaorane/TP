import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { newShape } from '@/engine/drawing/newElement';
import { defaultAppState } from './canvasStore';

const style = defaultAppState().currentItem;
const mk = () => newShape('rectangle', { x: 0, y: 0, width: 10, height: 10, style });
const ids = () => useCanvasStore.getState().elements.map((e) => e.id);

describe('z-order sync via fractional keys', () => {
  beforeEach(() => useCanvasStore.getState().replaceScene([]));

  it('reorder rewrites only moved keys and a peer converges', () => {
    const [a, b, c] = [mk(), mk(), mk()];
    useCanvasStore.getState().addElements([a, b, c]);
    useCanvasStore.getState().commit();
    const before = useCanvasStore.getState().elements;
    useCanvasStore.getState().reorder([a.id], 'front');
    expect(ids()).toEqual([b.id, c.id, a.id]);
    const after = useCanvasStore.getState().elements;
    const changed = after.filter((el) => before.find((p) => p.id === el.id) !== el);
    expect(changed.map((e) => e.id)).toEqual([a.id]);

    // peer: has old scene, receives only the changed element
    const peerElements = before.map((e) => ({ ...e }));
    useCanvasStore.getState().replaceScene(peerElements);
    useCanvasStore.getState().applyRemoteElements(changed);
    expect(ids()).toEqual([b.id, c.id, a.id]);
  });

  it('undo of reorder restores order', () => {
    const [a, b] = [mk(), mk()];
    useCanvasStore.getState().addElements([a, b]);
    useCanvasStore.getState().commit();
    useCanvasStore.getState().reorder([b.id], 'back');
    useCanvasStore.getState().commit();
    expect(ids()).toEqual([b.id, a.id]);
    useCanvasStore.getState().undo();
    expect(ids()).toEqual([a.id, b.id]);
    useCanvasStore.getState().redo();
    expect(ids()).toEqual([b.id, a.id]);
  });

  it('remote elements appended concurrently converge to the same order', () => {
    const x = { ...mk(), index: 'a1' };
    const y = { ...mk(), index: 'a2' };
    useCanvasStore.getState().applyRemoteElements([y]);
    useCanvasStore.getState().applyRemoteElements([x]);
    expect(ids()).toEqual([x.id, y.id]);
  });
});
