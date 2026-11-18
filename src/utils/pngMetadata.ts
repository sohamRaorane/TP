// Embed / extract the scene JSON in a PNG `tEXt` chunk so exported PNGs can be re-imported.
const KEYWORD = 'sketchboard';
const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;
const crc32 = (bytes: Uint8Array) => {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const utf8ToBase64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const base64ToUtf8 = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));

const isPng = (b: Uint8Array) => SIG.every((v, i) => b[i] === v);

/** insert a tEXt chunk (keyword "sketchboard", base64 UTF-8 JSON) right after IHDR */
export function embedSceneInPng(png: Uint8Array, json: string): Uint8Array {
  if (!isPng(png)) return png;
  const text = new TextEncoder().encode(`${KEYWORD}\0${utf8ToBase64(json)}`);
  const chunk = new Uint8Array(12 + text.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, text.length);
  chunk.set([116, 69, 88, 116], 4); // 'tEXt'
  chunk.set(text, 8);
  dv.setUint32(8 + text.length, crc32(chunk.subarray(4, 8 + text.length)));
  const ihdrEnd = 8 + 12 + new DataView(png.buffer, png.byteOffset).getUint32(8);
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

/** returns the embedded scene JSON string, or null */
export function extractSceneFromPng(png: Uint8Array): string | null {
  if (!isPng(png)) return null;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let off = 8;
  while (off + 12 <= png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    if (type === 'tEXt') {
      const data = png.subarray(off + 8, off + 8 + len);
      const zero = data.indexOf(0);
      if (zero > 0 && new TextDecoder().decode(data.subarray(0, zero)) === KEYWORD) {
        try {
          return base64ToUtf8(new TextDecoder().decode(data.subarray(zero + 1)));
        } catch {
          return null;
        }
      }
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  return null;
}
