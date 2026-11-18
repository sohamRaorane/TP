// Decoded HTMLImageElement cache keyed by fileId (+ dataURL identity).
import type { BinaryFiles } from '@/types/appState';

const images = new Map<string, { src: string; img: HTMLImageElement; ready: boolean; failed: boolean }>();
const listeners = new Set<() => void>();

export const onImageLoaded = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getImage = (fileId: string, files: BinaryFiles): HTMLImageElement | null => {
  const file = files[fileId];
  if (!file?.dataURL) return null;
  const hit = images.get(fileId);
  if (hit && hit.src === file.dataURL) return hit.ready ? hit.img : null;
  if (typeof Image === 'undefined') return null;
  const img = new Image();
  const entry = { src: file.dataURL, img, ready: false, failed: false };
  images.set(fileId, entry);
  img.onload = () => {
    entry.ready = true;
    listeners.forEach((l) => l());
  };
  img.onerror = () => {
    entry.failed = true;
  };
  img.src = file.dataURL;
  if (img.complete && img.naturalWidth) entry.ready = true;
  return entry.ready ? img : null;
};

/** for exports: wait until every image used is decoded */
export const preloadImages = async (fileIds: string[], files: BinaryFiles) => {
  await Promise.all(
    fileIds.map(
      (id) =>
        new Promise<void>((resolve) => {
          const file = files[id];
          if (!file || typeof Image === 'undefined') return resolve();
          const img = getImage(id, files);
          if (img) return resolve();
          const entry = images.get(id);
          if (!entry) return resolve();
          entry.img.addEventListener('load', () => resolve(), { once: true });
          entry.img.addEventListener('error', () => resolve(), { once: true });
          setTimeout(resolve, 3000);
        }),
    ),
  );
};
