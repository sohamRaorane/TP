// Text measurement. Uses a 2D canvas when available, otherwise an estimate
// (jsdom/tests or SSR) so callers always get a usable size.
import type { FontFamily } from '@/types/appState';

export const FONT_FAMILIES: Record<FontFamily, string> = {
  1: "Kalam, 'Comic Sans MS', cursive",
  2: "Helvetica, 'Segoe UI', Arial, sans-serif",
  3: "'Cascadia Code', Menlo, Consolas, monospace",
};

export const fontString = (fontSize: number, fontFamily: FontFamily) => `${fontSize}px ${FONT_FAMILIES[fontFamily] ?? FONT_FAMILIES[1]}`;

/** average glyph width as a fraction of fontSize (fallback estimates) */
const AVG_CHAR: Record<FontFamily, number> = { 1: 0.52, 2: 0.55, 3: 0.6 };

let ctx: CanvasRenderingContext2D | null | undefined;
const getCtx = (): CanvasRenderingContext2D | null => {
  if (ctx !== undefined) return ctx;
  ctx = null;
  try {
    const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
    if (!isJsdom && typeof document !== 'undefined') {
      ctx = document.createElement('canvas').getContext('2d');
    }
  } catch {
    ctx = null;
  }
  return ctx;
};

export const splitLines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n');

export const measureLine = (line: string, fontSize: number, fontFamily: FontFamily) => {
  const c = getCtx();
  if (c) {
    c.font = fontString(fontSize, fontFamily);
    return c.measureText(line).width;
  }
  return line.length * fontSize * (AVG_CHAR[fontFamily] ?? 0.55);
};

export function measureText(text: string, fontSize: number, fontFamily: FontFamily, lineHeight: number) {
  const lines = splitLines(text);
  let width = 0;
  for (const l of lines) width = Math.max(width, measureLine(l, fontSize, fontFamily));
  // small padding so italic/hand glyph overhangs are not clipped
  return { width: Math.ceil(width), height: Math.ceil(lines.length * fontSize * lineHeight) };
}

/** greedy word wrap to maxWidth (used for container-bound labels) */
export function wrapText(text: string, fontSize: number, fontFamily: FontFamily, maxWidth: number): string {
  if (maxWidth <= 0) return text;
  const out: string[] = [];
  for (const raw of splitLines(text)) {
    const words = raw.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const cand = line + w;
      if (line && measureLine(cand.trimEnd(), fontSize, fontFamily) > maxWidth) {
        out.push(line.trimEnd());
        line = w.trimStart();
        // break very long words
        while (line && measureLine(line, fontSize, fontFamily) > maxWidth && line.length > 1) {
          let i = line.length - 1;
          while (i > 1 && measureLine(line.slice(0, i), fontSize, fontFamily) > maxWidth) i--;
          out.push(line.slice(0, i));
          line = line.slice(i);
        }
      } else line = cand;
    }
    out.push(line);
  }
  return out.join('\n');
}
