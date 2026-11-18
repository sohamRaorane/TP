// Embeds the hand-drawn font into exported SVGs so they render correctly offline
// (e.g. when opened in Inkscape or another browser without network access).
import kalamWoff2Url from '@fontsource/kalam/files/kalam-latin-400-normal.woff2?url';

let cached: Promise<string | null> | null = null;

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export function loadHandFontDataUrl(): Promise<string | null> {
  cached ??= fetch(kalamWoff2Url)
    .then((res) => (res.ok ? res.blob() : null))
    .then((blob) => (blob ? toDataUrl(blob) : null))
    .catch(() => null);
  return cached;
}

/** replace any remote font @import in the SVG's <style> with an embedded @font-face */
export async function embedFonts(svg: SVGSVGElement): Promise<SVGSVGElement> {
  const usesHand = svg.querySelector('text[font-family*="Kalam"], text[style*="Kalam"]') !== null;
  if (!usesHand) return svg;
  const dataUrl = await loadHandFontDataUrl();
  if (!dataUrl) return svg; // keep the remote @import fallback
  const face = `@font-face{font-family:'Kalam';font-style:normal;font-weight:400;src:url(${dataUrl}) format('woff2');}`;
  const styles = svg.querySelectorAll('style');
  if (styles.length) {
    styles.forEach((st) => {
      st.textContent = (st.textContent ?? '').replace(/@import url\([^)]*fonts\.googleapis[^)]*\);?/g, '');
    });
    styles[0].textContent = face + (styles[0].textContent ?? '');
  } else {
    const st = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    st.textContent = face;
    svg.insertBefore(st, svg.firstChild);
  }
  return svg;
}
