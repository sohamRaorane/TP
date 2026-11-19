/** SHA-1 hex digest of a string (used as content-addressed file id) */
export async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-1', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // fallback (insecure contexts): FNV-1a based 40-hex id
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (const b of data) {
    h1 = Math.imul(h1 ^ b, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ b, 2246822519) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).padEnd(40, '0');
}
