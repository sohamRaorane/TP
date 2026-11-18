// Image file helpers for insertImage.
export const readFileAsDataURL = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });

export const readFileAsText = (file: Blob): Promise<string> =>
  typeof file.text === 'function'
    ? file.text()
    : new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('Could not read the file'));
        r.readAsText(file);
      });

export const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be decoded'));
    img.src = src;
  });

/** scale (w, h) down so the longest side is <= max, preserving aspect */
export const fitSize = (w: number, h: number, max: number) => {
  const s = Math.min(1, max / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
};

/** downscale a decoded image to max px on its longest side; returns a new data URL or the original */
export function downscaleImage(img: HTMLImageElement, dataURL: string, mimeType: string, max = 2048): string {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (Math.max(w, h) <= max || mimeType === 'image/svg+xml' || mimeType === 'image/gif') return dataURL;
  const size = fitSize(w, h, max);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const c = canvas.getContext('2d');
  if (!c) return dataURL;
  c.drawImage(img, 0, 0, size.width, size.height);
  const out = mimeType === 'image/jpeg' || mimeType === 'image/webp' ? mimeType : 'image/png';
  return canvas.toDataURL(out, 0.92);
}

export const mimeFromDataURL = (d: string) => /^data:([^;,]+)/.exec(d)?.[1] ?? 'application/octet-stream';
