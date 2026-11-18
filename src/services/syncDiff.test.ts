import { describe, it, expect, beforeEach } from 'vitest';
import {
  collectChanged, markKnown, markReceived, localNewerThan, filesToSend, sanitizeIncoming, followViewport, restampLaser, pruneLaser,
  type VersionMap,
} from './syncDiff';
import { resetStores, rect } from '@/test/helpers';
import type { SketchElement } from '@/types/appState';
import { useCanvasStore } from '@/store/canvasStore';

beforeEach(resetStores);
const bump = <T extends SketchElement>(el: T, ch: Partial<T> = {}): T => ({ ...el, ...ch, version: el.version + 1, versionNonce: el.versionNonce + 1 });

describe('outgoing diff', () => {
  it('only sends elements whose version changed since last broadcast', () => {
    const a = rect(0, 0), b = rect(1, 1), c = rect(2, 2);
    const known: VersionMap = new Map();
    expect(collectChanged([a, b, c], known)).toEqual([a, b, c]);
    markKnown(known, [a, b, c]);
    expect(collectChanged([a, b, c], known)).toEqual([]);
    const b2 = bump(b, { x: 5 });
    const c2 = bump(c, { isDeleted: true }); // tombstones are sent too
    expect(collectChanged([a, b2, c2], known)).toEqual([b2, c2]);
  });

  it('never echoes received remote elements', () => {
    const local = rect(0, 0);
    const known: VersionMap = new Map([[local.id, local.version]]);
    useCanvasStore.getState().addElements([local]);
    const remoteNew = rect(9, 9);
    const remoteUpdate = bump(local, { x: 100 });
    useCanvasStore.getState().applyRemoteElements([remoteNew, remoteUpdate]);
    markReceived(known, [remoteNew, remoteUpdate], useCanvasStore.getState().elementsById);
    expect(collectChanged(useCanvasStore.getState().elements, known)).toEqual([]);
  });

  it('keeps sending a local element that won against a stale remote one', () => {
    const local = bump(bump(rect(0, 0)));
    useCanvasStore.getState().addElements([local]);
    const known: VersionMap = new Map();
    const stale = { ...local, version: 1, x: -1 };
    useCanvasStore.getState().applyRemoteElements([stale]);
    markReceived(known, [stale], useCanvasStore.getState().elementsById);
    expect(collectChanged(useCanvasStore.getState().elements, known)).toEqual([local]);
  });
});

describe('reconnect reconciliation', () => {
  it('resends local elements that are newer than or missing on the server', () => {
    const same = rect(0, 0);
    const newerLocal = bump(rect(1, 1));
    const olderLocal = rect(2, 2);
    const onlyLocal = rect(3, 3);
    const onlyLocalDeleted = { ...rect(4, 4), isDeleted: true };
    const server = [same, { ...newerLocal, version: 1 }, bump(olderLocal)];
    const res = localNewerThan([same, newerLocal, olderLocal, onlyLocal, onlyLocalDeleted], server);
    expect(res.map((e) => e.id)).toEqual([newerLocal.id, onlyLocal.id]);
  });
});

describe('files, validation, follow, laser', () => {
  it('sends each referenced file once', () => {
    const img = { ...rect(0, 0), type: 'image' as const, fileId: 'f', status: 'saved' as const, scale: [1, 1] as [number, number] };
    const files = { f: { id: 'f', mimeType: 'image/png', dataURL: 'data:image/png;base64,A', created: 1 } };
    const sent = new Set<string>();
    expect(Object.keys(filesToSend([img], files, sent))).toEqual(['f']);
    sent.add('f');
    expect(filesToSend([img], files, sent)).toEqual({});
  });

  it('drops malformed incoming elements', () => {
    const ok = rect(0, 0);
    expect(sanitizeIncoming([ok, { id: 'x' }, null, 5])).toEqual([ok]);
    expect(sanitizeIncoming('nope')).toEqual([]);
  });

  it('follow viewport matches the remote center and zoom', () => {
    const vp = { scrollX: -100, scrollY: -50, zoom: 2, width: 800, height: 600 };
    const mine = followViewport(vp, 1000, 400);
    // remote center scene = (800/2/2 + 100, 600/2/2 + 50) = (300, 200)
    expect(mine.zoom).toBe(2);
    expect(1000 / 2 / mine.zoom - mine.scrollX).toBeCloseTo(300);
    expect(400 / 2 / mine.zoom - mine.scrollY).toBeCloseTo(200);
  });

  it('restamps laser trails to the local clock and prunes old points', () => {
    const pts: Array<[number, number, number]> = [[0, 0, 100], [1, 1, 1000], [2, 2, 2000]];
    const r = restampLaser(pts, 50_000);
    expect(r.map((p) => p[2])).toEqual([49_000, 50_000]);
    expect(pruneLaser(r, 50_000 + 1200)).toHaveLength(1);
  });
});
