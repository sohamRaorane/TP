// Local crash recovery snapshot in localStorage ('sketchboard:recovery').
import type { AppState, BinaryFiles, SketchElement } from '@/types/appState';
import { referencedFiles } from './sceneData';
import { sanitizeIncoming } from './syncDiff';
import { binaryFileSchema } from '@shared/schema';

export const RECOVERY_KEY = 'sketchboard:recovery';

export type RecoveryAppState = Pick<
  AppState,
  'scrollX' | 'scrollY' | 'zoom' | 'viewBackgroundColor' | 'gridEnabled' | 'theme' | 'name'
>;

export interface RecoveryData {
  elements: SketchElement[];
  files: BinaryFiles;
  appState: RecoveryAppState;
  drawingId: string | null;
  name: string;
  savedAt: number;
  /** true once the same content has been stored on the server */
  synced: boolean;
}

export function snapshotRecovery(
  elements: readonly SketchElement[],
  files: BinaryFiles,
  a: AppState,
  synced: boolean,
): RecoveryData {
  const live = elements.filter((e) => !e.isDeleted);
  return {
    elements: live,
    files: referencedFiles(live, files),
    appState: {
      scrollX: a.scrollX, scrollY: a.scrollY, zoom: a.zoom,
      viewBackgroundColor: a.viewBackgroundColor, gridEnabled: a.gridEnabled, theme: a.theme, name: a.name,
    },
    drawingId: a.drawingId,
    name: a.name,
    savedAt: Date.now(),
    synced,
  };
}

/** write; on quota errors retry without image files. Returns false if nothing could be stored. */
export function writeRecovery(data: RecoveryData): boolean {
  try {
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(data));
    return true;
  } catch {
    try {
      localStorage.setItem(RECOVERY_KEY, JSON.stringify({ ...data, files: {} }));
      return true;
    } catch {
      return false;
    }
  }
}

export function readRecovery(): RecoveryData | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RECOVERY_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<RecoveryData>;
    if (!v || !Array.isArray(v.elements)) return null;
    const files: BinaryFiles = {};
    for (const [id, f] of Object.entries(v.files ?? {})) {
      const r = binaryFileSchema.safeParse(f);
      if (r.success) files[id] = r.data;
    }
    const a = (v.appState ?? {}) as Partial<RecoveryAppState>;
    return {
      elements: sanitizeIncoming(v.elements),
      files,
      appState: {
        scrollX: Number.isFinite(a.scrollX) ? a.scrollX! : 0,
        scrollY: Number.isFinite(a.scrollY) ? a.scrollY! : 0,
        zoom: Number.isFinite(a.zoom) && a.zoom! > 0 ? a.zoom! : 1,
        viewBackgroundColor: typeof a.viewBackgroundColor === 'string' ? a.viewBackgroundColor : '#ffffff',
        gridEnabled: !!a.gridEnabled,
        theme: a.theme === 'dark' ? 'dark' : 'light',
        name: typeof a.name === 'string' ? a.name : 'Untitled drawing',
      },
      drawingId: typeof v.drawingId === 'string' ? v.drawingId : null,
      name: typeof v.name === 'string' ? v.name : 'Untitled drawing',
      savedAt: typeof v.savedAt === 'number' ? v.savedAt : 0,
      synced: !!v.synced,
    };
  } catch {
    return null;
  }
}

export function markRecoverySynced(drawingId: string | null) {
  const r = readRecovery();
  if (!r) return;
  writeRecovery({ ...r, drawingId: drawingId ?? r.drawingId, synced: true });
}

export const clearRecovery = () => {
  try {
    localStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* ignore */
  }
};
