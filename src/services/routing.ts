// Startup routing:
//   ?room=<id>     -> join that collaboration room (scene arrives via scene:init)
//   #drawing=<id>  -> open the server drawing (local recovery preferred if newer & unsynced)
//   otherwise      -> restore local recovery (re-opening its drawing from the server if it had one)
// initPersistence() calls initRouting() once; App only needs initPersistence().
import { useCanvasStore } from '@/store/canvasStore';
import { api, ApiError } from './api';
import { collab } from './collaboration';
import { applyRecovery, openDrawing } from './document';
import { readRecovery, type RecoveryData } from './recovery';
import { requestSave } from './saveSignal';
import { getUrlState, setUrlDrawing } from '@/utils/url';
import { toast } from '@/utils/toast';
import { errorMessage } from '@/utils/errors';

let started: Promise<void> | null = null;

export function initRouting(): Promise<void> {
  if (!started) started = route();
  return started;
}

/** for tests */
export const __resetRouting = () => {
  started = null;
};

const st = () => useCanvasStore.getState();

async function route(): Promise<void> {
  const rec = readRecovery();
  // theme is a personal preference: always carry it over
  if (rec) st().setAppState({ theme: rec.appState.theme });
  const { room, drawing } = getUrlState();
  if (room) {
    try {
      await joinRoom(room);
      return;
    } catch (e) {
      toast(`Could not join the shared drawing: ${errorMessage(e)}`, 'error');
      return;
    }
  }
  if (drawing) {
    try {
      await openDrawing(drawing);
    } catch (e) {
      handleOpenError(e, rec, drawing);
    }
    return;
  }
  if (!rec) return;
  if (rec.drawingId) {
    try {
      await openDrawing(rec.drawingId);
    } catch (e) {
      handleOpenError(e, rec, rec.drawingId);
    }
    return;
  }
  applyRecovery(rec);
  if (!rec.synced && rec.elements.length) requestSave();
}

function handleOpenError(e: unknown, rec: RecoveryData | null, id: string) {
  if (e instanceof ApiError && e.status === 404) {
    toast('That drawing does not exist (it may have been deleted).', 'error');
    if (rec && rec.drawingId === id) {
      // keep the local work as a new, unsaved drawing
      applyRecovery({ ...rec, drawingId: null });
      setUrlDrawing(null);
      if (rec.elements.length) requestSave();
    } else setUrlDrawing(null);
    return;
  }
  toast(errorMessage(e, 'Could not open the drawing'), e instanceof ApiError && e.status === 0 ? 'info' : 'error');
}

async function joinRoom(roomId: string) {
  st().replaceScene([], {});
  st().setAppState({ drawingId: null });
  await collab.connect(roomId);
  const drawingId = collab.drawingId ?? st().appState.drawingId;
  if (drawingId) {
    try {
      const d = await api.getDrawing(drawingId);
      st().setAppState({ name: d.name });
    } catch {
      /* name is cosmetic */
    }
  }
}
