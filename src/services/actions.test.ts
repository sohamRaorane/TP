import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/engine/rendering', () => ({
  exportToCanvas: vi.fn(() => {
    throw new Error('not in tests');
  }),
  exportToSvg: vi.fn(),
}));
const downloads: Array<{ blob: Blob; name: string }> = [];
vi.mock('@/utils/download', async (orig) => ({
  ...(await orig<typeof import('@/utils/download')>()),
  downloadBlob: (blob: Blob, name: string) => downloads.push({ blob, name }),
}));

import { actions, styleChangesFor } from './actions';
import { useCanvasStore } from '@/store/canvasStore';
import { useHistoryStore } from '@/store/historyStore';
import { resetStores, rect, text, arrow, addCommitted, select, get, undoDepth } from '@/test/helpers';
import { parseClipboard, serializeClipboard } from './clipboard';
import type { SketchElement } from '@/types/appState';

const st = () => useCanvasStore.getState();
const visible = () => st().elements.filter((e) => !e.isDeleted);

beforeEach(() => {
  resetStores();
  downloads.length = 0;
});

describe('undo/redo integration', () => {
  it('records exactly one entry per action and undoes/redoes them all', () => {
    // create
    const [a] = addCommitted(rect(0, 0));
    const [b] = addCommitted(rect(200, 0));
    expect(undoDepth()).toBe(2);
    // move
    select(a.id);
    actions.moveSelection(5, 7);
    expect(get(a.id).x).toBe(5);
    expect(undoDepth()).toBe(3);
    // resize-like update (drag: many updates, one commit)
    st().updateElement(a.id, { width: 120 });
    st().updateElement(a.id, { width: 150 });
    st().commit();
    expect(undoDepth()).toBe(4);
    // style
    actions.setStyle({ strokeColor: '#ff0000' });
    expect(get(a.id).strokeColor).toBe('#ff0000');
    expect(st().appState.currentItem.strokeColor).toBe('#ff0000');
    expect(undoDepth()).toBe(5);
    // group / ungroup
    select(a.id, b.id);
    actions.group();
    const gid = get(a.id).groupIds[0];
    expect(gid).toBeTruthy();
    expect(get(b.id).groupIds).toEqual([gid]);
    expect(undoDepth()).toBe(6);
    actions.ungroup();
    expect(get(a.id).groupIds).toEqual([]);
    expect(undoDepth()).toBe(7);
    // reorder
    select(a.id);
    actions.bringToFront();
    expect(st().elements.map((e) => e.id)).toEqual([b.id, a.id]);
    expect(undoDepth()).toBe(8);
    // delete
    actions.deleteSelected();
    expect(get(a.id).isDeleted).toBe(true);
    expect(undoDepth()).toBe(9);

    const snapshot = (els: SketchElement[]) =>
      els.map((e) => ({ id: e.id, x: e.x, w: e.width, c: e.strokeColor, g: e.groupIds, d: e.isDeleted }));
    const final = snapshot(st().elements);

    // undo everything step by step
    actions.undo(); // delete
    expect(get(a.id).isDeleted).toBe(false);
    actions.undo(); // reorder
    expect(st().elements.map((e) => e.id)).toEqual([a.id, b.id]);
    actions.undo(); // ungroup
    expect(get(a.id).groupIds).toEqual([gid]);
    actions.undo(); // group
    expect(get(a.id).groupIds).toEqual([]);
    actions.undo(); // style
    expect(get(a.id).strokeColor).not.toBe('#ff0000');
    actions.undo(); // resize
    expect(get(a.id).width).toBe(100);
    actions.undo(); // move
    expect(get(a.id).x).toBe(0);
    actions.undo(); // create b
    expect(get(b.id).isDeleted).toBe(true);
    actions.undo(); // create a
    expect(visible()).toHaveLength(0);
    expect(useHistoryStore.getState().canUndo).toBe(false);

    for (let i = 0; i < 9; i++) actions.redo();
    expect(snapshot(st().elements)).toEqual(final);
    expect(useHistoryStore.getState().canRedo).toBe(false);
  });

  it('remote changes are not undoable', () => {
    const [a] = addCommitted(rect(0, 0));
    const remote = { ...rect(500, 500), id: 'remote-1' };
    st().applyRemoteElements([remote]);
    st().applyRemoteElements([{ ...get(a.id), x: 999, version: get(a.id).version + 5 }]);
    expect(get(a.id).x).toBe(999);
    actions.undo(); // undoes the local creation of a only
    expect(get('remote-1').isDeleted).toBe(false);
    expect(get(a.id).isDeleted).toBe(true);
    expect(useHistoryStore.getState().canUndo).toBe(false);
  });

  it('actions that change nothing add no history entry', () => {
    addCommitted(rect(0, 0));
    const depth = undoDepth();
    actions.group(); // nothing selected
    actions.deleteSelected();
    actions.moveSelection(1, 1);
    actions.selectAll();
    expect(undoDepth()).toBe(depth);
  });
});

describe('selection & editing', () => {
  it('selectAll skips locked, bound text and respects editingGroupId', () => {
    const r = rect(0, 0, 100, 50, { groupIds: ['g1'] });
    const t = text(10, 10, 'label', { containerId: r.id });
    r.boundElements = [{ id: t.id, type: 'text' }];
    const locked = rect(300, 0, 10, 10, { locked: true });
    const other = rect(500, 0, 10, 10);
    addCommitted(r, t, locked, other);
    actions.selectAll();
    expect(Object.keys(st().appState.selectedElementIds).sort()).toEqual([r.id, other.id].sort());
    st().setAppState({ editingGroupId: 'g1' });
    actions.selectAll();
    expect(Object.keys(st().appState.selectedElementIds)).toEqual([r.id]);
  });

  it('duplicate offsets by 10, remaps groups fully inside the selection, keeps enclosing groups', () => {
    const a = rect(0, 0, 10, 10, { groupIds: ['inner', 'outer'] });
    const b = rect(20, 0, 10, 10, { groupIds: ['inner', 'outer'] });
    const c = rect(40, 0, 10, 10, { groupIds: ['outer'] });
    addCommitted(a, b, c);
    st().setAppState({ editingGroupId: 'outer' });
    select(a.id, b.id);
    actions.duplicateSelected();
    const clones = visible().slice(3);
    expect(clones).toHaveLength(2);
    expect(clones.map((e) => e.x)).toEqual([10, 30]);
    expect(clones[0].y).toBe(10);
    expect(clones[0].groupIds[0]).not.toBe('inner');
    expect(clones[0].groupIds[0]).toBe(clones[1].groupIds[0]);
    expect(clones[0].groupIds[1]).toBe('outer');
    expect(Object.keys(st().appState.selectedElementIds).sort()).toEqual(clones.map((e) => e.id).sort());
    expect(undoDepth()).toBe(2);
  });

  it('duplicate brings bound text along and rebinds it', () => {
    const r = rect(0, 0);
    const t = text(10, 10, 'x', { containerId: r.id });
    r.boundElements = [{ id: t.id, type: 'text' }];
    addCommitted(r, t);
    select(r.id);
    actions.duplicateSelected();
    const [rc, tc] = visible().slice(2);
    expect(tc.type).toBe('text');
    expect((tc as typeof t).containerId).toBe(rc.id);
    expect(rc.boundElements).toEqual([{ id: tc.id, type: 'text' }]);
  });

  it('group inside an editing group nests the new group before it', () => {
    const a = rect(0, 0, 10, 10, { groupIds: ['outer'] });
    const b = rect(20, 0, 10, 10, { groupIds: ['outer'] });
    addCommitted(a, b);
    st().setAppState({ editingGroupId: 'outer' });
    select(a.id, b.id);
    actions.group();
    const g = get(a.id).groupIds;
    expect(g).toHaveLength(2);
    expect(g[1]).toBe('outer');
    actions.ungroup();
    expect(get(a.id).groupIds).toEqual(['outer']);
  });

  it('toggleLock locks then unlocks', () => {
    const [a] = addCommitted(rect(0, 0));
    select(a.id);
    actions.toggleLock();
    expect(get(a.id).locked).toBe(true);
    actions.toggleLock();
    expect(get(a.id).locked).toBe(false);
  });

  it('moveSelection also moves arrows bound on both ends and the bound end of others', () => {
    const r1 = rect(0, 0);
    const r2 = rect(300, 0);
    const both = arrow(100, 25, 200, 0, {
      startBinding: { elementId: r1.id, focus: 0, gap: 4 },
      endBinding: { elementId: r2.id, focus: 0, gap: 4 },
    });
    const r3 = rect(0, 300);
    const one = arrow(100, 300, 200, 0, { startBinding: { elementId: r3.id, focus: 0, gap: 4 } });
    addCommitted(r1, r2, both, r3, one);
    select(r1.id, r2.id, r3.id);
    actions.moveSelection(10, 20);
    expect(get(both.id).x).toBe(110);
    expect(get(both.id).y).toBe(45);
    const o = get(one.id) as typeof one;
    expect(o.x).toBe(110);
    expect(o.y).toBe(320);
    expect(o.points[1]).toEqual([190, -20]); // end stays where it was
    expect(o.points[0]).toEqual([0, 0]);
  });

  it('setStyle filters per type and resizes text for fontSize', () => {
    const r = rect(0, 0);
    const t = text(0, 100, 'hello', { fontSize: 20 });
    const a = arrow(0, 200, 50, 0);
    const byId = Object.fromEntries([r, t, a].map((e) => [e.id, e]));
    const ch = styleChangesFor([r, t, a], { fontSize: 40, backgroundColor: '#abc', endArrowhead: 'dot' }, byId);
    expect(ch[r.id]).toEqual({ backgroundColor: '#abc' });
    expect(ch[t.id].fontSize).toBe(40);
    expect(ch[t.id].height).toBe(50); // 40 * 1.25
    expect(ch[a.id]).toEqual({ endArrowhead: 'dot' });
  });

  it('setStyle with no selection only updates currentItem', () => {
    addCommitted(rect(0, 0));
    const depth = undoDepth();
    actions.setStyle({ strokeWidth: 4 });
    expect(st().appState.currentItem.strokeWidth).toBe(4);
    expect(undoDepth()).toBe(depth);
  });

  it('align and distribute through actions', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(50, 30, 10, 10);
    const c = rect(200, 5, 20, 10);
    addCommitted(a, b, c);
    select(a.id, b.id, c.id);
    actions.align('top');
    expect([get(a.id).y, get(b.id).y, get(c.id).y]).toEqual([0, 0, 0]);
    actions.distribute('horizontal');
    // span 0..220, sizes 40 -> gap 90
    expect([get(a.id).x, get(b.id).x, get(c.id).x]).toEqual([0, 100, 200]);
    expect(undoDepth()).toBe(3);
  });

  it('view mode blocks edits', () => {
    const [a] = addCommitted(rect(0, 0));
    select(a.id);
    st().setAppState({ viewModeEnabled: true });
    actions.deleteSelected();
    actions.moveSelection(5, 5);
    expect(get(a.id).isDeleted).toBe(false);
    expect(get(a.id).x).toBe(0);
  });

  it('flip mirrors around the selection center', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(90, 0, 10, 10);
    addCommitted(a, b);
    select(a.id, b.id);
    actions.flip('horizontal');
    expect(get(a.id).x).toBe(90);
    expect(get(b.id).x).toBe(0);
  });
});

describe('clipboard', () => {
  it('roundtrips elements and referenced files through JSON', () => {
    const r = rect(0, 0);
    const img = { ...rect(0, 0), type: 'image' as const, fileId: 'f1', status: 'saved' as const, scale: [1, 1] as [number, number] };
    const files = {
      f1: { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AAA', created: 1 },
      unused: { id: 'unused', mimeType: 'image/png', dataURL: 'data:image/png;base64,BBB', created: 1 },
    };
    const json = serializeClipboard([r, img], files);
    const parsed = parseClipboard(json)!;
    expect(parsed.elements).toEqual([r, img]);
    expect(Object.keys(parsed.files)).toEqual(['f1']);
    expect(parseClipboard('hello')).toBeNull();
    expect(parseClipboard('{"type":"sketchboard/clipboard","elements":[{"id":1}]}')).toBeNull();
  });

  it('copy + paste inserts clones centered at the point and selects them', async () => {
    const a = rect(0, 0, 100, 100);
    addCommitted(a);
    select(a.id);
    await actions.copy();
    await actions.paste({ x: 500, y: 500 });
    const [, clone] = visible();
    expect(clone.id).not.toBe(a.id);
    expect(clone.x).toBe(450);
    expect(clone.y).toBe(450);
    expect(Object.keys(st().appState.selectedElementIds)).toEqual([clone.id]);
  });

  it('pastes plain text as a text element and urls with a link', async () => {
    await actions.pasteContent({ images: [], text: 'https://example.com' }, { x: 0, y: 0 });
    const t = visible()[0];
    expect(t.type).toBe('text');
    expect(t.link).toBe('https://example.com');
    expect(undoDepth()).toBe(1);
  });

  it('cut removes the selection', async () => {
    const [a] = addCommitted(rect(0, 0));
    select(a.id);
    await actions.cut();
    expect(get(a.id).isDeleted).toBe(true);
    await actions.paste({ x: 0, y: 0 });
    expect(visible()).toHaveLength(1);
  });
});

describe('import / export', () => {
  const file = (content: string, name = 'x.sketchboard.json') =>
    new File([content], name, { type: 'application/json' });

  it('exportJSON downloads SceneData with live elements and referenced files only', async () => {
    const a = rect(0, 0);
    const b = rect(10, 10);
    addCommitted(a, b);
    st().addFiles({ zzz: { id: 'zzz', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA', created: 1 } });
    select(b.id);
    actions.deleteSelected();
    st().setAppState({ name: 'My/Plan', viewBackgroundColor: '#fafafa' });
    actions.exportJSON();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('My_Plan.sketchboard.json');
    const data = JSON.parse(await downloads[0].blob.text());
    expect(data.type).toBe('sketchboard');
    expect(data.version).toBe(1);
    expect(data.elements.map((e: SketchElement) => e.id)).toEqual([a.id]);
    expect(data.files).toEqual({});
    expect(data.appState).toEqual({ viewBackgroundColor: '#fafafa', gridEnabled: false, theme: 'light', name: 'My/Plan' });
  });

  it('imports a valid file (undoable) and zooms to fit', async () => {
    const [old] = addCommitted(rect(0, 0));
    const el = rect(1000, 1000);
    const data = { type: 'sketchboard', version: 1, elements: [el], appState: { viewBackgroundColor: '#eee' }, files: {} };
    await actions.importFile(file(JSON.stringify(data)));
    expect(visible().map((e) => e.id)).toEqual([el.id]);
    expect(get(old.id).isDeleted).toBe(true);
    expect(st().appState.viewBackgroundColor).toBe('#eee');
    expect(st().appState.toast?.kind).toBe('success');
    actions.undo();
    expect(visible().map((e) => e.id)).toEqual([old.id]);
  });

  it('rejects invalid JSON with a readable message', async () => {
    await actions.importFile(file('{not json'));
    expect(st().appState.toast).toEqual({ kind: 'error', message: 'The file is not valid JSON.' });
  });

  it('rejects files with missing fields and names the field', async () => {
    const bad = rect(0, 0) as Partial<SketchElement>;
    delete bad.strokeColor;
    await actions.importFile(file(JSON.stringify({ type: 'sketchboard', version: 1, elements: [bad] })));
    expect(st().appState.toast?.kind).toBe('error');
    expect(st().appState.toast?.message).toMatch(/Invalid drawing file: elements\.0\.strokeColor/);
    expect(visible()).toHaveLength(0);
  });

  it('rejects other JSON documents', async () => {
    await actions.importFile(file(JSON.stringify({ hello: 1 })));
    expect(st().appState.toast?.message).toMatch(/not a Sketchboard file/);
  });

  it('exportPNG failure is toasted, not thrown', async () => {
    addCommitted(rect(0, 0));
    await expect(actions.exportPNG({ scale: 1, transparent: false, onlySelected: false, dark: false })).resolves.toBeUndefined();
    expect(st().appState.toast?.kind).toBe('error');
  });
});

describe('viewport', () => {
  it('zoom steps around the center and resets', () => {
    actions.zoomIn();
    expect(st().appState.zoom).toBeCloseTo(1.1);
    actions.zoomOut();
    actions.zoomOut();
    expect(st().appState.zoom).toBeCloseTo(0.9);
    actions.resetZoom();
    expect(st().appState.zoom).toBe(1);
  });

  it('zoomToFit centers content with max zoom 1', () => {
    addCommitted(rect(0, 0, 100, 100));
    actions.zoomToFit();
    const a = st().appState;
    expect(a.zoom).toBe(1);
    // content center (50,50) at screen center (500,400)
    expect((50 + a.scrollX) * a.zoom).toBeCloseTo(500);
    expect((50 + a.scrollY) * a.zoom).toBeCloseTo(400);
  });

  it('zoomToSelection allows up to 3x', () => {
    const [a] = addCommitted(rect(0, 0, 10, 10));
    select(a.id);
    actions.zoomToSelection();
    expect(st().appState.zoom).toBe(3);
  });
});

describe('presentation & library', () => {
  it('toasts when there are no frames', () => {
    actions.startPresentation();
    expect(st().appState.toast?.message).toBe('Add frames (F) to present');
    expect(st().appState.presentation.active).toBe(false);
  });

  it('steps through frames ordered by x then y', async () => {
    const { newFrame } = await import('@/engine/drawing/newElement');
    const f2 = newFrame({ x: 1000, y: 0, width: 400, height: 300, style: st().appState.currentItem, name: 'B' });
    const f1 = newFrame({ x: 0, y: 0, width: 400, height: 300, style: st().appState.currentItem, name: 'A' });
    addCommitted(f2, f1);
    actions.startPresentation();
    expect(st().appState.presentation).toEqual({ active: true, frameIndex: 0 });
    expect(st().appState.viewModeEnabled).toBe(true);
    const center = () => ({ x: 500 / st().appState.zoom - st().appState.scrollX });
    expect(center().x).toBeCloseTo(200);
    actions.nextSlide();
    expect(center().x).toBeCloseTo(1200);
    actions.nextSlide();
    expect(st().appState.presentation.frameIndex).toBe(1);
    actions.prevSlide();
    expect(st().appState.presentation.frameIndex).toBe(0);
    actions.stopPresentation();
    expect(st().appState.viewModeEnabled).toBe(false);
  });

  it('adds selection to the library normalized and inserts clones', async () => {
    const { useLibraryStore } = await import('@/store/libraryStore');
    useLibraryStore.getState().clear();
    const [a] = addCommitted(rect(100, 200, 50, 50));
    select(a.id);
    actions.addSelectionToLibrary();
    const item = useLibraryStore.getState().items[0];
    expect(item.elements[0].x).toBe(0);
    expect(item.elements[0].y).toBe(0);
    actions.insertLibraryItem(item.id, { x: 1000, y: 1000 });
    const ins = visible()[1];
    expect(ins.id).not.toBe(a.id);
    expect(ins.x).toBe(975);
    expect(JSON.parse(localStorage.getItem('sketchboard:library')!).state.items).toHaveLength(1);
  });
});
