// Autosave + local recovery.
//  (a) local recovery: debounced 500 ms snapshot into localStorage on every local change
//  (b) server autosave: debounced 1.5 s (max wait 10 s) PUT /api/drawings/:id, or POST to
//      create the drawing once the user drew something and the server is reachable
//  (c) beforeunload warning when changes exist that are neither on the server nor in recovery
// In a collaboration room the server persists the room, so (b) is skipped.
// initPersistence() also runs initRouting() (URL -> room / drawing / recovery) once.
import { useCanvasStore, selectors } from '@/store/canvasStore';
import { renderThumbnail } from '@/engine/rendering/thumbnail';
import { useCollaborationStore } from '@/store/collaborationStore';
import { api, ApiError } from './api';
import { snapshotRecovery, writeRecovery } from './recovery';
import { onSaveRequested } from './saveSignal';
import { currentSceneData, createDrawingOnServer } from './document';
import { initRouting } from './routing';
import { debounce } from '@/utils/timing';
import { toast } from '@/utils/toast';
import { errorMessage } from '@/utils/errors';

export const RECOVERY_DEBOUNCE_MS = 500;
export const SAVE_DEBOUNCE_MS = 1500;
export const SAVE_MAX_WAIT_MS = 10_000;
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 30_000;

const st = () => useCanvasStore.getState();
const inRoom = () => !!useCollaborationStore.getState().roomId;

// ---------------------------------------------------------------- state
let savedNonce = 0; // localNonce last stored on the server
let dirty = false; // server copy is behind
let saving: Promise<void> | null = null;
let again = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = RETRY_MIN_MS;
let lastRecoveryOk = true;
let lastErrorToast = '';

const setStatus = (saveStatus: ReturnType<typeof st>['appState']['saveStatus'], extra: { lastSavedAt?: number } = {}) => {
  if (st().appState.saveStatus !== saveStatus || extra.lastSavedAt) st().setAppState({ saveStatus, ...extra });
};

const canServerSave = () => !st().appState.viewModeEnabled && !inRoom();
const hasContent = () => selectors.visibleElements(st()).length > 0;

// ---------------------------------------------------------------- thumbnail
async function makeThumbnail(): Promise<string | null> {
  try {
    const s = st();
    const els = selectors.visibleElements(s);
    return els.length ? renderThumbnail(els, s.files) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- recovery
function saveRecovery() {
  const s = st();
  // in a room the server owns the document; outside, synced means the server is up to date
  const synced = inRoom() || (!dirty && !!s.appState.drawingId);
  lastRecoveryOk = writeRecovery(snapshotRecovery(s.elements, s.files, s.appState, synced));
}
const recoveryDebounced = debounce(saveRecovery, RECOVERY_DEBOUNCE_MS);

// ---------------------------------------------------------------- server save
async function saveToServer(): Promise<void> {
  if (saving) {
    again = true;
    return saving;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (!canServerSave()) return;
  const startNonce = st().localNonce;
  const run = async () => {
    const a = st().appState;
    if (!a.drawingId && !hasContent()) return;
    setStatus('saving');
    const thumbnail = await makeThumbnail();
    try {
      if (a.drawingId) {
        await api.updateDrawing(a.drawingId, { name: a.name, data: currentSceneData(), thumbnail });
      } else {
        if (!(await api.health())) throw new ApiError(0, 'Cannot reach the server');
        await createDrawingOnServer(thumbnail);
      }
      savedNonce = startNonce;
      dirty = st().localNonce !== savedNonce;
      retryDelay = RETRY_MIN_MS;
      lastErrorToast = '';
      setStatus(dirty ? 'unsaved' : 'saved', { lastSavedAt: Date.now() });
      saveRecovery();
    } catch (e) {
      if (e instanceof ApiError && e.isOffline) {
        setStatus('offline');
        scheduleRetry();
      } else if (e instanceof ApiError && e.status === 404 && a.drawingId) {
        // deleted elsewhere: keep the work by saving it as a new drawing
        st().setAppState({ drawingId: null });
        toast('This drawing no longer exists on the server; saving it as a new drawing.', 'info');
        again = true;
      } else {
        setStatus('error');
        const msg = `Autosave failed: ${errorMessage(e)}`;
        if (msg !== lastErrorToast) toast(msg, 'error');
        lastErrorToast = msg;
        scheduleRetry();
      }
      throw e;
    }
  };
  saving = run().finally(() => {
    saving = null;
    if (again) {
      again = false;
      if (dirty || !st().appState.drawingId) serverDebounced();
    }
  });
  return saving;
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (dirty || !st().appState.drawingId) void saveToServer().catch(() => undefined);
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
}

const serverDebounced = debounce(() => void saveToServer().catch(() => undefined), SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS);

/** a local change happened (localNonce bump or explicit request) */
function onLocalChange() {
  recoveryDebounced();
  if (!canServerSave()) return;
  if (!st().appState.drawingId && !hasContent()) return;
  dirty = true;
  if (st().appState.saveStatus !== 'offline' && st().appState.saveStatus !== 'saving') setStatus('unsaved');
  serverDebounced();
}

/** save immediately (Ctrl+S). Throws a readable error on failure. */
export async function saveNow(): Promise<void> {
  serverDebounced.cancel();
  recoveryDebounced.flush();
  if (inRoom()) {
    saveRecovery();
    return; // the collaboration server persists the room
  }
  if (st().appState.viewModeEnabled) throw new Error('View-only drawings cannot be saved');
  if (saving) await saving.catch(() => undefined);
  if (!st().appState.drawingId && !hasContent()) {
    saveRecovery();
    return;
  }
  dirty = true;
  await saveToServer();
}

export const hasUnsavedChanges = () => dirty || !!saving;

// ---------------------------------------------------------------- init
let routingStarted = false;

export function initPersistence(): () => void {
  savedNonce = st().localNonce;
  dirty = false;
  const unsubNonce = useCanvasStore.subscribe(
    (s) => s.localNonce,
    () => onLocalChange(),
  );
  // document-level settings are part of the recovery snapshot
  const unsubMeta = useCanvasStore.subscribe(
    (s) => `${s.appState.name}\u0000${s.appState.viewBackgroundColor}\u0000${s.appState.gridEnabled}\u0000${s.appState.theme}`,
    () => recoveryDebounced(),
  );
  const unsubSignal = onSaveRequested(() => onLocalChange());

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (recoveryDebounced.pending()) recoveryDebounced.flush();
    if (canServerSave() && hasUnsavedChanges() && !lastRecoveryOk) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  const onHide = () => {
    if (document.visibilityState === 'hidden' && recoveryDebounced.pending()) recoveryDebounced.flush();
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onHide);

  if (!routingStarted) {
    routingStarted = true;
    void initRouting().catch((e: unknown) => toast(errorMessage(e, 'Could not open the drawing'), 'error'));
  }

  return () => {
    unsubNonce();
    unsubMeta();
    unsubSignal();
    recoveryDebounced.flush();
    serverDebounced.cancel();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('visibilitychange', onHide);
  };
}

/** test helper */
export const __resetPersistenceForTests = () => {
  savedNonce = 0;
  dirty = false;
  saving = null;
  again = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = RETRY_MIN_MS;
  lastRecoveryOk = true;
  lastErrorToast = '';
  routingStarted = true; // tests call initRouting explicitly
  recoveryDebounced.cancel();
  serverDebounced.cancel();
};
