// Flip helpers (used by actions.flip). Returns changes for updateElements.
import type { ElementChanges } from '@/store/canvasStore';
import type { SketchElement } from '@/types/appState';
import { getElementCenter, hasPoints, localBox, normalizeAngle, type P2 } from '@/engine/math';
import { getCommonBounds } from './bounds';

/**
 * Mirror elements across the vertical (horizontal flip) or horizontal (vertical flip)
 * center line of their common bounds. Apply with `updateElements(result)` then `commit()`.
 */
export function flipElements(els: SketchElement[], axis: 'horizontal' | 'vertical'): Record<string, ElementChanges> {
  const b = getCommonBounds(els);
  if (!b) return {};
  const midX = (b.minX + b.maxX) / 2;
  const midY = (b.minY + b.maxY) / 2;
  const out: Record<string, ElementChanges> = {};
  for (const el of els) {
    if (el.isDeleted) continue;
    const c = getElementCenter(el);
    const nc = axis === 'horizontal' ? { x: 2 * midX - c.x, y: c.y } : { x: c.x, y: 2 * midY - c.y };
    const angle = normalizeAngle(-el.angle);
    if (hasPoints(el)) {
      const points = el.points.map(([x, y]) => (axis === 'horizontal' ? [-x, y] : [x, -y]) as P2);
      const box = localBox({ ...el, points } as SketchElement);
      out[el.id] = { points, angle, x: nc.x - (box.ox + box.w / 2), y: nc.y - (box.oy + box.h / 2) };
      continue;
    }
    const ch: ElementChanges = { angle, x: nc.x - el.width / 2, y: nc.y - el.height / 2 };
    if (el.type === 'image') {
      const [sx, sy] = el.scale ?? [1, 1];
      ch.scale = axis === 'horizontal' ? [-sx, sy] : [sx, -sy];
    }
    out[el.id] = ch;
  }
  return out;
}
