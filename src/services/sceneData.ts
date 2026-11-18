// Build / parse the persisted document format (SceneData).
import { z } from 'zod';
import type { AppState, BinaryFiles, SceneData, SketchElement } from '@/types/appState';
import { elementSchema, sceneDataSchema } from '@shared/schema';

/** only files referenced by live image elements */
export const referencedFiles = (elements: readonly SketchElement[], files: BinaryFiles): BinaryFiles => {
  const out: BinaryFiles = {};
  for (const el of elements)
    if (el.type === 'image' && !el.isDeleted && files[el.fileId]) out[el.fileId] = files[el.fileId];
  return out;
};

export function buildSceneData(
  elements: readonly SketchElement[],
  files: BinaryFiles,
  appState: Pick<AppState, 'viewBackgroundColor' | 'gridEnabled' | 'theme' | 'name'>,
  source = typeof window !== 'undefined' ? window.location.origin : undefined,
): SceneData {
  const live = elements.filter((e) => !e.isDeleted);
  return {
    type: 'sketchboard',
    version: 1,
    ...(source ? { source } : {}),
    elements: live,
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor,
      gridEnabled: appState.gridEnabled,
      theme: appState.theme,
      name: appState.name,
    },
    files: referencedFiles(live, files),
  };
}

const formatIssue = (issue: z.core.$ZodIssue): string => {
  const path = issue.path.length ? issue.path.map(String).join('.') : '(root)';
  return `${path}: ${issue.message}`;
};

export type ParseResult = { ok: true; data: SceneData } | { ok: false; error: string };

/** validate unknown JSON (string or value) as SceneData with a readable error */
export function parseSceneData(input: unknown): ParseResult {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, error: 'The file is not valid JSON.' };
    }
  }
  if (!value || typeof value !== 'object') return { ok: false, error: 'The file does not contain a drawing.' };
  const t = (value as { type?: unknown }).type;
  if (t === 'excalidraw')
    return { ok: false, error: 'Excalidraw files are not supported yet; export as .sketchboard.json instead.' };
  if (t !== 'sketchboard') return { ok: false, error: 'This is not a Sketchboard file (missing "type": "sketchboard").' };
  const r = sceneDataSchema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues.slice(0, 3).map(formatIssue).join('; ');
    const more = r.error.issues.length > 3 ? ` (+${r.error.issues.length - 3} more)` : '';
    return { ok: false, error: `Invalid drawing file: ${issues}${more}` };
  }
  return { ok: true, data: r.data as SceneData };
}

export const elementsArraySchema = z.array(elementSchema);
