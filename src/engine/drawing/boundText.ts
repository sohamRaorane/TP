// Text labels bound inside containers (rectangle/ellipse/diamond).
import { useCanvasStore, type ElementChanges } from '@/store/canvasStore';
import type { SketchElement, TextElement } from '@/types/appState';
import { getElementCenter } from '@/engine/math';
import { measureText } from './textMeasure';

export const LABEL_PADDING = 8;

export const canHaveLabel = (el: SketchElement) => el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond';

export const getBoundTextId = (el: SketchElement) => el.boundElements.find((b) => b.type === 'text')?.id ?? null;

/** factor between the container size and the largest centered text box that fits */
const fitFactor = (type: SketchElement['type']) => (type === 'ellipse' ? Math.SQRT2 : type === 'diamond' ? 2 : 1);

/**
 * Lay out a label inside its container: center it (same angle) and grow the
 * container (around its center) if the text does not fit.
 */
export function layoutBoundText(container: SketchElement, text: TextElement): Record<string, ElementChanges> {
  const m = measureText(text.text || ' ', text.fontSize, text.fontFamily, text.lineHeight);
  const out: Record<string, ElementChanges> = {};
  const k = fitFactor(container.type);
  const needW = (m.width + LABEL_PADDING * 2) * k;
  const needH = (m.height + LABEL_PADDING * 2) * k;
  const c = getElementCenter(container);
  if (container.width < needW || container.height < needH) {
    const w = Math.max(container.width, needW);
    const h = Math.max(container.height, needH);
    out[container.id] = { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h };
  }
  const tx = c.x - m.width / 2;
  const ty = c.y - m.height / 2;
  if (text.x !== tx || text.y !== ty || text.width !== m.width || text.height !== m.height || text.angle !== container.angle)
    out[text.id] = { x: tx, y: ty, width: m.width, height: m.height, angle: container.angle };
  return out;
}

export function computeBoundTextUpdates(containerIds: Iterable<string>, byId: Record<string, SketchElement>) {
  let out: Record<string, ElementChanges> = {};
  for (const id of containerIds) {
    const c = byId[id];
    if (!c || c.isDeleted) continue;
    const tid = getBoundTextId(c);
    const t = tid ? byId[tid] : undefined;
    if (!t || t.isDeleted || t.type !== 'text') continue;
    out = { ...out, ...layoutBoundText(c, t) };
  }
  return out;
}

/** re-layout labels of the given containers in the store (no commit) */
export function updateBoundTexts(containerIds: Iterable<string>) {
  const s = useCanvasStore.getState();
  const ch = computeBoundTextUpdates(containerIds, s.elementsById);
  if (Object.keys(ch).length) s.updateElements(ch);
}

/** size of a free text element after its text changed (keeps alignment anchor) */
export function textSizeChanges(t: TextElement, nextText: string): ElementChanges {
  const m = measureText(nextText || ' ', t.fontSize, t.fontFamily, t.lineHeight);
  let x = t.x;
  if (t.textAlign === 'center') x = t.x + (t.width - m.width) / 2;
  else if (t.textAlign === 'right') x = t.x + (t.width - m.width);
  return { text: nextText, width: m.width, height: m.height, x };
}
