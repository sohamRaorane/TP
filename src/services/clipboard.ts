// Clipboard (de)serialization + system clipboard access with an in-memory fallback.
// Native copy/cut/paste DOM events are wired by installClipboardListeners (mounted by
// useKeyboardShortcuts) because some browsers deny navigator.clipboard.read().
import { z } from 'zod';
import type { BinaryFiles, SketchElement } from '@/types/appState';
import { binaryFileSchema, elementSchema } from '@shared/schema';
import { referencedFiles } from './sceneData';
import { isEditableTarget } from '@/utils/dom';
import { screenToScene } from '@/engine/coordinates';
import { useCanvasStore } from '@/store/canvasStore';

export const CLIPBOARD_TYPE = 'sketchboard/clipboard';

export interface ClipboardPayload {
  type: typeof CLIPBOARD_TYPE;
  elements: SketchElement[];
  files: BinaryFiles;
}

const clipboardSchema = z.object({
  type: z.literal(CLIPBOARD_TYPE),
  elements: z.array(elementSchema),
  files: z.record(z.string(), binaryFileSchema).default({}),
});
const sceneLikeSchema = z.object({
  type: z.literal('sketchboard'),
  elements: z.array(elementSchema),
  files: z.record(z.string(), binaryFileSchema).default({}),
});

let memory: string | null = null;

export function serializeClipboard(elements: readonly SketchElement[], files: BinaryFiles): string {
  const live = elements.filter((e) => !e.isDeleted);
  const payload: ClipboardPayload = { type: CLIPBOARD_TYPE, elements: live, files: referencedFiles(live, files) };
  return JSON.stringify(payload);
}

/** our clipboard JSON or a full SceneData document -> elements + files; null for anything else */
export function parseClipboard(text: string): { elements: SketchElement[]; files: BinaryFiles } | null {
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch {
    return null;
  }
  const r = clipboardSchema.safeParse(v);
  if (r.success) return { elements: r.data.elements as SketchElement[], files: r.data.files };
  const s = sceneLikeSchema.safeParse(v);
  if (s.success) return { elements: (s.data.elements as SketchElement[]).filter((e) => !e.isDeleted), files: s.data.files };
  return null;
}

/** write to the system clipboard (best effort) and always to memory */
export async function writeClipboardText(text: string): Promise<void> {
  memory = text;
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    /* permission denied: memory fallback still works inside this tab */
  }
}

export const getMemoryClipboard = () => memory;
export const setMemoryClipboard = (t: string | null) => {
  memory = t;
};

export interface ClipboardContent {
  images: File[];
  text: string | null;
}

/** read images + text via the async clipboard API, falling back to readText and memory */
export async function readClipboard(): Promise<ClipboardContent> {
  const out: ClipboardContent = { images: [], text: null };
  const cb = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (cb && typeof cb.read === 'function') {
    try {
      const items = await cb.read();
      for (const item of items) {
        const img = item.types.find((t) => t.startsWith('image/'));
        if (img) {
          const blob = await item.getType(img);
          out.images.push(new File([blob], `pasted.${img.split('/')[1] ?? 'png'}`, { type: img }));
        } else if (item.types.includes('text/plain') && out.text === null) {
          out.text = await (await item.getType('text/plain')).text();
        }
      }
      if (out.images.length || out.text !== null) return out;
    } catch {
      /* fall through */
    }
  }
  if (cb && typeof cb.readText === 'function') {
    try {
      out.text = await cb.readText();
      if (out.text) return out;
    } catch {
      /* fall through */
    }
  }
  out.text = memory;
  return out;
}

/** content of a native paste event */
export function readClipboardEvent(e: ClipboardEvent): ClipboardContent {
  const dt = e.clipboardData;
  const images: File[] = [];
  if (dt) for (const f of Array.from(dt.files ?? [])) if (f.type.startsWith('image/')) images.push(f);
  return { images, text: dt?.getData('text/plain') ?? null };
}

// ---------------------------------------------------------------- pointer tracking
let lastPointer: { x: number; y: number } | null = null; // screen px relative to canvas

/** last pointer position over the canvas, in scene coords (null if unknown) */
export function lastPointerScene(): { x: number; y: number } | null {
  if (!lastPointer) return null;
  return screenToScene(lastPointer.x, lastPointer.y, useCanvasStore.getState().appState);
}

export interface ClipboardHandlers {
  /** serialized selection, or null when nothing is selected (then the event is left alone) */
  serializeSelection: () => string | null;
  /** delete the selection after a cut */
  deleteSelection: () => void;
  paste: (content: ClipboardContent) => void | Promise<void>;
}

const hasPageTextSelection = () => {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
  return !!sel && !sel.isCollapsed && sel.toString().length > 0;
};

export function installClipboardListeners(h: ClipboardHandlers): () => void {
  const onCopyCut = (kind: 'copy' | 'cut') => (e: ClipboardEvent) => {
    if (isEditableTarget(e.target) || hasPageTextSelection()) return;
    if (useCanvasStore.getState().appState.editingTextId) return;
    const text = h.serializeSelection();
    if (!text) return;
    e.preventDefault();
    memory = text;
    try {
      e.clipboardData?.setData('text/plain', text);
    } catch {
      void writeClipboardText(text);
    }
    if (kind === 'cut') h.deleteSelection();
  };
  const onCopy = onCopyCut('copy');
  const onCut = onCopyCut('cut');
  // Linux primary-selection paste fires on middle-click; middle-click is our pan gesture
  let lastMiddleUp = -Infinity;
  const onMiddle = (e: PointerEvent | MouseEvent) => {
    if (e.button === 1) lastMiddleUp = performance.now();
  };
  const onPaste = (e: ClipboardEvent) => {
    if (isEditableTarget(e.target) || useCanvasStore.getState().appState.editingTextId) return;
    if (performance.now() - lastMiddleUp < 500) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    void h.paste(readClipboardEvent(e));
  };
  const onMove = (e: PointerEvent) => {
    const t = e.target;
    if (typeof HTMLCanvasElement !== 'undefined' && t instanceof HTMLCanvasElement) {
      const r = t.getBoundingClientRect();
      lastPointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    }
  };
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCut);
  document.addEventListener('paste', onPaste);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onMiddle, true);
  window.addEventListener('mouseup', onMiddle, true);
  window.addEventListener('auxclick', onMiddle, true);
  return () => {
    window.removeEventListener('pointerup', onMiddle, true);
    window.removeEventListener('mouseup', onMiddle, true);
    window.removeEventListener('auxclick', onMiddle, true);
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCut);
    document.removeEventListener('paste', onPaste);
    window.removeEventListener('pointermove', onMove);
  };
}
