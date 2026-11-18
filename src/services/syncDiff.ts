// Pure helpers for collaboration sync (unit tested). No socket / store access.
import type { BinaryFiles, SketchElement } from '@/types/appState';
import { shouldAcceptRemote } from '@shared/element';
import { elementSchema } from '@shared/schema';
import type { PointerPayload } from '@shared/protocol';

/** element id -> last version we sent OR received (never echo those back) */
export type VersionMap = Map<string, number>;

/** local elements whose version differs from what was last broadcast/received */
export const collectChanged = (elements: readonly SketchElement[], known: VersionMap): SketchElement[] =>
  elements.filter((el) => known.get(el.id) !== el.version);

export const markKnown = (known: VersionMap, els: readonly SketchElement[]) => {
  for (const el of els) known.set(el.id, el.version);
};

/**
 * After applying remote elements, record versions of those now present locally
 * (accepted). Rejected ones are left so a newer local copy is still sent.
 */
export const markReceived = (
  known: VersionMap,
  incoming: readonly SketchElement[],
  localById: Record<string, SketchElement>,
) => {
  for (const el of incoming) {
    const cur = localById[el.id];
    if (cur && cur.version === el.version && cur.versionNonce === el.versionNonce) known.set(el.id, el.version);
  }
};

/** local elements that would win against the server copy (missing on the server or newer) */
export const localNewerThan = (local: readonly SketchElement[], remote: readonly SketchElement[]): SketchElement[] => {
  const r = new Map(remote.map((e) => [e.id, e]));
  return local.filter((el) => {
    const theirs = r.get(el.id);
    if (!theirs) return !el.isDeleted; // no point uploading never-shared tombstones
    return shouldAcceptRemote(theirs, el);
  });
};

/** files referenced by image elements in `els` that were not sent/received yet */
export const filesToSend = (els: readonly SketchElement[], files: BinaryFiles, sent: Set<string>): BinaryFiles => {
  const out: BinaryFiles = {};
  for (const el of els)
    if (el.type === 'image' && !el.isDeleted && files[el.fileId] && !sent.has(el.fileId)) out[el.fileId] = files[el.fileId];
  return out;
};

/** drop malformed elements from the network */
export const sanitizeIncoming = (els: unknown): SketchElement[] => {
  if (!Array.isArray(els)) return [];
  const out: SketchElement[] = [];
  for (const e of els) {
    const r = elementSchema.safeParse(e);
    if (r.success) out.push(r.data as SketchElement);
  }
  return out;
};

/** viewport that shows the same scene center at the same zoom as a followed user */
export const followViewport = (
  vp: NonNullable<PointerPayload['viewport']>,
  myWidth: number,
  myHeight: number,
) => {
  const cx = vp.width / 2 / vp.zoom - vp.scrollX;
  const cy = vp.height / 2 / vp.zoom - vp.scrollY;
  return { zoom: vp.zoom, scrollX: myWidth / 2 / vp.zoom - cx, scrollY: myHeight / 2 / vp.zoom - cy };
};

export const LASER_TTL = 1500;

/** re-stamp a remote laser trail to the local clock and drop points older than the TTL */
export const restampLaser = (points: Array<[number, number, number]>, now: number): Array<[number, number, number]> => {
  if (!points.length) return [];
  const newest = Math.max(...points.map((p) => p[2]));
  const offset = now - newest;
  return points.map(([x, y, t]) => [x, y, t + offset] as [number, number, number]).filter((p) => now - p[2] <= LASER_TTL);
};

export const pruneLaser = (points: Array<[number, number, number]>, now: number) =>
  points.filter((p) => now - p[2] <= LASER_TTL);
