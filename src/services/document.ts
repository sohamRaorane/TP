// Document lifecycle: open / create / load scenes. Used by actions, routing, persistence.
import type { Drawing } from '@shared/protocol';
import type { BinaryFiles, SceneData, SketchElement } from '@/types/appState';
import { useCanvasStore } from '@/store/canvasStore';
import { useCollaborationStore } from '@/store/collaborationStore';
import { api, ApiError } from './api';
import { buildSceneData, parseSceneData } from './sceneData';
import { readRecovery, writeRecovery, snapshotRecovery, type RecoveryData } from './recovery';
import { requestSave } from './saveSignal';
import { collab } from './collaboration';
import { setUrlDrawing } from '@/utils/url';
import { zoomToFit } from './viewport';

const st = () => useCanvasStore.getState();

export const DEFAULT_NAME = 'Untitled drawing';

/** current scene as SceneData (live elements, referenced files) */
export const currentSceneData = (): SceneData => {
  const s = st();
  return buildSceneData(s.elements, s.files, s.appState);
};

/** replace the scene from validated data (resets history) */
export function applySceneData(data: SceneData, meta: { drawingId: string | null; name?: string }) {
  const s = st();
  s.replaceScene(data.elements, data.files);
  s.setAppState({
    drawingId: meta.drawingId,
    name: meta.name ?? data.appState.name ?? DEFAULT_NAME,
    ...(data.appState.viewBackgroundColor ? { viewBackgroundColor: data.appState.viewBackgroundColor } : {}),
    ...(data.appState.gridEnabled !== undefined ? { gridEnabled: data.appState.gridEnabled } : {}),
    editingLinearId: null,
    presentation: { active: false, frameIndex: 0 },
  });
}

/** restore a recovery snapshot into the scene */
export function applyRecovery(r: RecoveryData) {
  const s = st();
  s.replaceScene(r.elements, r.files);
  s.setAppState({
    ...r.appState,
    drawingId: r.drawingId,
    name: r.name,
    saveStatus: r.synced ? 'saved' : 'unsaved',
  });
}

/**
 * Open a server drawing. Prefers the local recovery copy when it belongs to the
 * same drawing, has unsynced changes and is newer than the server copy.
 */
export async function openDrawing(id: string): Promise<void> {
  if (collab.roomId && collab.roomId !== id) collab.disconnect();
  const rec = readRecovery();
  let d: Drawing;
  try {
    d = await api.getDrawing(id);
  } catch (e) {
    if (e instanceof ApiError && e.isOffline && rec && rec.drawingId === id) {
      applyRecovery(rec);
      st().setAppState({ saveStatus: 'offline' });
      setUrlDrawing(id);
      requestSave();
      throw new ApiError(0, 'Server unreachable: showing your local copy');
    }
    throw e;
  }
  const parsed = parseSceneData(d.data);
  if (!parsed.ok) throw new Error(`The drawing on the server is damaged. ${parsed.error}`);
  const serverTime = Date.parse(d.updatedAt) || 0;
  if (rec && rec.drawingId === id && !rec.synced && rec.savedAt > serverTime) {
    applyRecovery(rec);
    setUrlDrawing(id);
    requestSave();
    return;
  }
  applySceneData(parsed.data, { drawingId: d.id, name: d.name });
  st().setAppState({ saveStatus: 'saved', lastSavedAt: serverTime || Date.now() });
  setUrlDrawing(d.id);
  zoomToFit();
  writeRecovery(snapshotRecovery(st().elements, st().files, st().appState, true));
}

/** create the current scene on the server; sets drawingId + URL */
export async function createDrawingOnServer(thumbnail: string | null = null): Promise<Drawing> {
  const data = currentSceneData();
  const d = await api.createDrawing({ name: st().appState.name || DEFAULT_NAME, data, thumbnail });
  st().setAppState({ drawingId: d.id, saveStatus: 'saved', lastSavedAt: Date.now() });
  if (!useCollaborationStore.getState().roomId) setUrlDrawing(d.id);
  return d;
}

/** blank scene; creates a server drawing when the server is reachable */
export async function newDrawing(): Promise<void> {
  if (collab.roomId) collab.disconnect();
  const s = st();
  s.replaceScene([], {});
  s.setAppState({
    drawingId: null,
    name: DEFAULT_NAME,
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
    saveStatus: 'idle',
    lastSavedAt: null,
    viewModeEnabled: false,
    followingSocketId: null,
    editingLinearId: null,
    presentation: { active: false, frameIndex: 0 },
  });
  setUrlDrawing(null);
  writeRecovery(snapshotRecovery([], {}, st().appState, true));
  if (await api.health()) {
    await createDrawingOnServer();
    writeRecovery(snapshotRecovery([], {}, st().appState, true));
  } else {
    st().setAppState({ saveStatus: 'offline' });
  }
}

/**
 * Replace the scene content in an undoable, sync-friendly way (import):
 * existing elements not in `next` are deleted (tombstones), same ids are updated, new ones added.
 */
export function loadSceneUndoable(next: SketchElement[], files: BinaryFiles) {
  const s = st();
  if (Object.keys(files).length) s.addFiles(files);
  const nextIds = new Set(next.map((e) => e.id));
  const toDelete = s.elements.filter((e) => !e.isDeleted && !nextIds.has(e.id)).map((e) => e.id);
  if (toDelete.length) st().deleteElements(toDelete);
  const byId = st().elementsById;
  const updates: Record<string, Record<string, unknown>> = {};
  const adds: SketchElement[] = [];
  for (const el of next) {
    if (byId[el.id]) {
      const { id: _id, ...rest } = el;
      void _id;
      updates[el.id] = { ...rest, isDeleted: false };
    } else adds.push(el);
  }
  if (Object.keys(updates).length) st().updateElements(updates);
  if (adds.length) st().addElements(adds);
  st().setSelection([]);
  st().commit();
}
