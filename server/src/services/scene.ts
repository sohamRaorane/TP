import { randomInt } from 'node:crypto';
import type { BinaryFiles, SceneData, SketchElement } from '../../../shared/element';
import { shouldAcceptRemote } from '../../../shared/element';

export const emptyScene = (): SceneData => ({
  type: 'sketchboard',
  version: 1,
  elements: [],
  appState: {},
  files: {},
});

export const countVisible = (elements: readonly SketchElement[]): number =>
  elements.reduce((n, el) => (el.isDeleted ? n : n + 1), 0);

export const newVersionNonce = (): number => randomInt(0, 2 ** 31 - 1);

/**
 * Reconciles `incoming` into `base` with shouldAcceptRemote. Order: base order,
 * then new ids in incoming order. Returns the merged list and the accepted elements.
 */
export function reconcileElements(
  base: readonly SketchElement[],
  incoming: readonly SketchElement[],
): { elements: SketchElement[]; accepted: SketchElement[] } {
  const map = new Map(base.map((el) => [el.id, el]));
  const order = base.map((el) => el.id);
  const accepted: SketchElement[] = [];
  for (const el of incoming) {
    const local = map.get(el.id);
    if (!shouldAcceptRemote(local, el)) continue;
    if (!local) order.push(el.id);
    map.set(el.id, el);
    accepted.push(el);
  }
  return { elements: order.map((id) => map.get(id)!), accepted };
}

/** Drops tombstones whose last change is older than `ttlMs`. */
export const pruneTombstones = (elements: readonly SketchElement[], ttlMs: number, now = Date.now()) =>
  elements.filter((el) => !el.isDeleted || now - el.updated <= ttlMs);

/** Keeps only files referenced by an image element. */
export function referencedFiles(elements: readonly SketchElement[], files: BinaryFiles): BinaryFiles {
  const used = new Set(elements.flatMap((el) => (el.type === 'image' ? [el.fileId] : [])));
  return Object.fromEntries(Object.entries(files).filter(([id]) => used.has(id)));
}

/**
 * Builds the scene that restoring `snapshot` over `current` produces. Every
 * restored element gets a version above both copies (and a new nonce) and
 * every current element missing from the snapshot becomes a tombstone, so
 * connected clients accept the restore through normal reconciliation.
 */
export function buildRestoredScene(current: SceneData, snapshot: SceneData, now = Date.now()): SceneData {
  const currentById = new Map(current.elements.map((el) => [el.id, el]));
  const snapshotIds = new Set(snapshot.elements.map((el) => el.id));
  const bump = <T extends SketchElement>(el: T, version: number, patch: { isDeleted?: boolean } = {}): T => ({
    ...el,
    ...patch,
    version: version + 1,
    versionNonce: newVersionNonce(),
    updated: now,
  });
  const restored = snapshot.elements.map((el) =>
    bump(el, Math.max(el.version, currentById.get(el.id)?.version ?? 0)),
  );
  const removed = current.elements
    .filter((el) => !snapshotIds.has(el.id))
    .map((el) => (el.isDeleted ? el : bump(el, el.version, { isDeleted: true })));
  const elements = [...restored, ...removed];
  return {
    ...snapshot,
    elements,
    files: referencedFiles(elements, { ...current.files, ...snapshot.files }),
  };
}
