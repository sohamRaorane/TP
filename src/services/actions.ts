// User-level actions. CONTRACT — Agent C implements. UI (Agent B), keyboard
// shortcuts, context menu and command palette ALL call these; never duplicate logic in components.
// Every action that changes elements calls useCanvasStore.getState().commit() once at the end.
// Actions never throw: failures surface as appState.toast {kind:'error'}; the exceptions are
// startCollaboration (returns the share URL, rethrows after toasting) and insertDiagramFromText
// (throws a line-numbered parse error for the dialog to show).
import { v4 as uuid } from 'uuid';
import { embedFonts } from '@/utils/embedFont';
import type { BinaryFiles, DialogType, SketchElement, TextElement, ToolType } from '@/types/appState';
import { useCanvasStore, selectors, type ElementChanges } from '@/store/canvasStore';
import { useCollaborationStore } from '@/store/collaborationStore';
import { useLibraryStore } from '@/store/libraryStore';
import { cloneElements, newImage, newText } from '@/engine/drawing/newElement';
import { getCommonBounds } from '@/engine/transformations/bounds';
import { exportToCanvas, exportToSvg } from '@/engine/rendering';
import { getSelected, getSelectedWithBound, selectionGroupOf, selectionUnits, viewportCenter, live } from './scene';
import { alignUnits, distributeUnits, flipElements, moveElements, type AlignEdge } from './transform';
import { buildSceneData, parseSceneData } from './sceneData';
import {
  lastPointerScene,
  parseClipboard,
  readClipboard,
  serializeClipboard,
  writeClipboardText,
  type ClipboardContent,
} from './clipboard';
import * as viewport from './viewport';
import * as doc from './document';
import { saveNow as persistSaveNow } from './persistence';
import { api, ApiError } from './api';
import { collab } from './collaboration';
import * as presentation from './presentation';
import { insertDiagramFromText } from './textToDiagram';
import { downloadBlob, sanitizeFileName } from '@/utils/download';
import { toast } from '@/utils/toast';
import { errorMessage } from '@/utils/errors';
import { sha1Hex } from '@/utils/hash';
import { downscaleImage, fitSize, loadImage, mimeFromDataURL, readFileAsDataURL, readFileAsText } from '@/utils/image';
import { measureText } from '@/utils/textMeasure';
import { extractSceneFromPng, embedSceneInPng } from '@/utils/pngMetadata';
import { roomShareUrl, setUrlDrawing, setUrlRoom } from '@/utils/url';

const st = () => useCanvasStore.getState();
const canEdit = () => !st().appState.viewModeEnabled;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_SCENE_SIZE = 400;
export const DUPLICATE_OFFSET = 10;

// ---------------------------------------------------------------- error wrappers
const safe =
  <A extends unknown[]>(name: string, fn: (...a: A) => void) =>
  (...a: A): void => {
    try {
      fn(...a);
    } catch (e) {
      console.error(`[actions.${name}]`, e);
      toast(errorMessage(e, `${name} failed`), 'error');
    }
  };

const safeAsync =
  <A extends unknown[]>(name: string, fn: (...a: A) => Promise<void>) =>
  async (...a: A): Promise<void> => {
    try {
      await fn(...a);
    } catch (e) {
      console.error(`[actions.${name}]`, e);
      toast(errorMessage(e, `${name} failed`), 'error');
    }
  };

/** default insertion point: last pointer position over the canvas, else viewport center */
const defaultPoint = () => lastPointerScene() ?? viewportCenter(st().appState);

/** a selected frame drags its children along */
const withFrameChildren = (els: SketchElement[]): SketchElement[] => {
  const frames = new Set(els.filter((e) => e.type === 'frame').map((e) => e.id));
  if (!frames.size) return els;
  const ids = new Set(els.map((e) => e.id));
  const extra = live(st().elements).filter((e) => e.frameId && frames.has(e.frameId) && !ids.has(e.id));
  return [...els, ...extra];
};

const selectableIds = (els: readonly SketchElement[]) =>
  els.filter((e) => !(e.type === 'text' && e.containerId)).map((e) => e.id);

// ---------------------------------------------------------------- insertion helpers
/** clone elements with fresh ids, centered at `at`; adds files, selects, commits */
export function insertElementsAt(elements: readonly SketchElement[], files: BinaryFiles, at: { x: number; y: number }) {
  const src = elements.filter((e) => !e.isDeleted);
  if (!src.length) return [];
  const b = getCommonBounds(src as SketchElement[])!;
  const dx = at.x - (b.minX + b.maxX) / 2;
  const dy = at.y - (b.minY + b.maxY) / 2;
  const s = st();
  const liveFrames = new Set(live(s.elements).filter((e) => e.type === 'frame').map((e) => e.id));
  const srcIds = new Set(src.map((e) => e.id));
  const clones = cloneElements(src as SketchElement[], { x: dx, y: dy }).map((c, i) => {
    const fid = src[i].frameId;
    return fid && !srcIds.has(fid) && !liveFrames.has(fid) ? { ...c, frameId: null } : c;
  });
  const used: BinaryFiles = {};
  for (const c of clones) if (c.type === 'image' && files[c.fileId]) used[c.fileId] = files[c.fileId];
  if (Object.keys(used).length) s.addFiles(used);
  s.addElements(clones);
  s.setSelection(selectableIds(clones));
  s.setAppState({ activeTool: 'selection', editingGroupId: null });
  s.commit();
  return clones;
}

const URL_RE = /^(https?:\/\/|www\.)[^\s]+$/i;

function insertTextAt(text: string, at: { x: number; y: number }) {
  const s = st();
  const style = s.appState.currentItem;
  const clean = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').slice(0, 100_000);
  const m = measureText(clean, style.fontSize, style.fontFamily, 1.25);
  const el: TextElement = {
    ...newText({ x: at.x - m.width / 2, y: at.y - m.height / 2, width: m.width, height: m.height, style, text: clean }),
    link: URL_RE.test(clean.trim()) ? clean.trim() : null,
  };
  s.addElements([el], { select: true });
  s.setAppState({ activeTool: 'selection' });
  s.commit();
}

async function handlePasteContent(content: ClipboardContent, at?: { x: number; y: number }) {
  if (!canEdit()) return;
  const p = at ?? defaultPoint();
  if (content.images.length) {
    let i = 0;
    for (const img of content.images) {
      await insertImageImpl(img, { x: p.x + i * 20, y: p.y + i * 20 });
      i++;
    }
    return;
  }
  const text = content.text;
  if (!text || !text.trim()) {
    toast('Nothing to paste', 'info');
    return;
  }
  const parsed = parseClipboard(text);
  if (parsed) {
    insertElementsAt(parsed.elements, parsed.files, p);
    return;
  }
  insertTextAt(text.trim().startsWith('{') ? text : text.trim(), p);
}

async function insertImageImpl(file: File, at?: { x: number; y: number }) {
  if (!canEdit()) return;
  if (!file.type.startsWith('image/')) throw new Error(`"${file.name || 'file'}" is not an image`);
  if (file.size > MAX_IMAGE_BYTES) throw new Error('The image is too large (max 25 MB)');
  let dataURL = await readFileAsDataURL(file);
  const img = await loadImage(dataURL);
  dataURL = downscaleImage(img, dataURL, file.type, 2048);
  const mimeType = mimeFromDataURL(dataURL);
  const fileId = await sha1Hex(dataURL);
  const s = st();
  s.addFiles({ [fileId]: { id: fileId, mimeType, dataURL, created: Date.now() } });
  const size = fitSize(img.naturalWidth || img.width || MAX_IMAGE_SCENE_SIZE, img.naturalHeight || img.height || MAX_IMAGE_SCENE_SIZE, MAX_IMAGE_SCENE_SIZE);
  const p = at ?? defaultPoint();
  const el = newImage({
    x: p.x - size.width / 2,
    y: p.y - size.height / 2,
    width: size.width,
    height: size.height,
    style: s.appState.currentItem,
    fileId,
  });
  s.addElements([el], { select: true });
  s.setAppState({ activeTool: 'selection' });
  s.commit();
}

// ---------------------------------------------------------------- style
type StyleKey =
  | 'strokeColor' | 'backgroundColor' | 'fillStyle' | 'strokeWidth' | 'strokeStyle' | 'roughness' | 'opacity'
  | 'roundness' | 'fontSize' | 'fontFamily' | 'textAlign' | 'verticalAlign' | 'startArrowhead' | 'endArrowhead';

const SHAPE = new Set(['rectangle', 'diamond', 'ellipse']);
const LINEAR = new Set(['arrow', 'line']);
const STYLE_APPLIES: Record<StyleKey, (el: SketchElement) => boolean> = {
  strokeColor: (el) => el.type !== 'image',
  backgroundColor: (el) => SHAPE.has(el.type) || el.type === 'line' || el.type === 'freedraw',
  fillStyle: (el) => SHAPE.has(el.type) || el.type === 'line' || el.type === 'freedraw',
  strokeWidth: (el) => SHAPE.has(el.type) || LINEAR.has(el.type) || el.type === 'freedraw',
  strokeStyle: (el) => SHAPE.has(el.type) || LINEAR.has(el.type),
  roughness: (el) => SHAPE.has(el.type) || LINEAR.has(el.type) || el.type === 'freedraw',
  opacity: () => true,
  roundness: (el) => el.type === 'rectangle' || el.type === 'diamond' || LINEAR.has(el.type),
  fontSize: (el) => el.type === 'text',
  fontFamily: (el) => el.type === 'text',
  textAlign: (el) => el.type === 'text',
  verticalAlign: (el) => el.type === 'text',
  startArrowhead: (el) => el.type === 'arrow',
  endArrowhead: (el) => el.type === 'arrow',
};

/** per-element style changes (pure; exported for tests) */
export function styleChangesFor(
  els: readonly SketchElement[],
  changes: Record<string, unknown>,
  byId: Record<string, SketchElement>,
): Record<string, ElementChanges> {
  const out: Record<string, ElementChanges> = {};
  for (const el of els) {
    if (el.locked) continue;
    const ch: ElementChanges = {};
    for (const [k, v] of Object.entries(changes)) {
      const applies = STYLE_APPLIES[k as StyleKey];
      if (applies && applies(el)) ch[k] = v;
    }
    if (!Object.keys(ch).length) continue;
    if (el.type === 'text' && ('fontSize' in ch || 'fontFamily' in ch)) {
      const fontSize = (ch.fontSize as number | undefined) ?? el.fontSize;
      const fontFamily = (ch.fontFamily as TextElement['fontFamily'] | undefined) ?? el.fontFamily;
      const m = measureText(el.text, fontSize, fontFamily, el.lineHeight);
      const container = el.containerId ? byId[el.containerId] : undefined;
      if (container) {
        ch.x = container.x + (container.width - m.width) / 2;
        ch.y = container.y + (container.height - m.height) / 2;
        if (m.height + 20 > container.height) {
          out[container.id] = { ...(out[container.id] ?? {}), height: m.height + 20 };
          ch.y = container.y + 10;
        }
      } else if (el.textAlign === 'center') ch.x = el.x + (el.width - m.width) / 2;
      else if (el.textAlign === 'right') ch.x = el.x + el.width - m.width;
      ch.width = m.width;
      ch.height = m.height;
    }
    out[el.id] = { ...(out[el.id] ?? {}), ...ch };
  }
  return out;
}

// ---------------------------------------------------------------- export helpers
const exportTargets = (onlySelected: boolean) => {
  const sel = getSelectedWithBound();
  return onlySelected && sel.length ? sel : selectors.visibleElements(st());
};

const canvasToBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the PNG'))), 'image/png'),
  );

async function renderPng(opts: { scale: number; transparent: boolean; onlySelected: boolean; dark: boolean }) {
  const s = st();
  const els = exportTargets(opts.onlySelected);
  if (!els.length) throw new Error('Nothing to export: the canvas is empty');
  const canvas = exportToCanvas(els, s.files, {
    scale: opts.scale,
    padding: 16,
    background: opts.transparent ? null : opts.dark && s.appState.viewBackgroundColor === '#ffffff' ? '#121212' : s.appState.viewBackgroundColor,
    theme: opts.dark ? 'dark' : 'light',
  });
  const blob = await canvasToBlob(canvas);
  return { blob, els };
}

const fileBase = () => sanitizeFileName(st().appState.name);

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

async function importFileImpl(file: File) {
  if (!canEdit()) throw new Error('The drawing is read-only');
  const name = file.name.toLowerCase();
  const isPngFile = file.type === 'image/png' || name.endsWith('.png');
  if (isPngFile) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const json = extractSceneFromPng(bytes);
    if (json) return importSceneText(json);
  }
  if (file.type.startsWith('image/')) return insertImageImpl(file, viewportCenter(st().appState));
  const looksJson = file.type.includes('json') || /\.(json|sketchboard)$/.test(name) || !file.type;
  if (!looksJson) throw new Error(`Unsupported file type: ${file.name}`);
  return importSceneText(await readFileAsText(file));
}

function importSceneText(text: string) {
  const r = parseSceneData(text);
  if (!r.ok) {
    toast(r.error, 'error');
    return;
  }
  const { data } = r;
  doc.loadSceneUndoable(data.elements, data.files);
  st().setAppState({
    ...(data.appState.viewBackgroundColor ? { viewBackgroundColor: data.appState.viewBackgroundColor } : {}),
    ...(data.appState.gridEnabled !== undefined ? { gridEnabled: data.appState.gridEnabled } : {}),
    ...(data.appState.name && st().appState.name === doc.DEFAULT_NAME ? { name: data.appState.name } : {}),
  });
  viewport.zoomToFit();
  const n = data.elements.length;
  toast(`Imported ${n} element${n === 1 ? '' : 's'}`, 'success');
}

// ---------------------------------------------------------------- the actions
export const actions = {
  // selection & editing
  selectAll: safe('selectAll', () => {
    const s = st();
    const g = s.appState.editingGroupId;
    const ids = live(s.elements)
      .filter((e) => !e.locked && !(e.type === 'text' && e.containerId) && (!g || e.groupIds.includes(g)))
      .map((e) => e.id);
    s.setSelection(ids);
    s.setAppState({ activeTool: 'selection', editingLinearId: null });
  }),

  deleteSelected: safe('deleteSelected', () => deleteSelectedImpl()),

  duplicateSelected: safe('duplicateSelected', () => {
    if (!canEdit()) return;
    const picked = getSelectedWithBound();
    const sel = withFrameChildren(picked);
    if (!sel.length) return;
    const selIds = new Set(sel.map((e) => e.id));
    const pickedIds = new Set(picked.map((e) => e.id));
    // groups fully inside the selection get new ids; enclosing groups (e.g. editingGroupId) are kept
    const all = live(st().elements);
    const fullyInside = (g: string) => all.every((e) => !e.groupIds.includes(g) || selIds.has(e.id));
    const clones = cloneElements(sel, { x: DUPLICATE_OFFSET, y: DUPLICATE_OFFSET }).map((c, i) => ({
      ...c,
      groupIds: c.groupIds.map((g, j) => (fullyInside(sel[i].groupIds[j]) ? g : sel[i].groupIds[j])),
    }));
    const s = st();
    s.addElements(clones);
    s.setSelection(selectableIds(clones.filter((_, i) => pickedIds.has(sel[i].id))));
    s.commit();
  }),

  copy: safeAsync('copy', async () => {
    const text = serializeSelection();
    if (text) await writeClipboardText(text);
  }),

  cut: safeAsync('cut', async () => {
    const text = serializeSelection();
    if (!text) return;
    await writeClipboardText(text);
    if (canEdit()) deleteSelectedImpl();
  }),

  /** paste at scene point (defaults to last pointer / viewport center); handles elements JSON, images, plain text */
  paste: safeAsync('paste', async (at?: { x: number; y: number }) => {
    if (!canEdit()) return;
    await handlePasteContent(await readClipboard(), at);
  }),

  group: safe('group', () => {
    if (!canEdit()) return;
    const sel = getSelectedWithBound().filter((e) => !e.locked);
    if (selectableIds(sel).length < 2) return;
    const editing = st().appState.editingGroupId;
    // already exactly one group at this level -> nothing to do
    const groups = new Set(sel.map((e) => selectionGroupOf(e, editing)));
    const all = live(st().elements);
    if (groups.size === 1 && [...groups][0] && all.filter((e) => e.groupIds.includes([...groups][0]!)).length === sel.length)
      return;
    const gid = uuid();
    const changes: Record<string, ElementChanges> = {};
    for (const el of sel) {
      const i = editing ? el.groupIds.indexOf(editing) : -1;
      const groupIds = i >= 0 ? [...el.groupIds.slice(0, i), gid, ...el.groupIds.slice(i)] : [...el.groupIds, gid];
      changes[el.id] = { groupIds };
    }
    st().updateElements(changes);
    st().commit();
  }),

  ungroup: safe('ungroup', () => {
    if (!canEdit()) return;
    const editing = st().appState.editingGroupId;
    const targets = new Set(
      getSelectedWithBound()
        .map((e) => selectionGroupOf(e, editing))
        .filter((g): g is string => !!g),
    );
    if (!targets.size) return;
    const changes: Record<string, ElementChanges> = {};
    for (const el of live(st().elements))
      if (el.groupIds.some((g) => targets.has(g))) changes[el.id] = { groupIds: el.groupIds.filter((g) => !targets.has(g)) };
    st().updateElements(changes);
    st().commit();
  }),

  toggleLock: safe('toggleLock', () => {
    if (!canEdit()) return;
    const sel = getSelectedWithBound();
    if (!sel.length) return;
    const lock = sel.some((e) => !e.locked);
    st().updateElements(Object.fromEntries(sel.map((e) => [e.id, { locked: lock }])));
    st().commit();
  }),

  bringForward: safe('bringForward', () => reorder('forward')),
  sendBackward: safe('sendBackward', () => reorder('backward')),
  bringToFront: safe('bringToFront', () => reorder('front')),
  sendToBack: safe('sendToBack', () => reorder('back')),

  flip: safe('flip', (axis: 'horizontal' | 'vertical') => {
    if (!canEdit()) return;
    const sel = withFrameChildren(getSelectedWithBound());
    const changes = flipElements(sel, axis);
    if (!Object.keys(changes).length) return;
    st().updateElements(changes);
    st().commit();
  }),

  align: safe('align', (edge: AlignEdge) => {
    if (!canEdit()) return;
    const changes = alignUnits(selectionUnits(withFrameChildren(getSelectedWithBound()), st().appState.editingGroupId), edge);
    if (!Object.keys(changes).length) return;
    st().updateElements(changes);
    st().commit();
  }),

  distribute: safe('distribute', (axis: 'horizontal' | 'vertical') => {
    if (!canEdit()) return;
    const changes = distributeUnits(selectionUnits(withFrameChildren(getSelectedWithBound()), st().appState.editingGroupId), axis);
    if (!Object.keys(changes).length) return;
    st().updateElements(changes);
    st().commit();
  }),

  /** apply style to selection AND remember as currentItem default */
  setStyle: safe('setStyle', (changes: Record<string, unknown>) => {
    const s = st();
    const cur = s.appState.currentItem;
    const itemPatch = Object.fromEntries(Object.entries(changes).filter(([k]) => k in cur));
    if (Object.keys(itemPatch).length) s.setAppState({ currentItem: { ...cur, ...itemPatch } });
    if (!canEdit()) return;
    const els = getSelectedWithBound();
    if (!els.length) return;
    const ch = styleChangesFor(els, changes, st().elementsById);
    if (!Object.keys(ch).length) return;
    st().updateElements(ch);
    st().commit();
  }),

  moveSelection: safe('moveSelection', (dx: number, dy: number) => {
    if (!canEdit()) return;
    const sel = withFrameChildren(getSelectedWithBound()).filter((e) => !e.locked);
    if (!sel.length) return;
    const changes = moveElements(st().elements, new Set(sel.map((e) => e.id)), dx, dy);
    st().updateElements(changes);
    st().commit();
  }),

  undo: safe('undo', () => {
    if (canEdit()) st().undo();
  }),
  redo: safe('redo', () => {
    if (canEdit()) st().redo();
  }),

  // viewport
  zoomIn: safe('zoomIn', viewport.zoomIn),
  zoomOut: safe('zoomOut', viewport.zoomOut),
  resetZoom: safe('resetZoom', viewport.resetZoom),
  zoomToFit: safe('zoomToFit', viewport.zoomToFit),
  zoomToSelection: safe('zoomToSelection', viewport.zoomToSelection),

  // document
  newDrawing: safeAsync('newDrawing', async () => {
    presentation.stopPresentation();
    await doc.newDrawing();
  }),

  clearCanvas: safe('clearCanvas', () => {
    if (!canEdit()) return;
    const ids = selectors.visibleElements(st()).map((e) => e.id);
    if (!ids.length) return;
    st().deleteElements(ids);
    st().setAppState({ editingGroupId: null, editingLinearId: null });
    st().commit();
  }),

  saveNow: safeAsync('saveNow', async () => {
    await persistSaveNow();
    const a = st().appState;
    if (a.saveStatus === 'saved' || useCollaborationStore.getState().roomId) toast('Saved', 'success', 1500);
    else if (!a.drawingId) toast('Saved locally in this browser', 'info');
  }),

  openDrawing: safeAsync('openDrawing', async (id: string) => {
    presentation.stopPresentation();
    await doc.openDrawing(id);
  }),

  rename: safeAsync('rename', async (name: string) => {
    const clean = name.trim().slice(0, 200) || doc.DEFAULT_NAME;
    st().setAppState({ name: clean });
    const id = st().appState.drawingId;
    if (!id || useCollaborationStore.getState().role === 'view') return;
    try {
      await api.updateDrawing(id, { name: clean });
    } catch (e) {
      if (e instanceof ApiError && e.isOffline) toast('Renamed locally; the name syncs when the server is back', 'info');
      else throw e;
    }
  }),

  // import / export
  exportPNG: safeAsync('exportPNG', async (opts: { scale: number; transparent: boolean; onlySelected: boolean; dark: boolean }) => {
    const { blob, els } = await renderPng(opts);
    const s = st();
    let out: Blob = blob;
    try {
      const json = JSON.stringify(buildSceneData(els, s.files, s.appState));
      out = new Blob([embedSceneInPng(new Uint8Array(await blob.arrayBuffer()), json) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
    } catch {
      /* metadata is optional */
    }
    downloadBlob(out, `${fileBase()}.png`);
  }),

  exportSVG: safeAsync('exportSVG', async (opts: { transparent: boolean; onlySelected: boolean; dark: boolean }) => {
    const s = st();
    const els = exportTargets(opts.onlySelected);
    if (!els.length) throw new Error('Nothing to export: the canvas is empty');
    const svg = exportToSvg(els, s.files, {
      padding: 16,
      background: opts.transparent ? null : opts.dark && s.appState.viewBackgroundColor === '#ffffff' ? '#121212' : s.appState.viewBackgroundColor,
      theme: opts.dark ? 'dark' : 'light',
    });
    await embedFonts(svg);
    const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
    downloadBlob(new Blob([text], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
  }),

  exportJSON: safe('exportJSON', () => {
    const s = st();
    const data = buildSceneData(s.elements, s.files, s.appState);
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${fileBase()}.sketchboard.json`);
  }),

  copyAsPNG: safeAsync('copyAsPNG', async () => {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write)
      throw new Error('Copying images is not supported in this browser');
    const blobPromise = renderPng({ scale: 2, transparent: false, onlySelected: true, dark: st().appState.theme === 'dark' }).then((r) => r.blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
    toast('Copied as PNG', 'success');
  }),

  importFile: safeAsync('importFile', importFileImpl),
  insertImage: safeAsync('insertImage', insertImageImpl),

  // collaboration
  /** ensures the drawing exists on the server, joins its room, returns the absolute share URL */
  startCollaboration: async (mode: 'edit' | 'view' = 'edit'): Promise<string> => {
    try {
      const cs = useCollaborationStore.getState();
      if (cs.roomId && cs.role === 'view') return roomShareUrl(cs.roomId);
      if (!(await api.health())) throw new Error('The collaboration server is not reachable. Check your connection and try again.');
      presentation.stopPresentation();
      if (!st().appState.drawingId) await doc.createDrawingOnServer();
      else if (!cs.roomId) await persistSaveNow();
      const id = st().appState.drawingId!;
      if (collab.roomId !== id) {
        await collab.connect(id);
        setUrlRoom(id);
      }
      if (mode === 'view') {
        const r = await api.shareDrawing(id, 'view');
        return roomShareUrl(r.roomId);
      }
      return roomShareUrl(id);
    } catch (e) {
      toast(errorMessage(e, 'Could not start the live session'), 'error');
      throw e;
    }
  },

  stopCollaboration: safe('stopCollaboration', () => {
    const role = useCollaborationStore.getState().role;
    collab.disconnect();
    if (role === 'view') {
      st().setAppState({ viewModeEnabled: false, drawingId: null });
      setUrlDrawing(null);
    } else setUrlDrawing(st().appState.drawingId);
  }),

  followUser: safe('followUser', (socketId: string | null) => {
    st().setAppState({ followingSocketId: socketId });
  }),

  // library
  addSelectionToLibrary: safe('addSelectionToLibrary', (name?: string) => {
    const sel = withFrameChildren(getSelectedWithBound());
    if (!sel.length) {
      toast('Select something to add to the library', 'info');
      return;
    }
    const b = getCommonBounds(sel)!;
    const normalized = sel.map((e) => ({ ...structuredClone(e), x: e.x - b.minX, y: e.y - b.minY, isDeleted: false }) as SketchElement);
    const lib = useLibraryStore.getState();
    lib.add(name ?? `Item ${lib.items.length + 1}`, normalized);
    toast('Added to library', 'success');
  }),

  insertLibraryItem: safe('insertLibraryItem', (itemId: string, at?: { x: number; y: number }) => {
    if (!canEdit()) return;
    const item = useLibraryStore.getState().items.find((i) => i.id === itemId);
    if (!item) throw new Error('Library item not found');
    insertElementsAt(item.elements, {}, at ?? viewportCenter(st().appState));
  }),

  // presentation
  startPresentation: safe('startPresentation', presentation.startPresentation),
  stopPresentation: safe('stopPresentation', presentation.stopPresentation),
  nextSlide: safe('nextSlide', presentation.nextSlide),
  prevSlide: safe('prevSlide', presentation.prevSlide),

  // ---------------------------------------------------------------- extras (C additions)
  /** switch tool (keyboard / toolbar); 'image' opens the file picker */
  setTool: safe('setTool', (tool: ToolType) => {
    if (tool === 'image') {
      void pickImage();
      return;
    }
    const s = st();
    if (s.appState.viewModeEnabled && tool !== 'hand' && tool !== 'selection' && tool !== 'laser') return;
    const keepSelection = tool === 'selection' || tool === 'hand' || tool === 'laser';
    s.setAppState({
      activeTool: tool,
      editingLinearId: null,
      ...(keepSelection ? {} : { selectedElementIds: {}, editingGroupId: null }),
    });
  }),
  toggleToolLock: safe('toggleToolLock', () => st().setAppState((a) => ({ toolLocked: !a.toolLocked }))),
  toggleGrid: safe('toggleGrid', () => st().setAppState((a) => ({ gridEnabled: !a.gridEnabled }))),
  toggleSnap: safe('toggleSnap', () => st().setAppState((a) => ({ snapEnabled: !a.snapEnabled }))),
  toggleZen: safe('toggleZen', () => st().setAppState((a) => ({ zenMode: !a.zenMode }))),
  toggleViewMode: safe('toggleViewMode', () => {
    if (useCollaborationStore.getState().role === 'view' && useCollaborationStore.getState().roomId) return;
    st().setAppState((a) => ({ viewModeEnabled: !a.viewModeEnabled, selectedElementIds: {}, editingTextId: null }));
  }),
  toggleTheme: safe('toggleTheme', () => st().setAppState((a) => ({ theme: a.theme === 'dark' ? 'light' : 'dark' }))),
  toggleMinimap: safe('toggleMinimap', () => st().setAppState((a) => ({ showMinimap: !a.showMinimap }))),
  openDialog: safe('openDialog', (d: DialogType) => st().setAppState({ openDialog: d, contextMenu: null })),
  toggleDialog: safe('toggleDialog', (d: Exclude<DialogType, null>) =>
    st().setAppState((a) => ({ openDialog: a.openDialog === d ? null : d, contextMenu: null })),
  ),
  /** open a file picker and insert the chosen image at the viewport center */
  pickImage: () => pickImage(),
  /** open a file picker for .sketchboard.json / PNG with embedded scene / images */
  pickAndImport: safeAsync('pickAndImport', async () => {
    const f = await pickFile('.json,.sketchboard,application/json,image/*');
    if (f) await importFileImpl(f);
  }),
  /** paste handler for native paste events (see services/clipboard.ts) */
  pasteContent: safeAsync('pasteContent', (content: ClipboardContent, at?: { x: number; y: number }) => handlePasteContent(content, at)),
  /** throws a line-numbered Error on parse problems so the dialog can show it */
  insertDiagramFromText: (text: string): void => insertDiagramFromText(text),
  /** set (or clear) the link of the selected elements */
  setLink: safe('setLink', (link: string | null) => {
    if (!canEdit()) return;
    const sel = getSelected().filter((e) => !e.locked);
    if (!sel.length) return;
    const clean = link && link.trim() ? link.trim().slice(0, 2000) : null;
    st().updateElements(Object.fromEntries(sel.map((e) => [e.id, { link: clean }])));
    st().commit();
  }),
  /** numeric geometry edit (properties panel); keeps linear points / bound text consistent */
  updateGeometry: safe('updateGeometry', (id: string, g: { x?: number; y?: number; width?: number; height?: number; angle?: number }) => {
    if (!canEdit()) return;
    const el = st().elementsById[id];
    if (!el || el.isDeleted || el.locked) return;
    const ch: ElementChanges = {};
    for (const k of ['x', 'y', 'width', 'height', 'angle'] as const) {
      const v = g[k];
      if (v === undefined || !Number.isFinite(v)) continue;
      ch[k] = k === 'width' || k === 'height' ? Math.max(1, v) : v;
    }
    if (!Object.keys(ch).length) return;
    if ((el.type === 'arrow' || el.type === 'line' || el.type === 'freedraw') && (ch.width !== undefined || ch.height !== undefined)) {
      const sx = ch.width !== undefined && el.width ? (ch.width as number) / el.width : 1;
      const sy = ch.height !== undefined && el.height ? (ch.height as number) / el.height : 1;
      ch.points = el.points.map(([px, py]) => [px * sx, py * sy]);
    }
    const all: Record<string, ElementChanges> = { [id]: ch };
    // keep a bound label centered / moved with its container
    const nx = (ch.x as number | undefined) ?? el.x, ny = (ch.y as number | undefined) ?? el.y;
    const nw = (ch.width as number | undefined) ?? el.width, nh = (ch.height as number | undefined) ?? el.height;
    for (const b of el.boundElements) {
      const t = st().elementsById[b.id];
      if (b.type === 'text' && t && !t.isDeleted)
        all[t.id] = { x: nx + (nw - t.width) / 2, y: ny + (nh - t.height) / 2, ...(ch.angle !== undefined ? { angle: ch.angle } : {}) };
    }
    st().updateElements(all);
    st().commit();
  }),
  updateUser: safe('updateUser', (p: { name?: string; color?: string }) => collab.updateUser(p)),
};

/** serialized selection (with bound text + frame children), null if nothing selected */
export function serializeSelection(): string | null {
  const els = withFrameChildren(getSelectedWithBound());
  return els.length ? serializeClipboard(els, st().files) : null;
}

function deleteSelectedImpl() {
  if (!canEdit()) return;
  const sel = withFrameChildren(getSelected().filter((e) => !e.locked));
  if (!sel.length) return;
  const s = st();
  s.deleteElements(sel.map((e) => e.id));
  const g = s.appState.editingGroupId;
  if (g && !live(st().elements).some((e) => e.groupIds.includes(g))) st().setAppState({ editingGroupId: null });
  st().setAppState({ editingLinearId: null, hoveredElementId: null });
  st().commit();
}

const pickImage = safeAsync('pickImage', async () => {
  if (!canEdit()) return;
  const f = await pickFile('image/*');
  if (f) await insertImageImpl(f, viewportCenter(st().appState));
});

function reorder(dir: 'forward' | 'backward' | 'front' | 'back') {
  if (!canEdit()) return;
  const ids = withFrameChildren(getSelectedWithBound()).map((e) => e.id);
  if (!ids.length) return;
  st().reorder(ids, dir);
  st().commit();
}

export type Actions = typeof actions;
