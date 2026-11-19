import type { FontFamily } from '@/types/appState';
import { isJsdom } from './dom';

export const FONT_STACKS: Record<FontFamily, string> = {
  1: 'Kalam, "Comic Sans MS", cursive',
  2: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
  3: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
};

let ctx: CanvasRenderingContext2D | null | undefined;
const getCtx = () => {
  if (ctx !== undefined) return ctx;
  ctx = null;
  try {
    if (typeof document !== 'undefined' && !isJsdom()) ctx = document.createElement('canvas').getContext('2d');
  } catch {
    ctx = null;
  }
  return ctx;
};

/** measure multi-line text in scene units; falls back to an estimate (0.45em/char) without canvas */
export function measureText(text: string, fontSize: number, fontFamily: FontFamily, lineHeight = 1.25) {
  const lines = text.split('\n');
  const c = getCtx();
  let width = 0;
  for (const line of lines) {
    let w: number;
    if (c) {
      c.font = `${fontSize}px ${FONT_STACKS[fontFamily]}`;
      w = c.measureText(line).width;
    } else {
      w = line.length * fontSize * 0.45;
    }
    width = Math.max(width, w);
  }
  return { width: Math.ceil(width), height: Math.ceil(lines.length * fontSize * lineHeight) };
}
