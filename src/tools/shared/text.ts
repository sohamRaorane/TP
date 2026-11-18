// Text creation helpers shared by the text and selection tools.
import type { SketchElement } from '@/types/appState';
import type { ToolContext } from '@/tools/types';
import { newText } from '@/engine/drawing/newElement';
import { getBoundTextId, layoutBoundText } from '@/engine/drawing/boundText';
import { getElementCenter } from '@/engine/math';
import { store } from './index';

/** create an empty free text element whose first line is centered on (x, y) and edit it */
export function createTextAt(x: number, y: number, ctx: ToolContext) {
  const s = store();
  const style = s.appState.currentItem;
  const lh = style.fontSize * 1.25;
  const t = newText({ x, y: y - lh / 2, style });
  t.height = lh;
  s.addElements([t], { select: true });
  ctx.startTextEditing(t.id);
  return t.id;
}

/** edit the label of a container, creating it if needed */
export function editContainerLabel(container: SketchElement, ctx: ToolContext) {
  const s = store();
  const existing = getBoundTextId(container);
  if (existing && s.elementsById[existing] && !s.elementsById[existing].isDeleted) {
    s.setSelection([container.id]);
    ctx.startTextEditing(existing);
    return existing;
  }
  const c = getElementCenter(container);
  const style = { ...s.appState.currentItem, strokeColor: container.strokeColor === 'transparent' ? s.appState.currentItem.strokeColor : container.strokeColor };
  const t = newText({ x: c.x, y: c.y, style, containerId: container.id });
  t.frameId = container.frameId;
  t.groupIds = [...container.groupIds];
  s.addElements([t]);
  s.updateElements({ [container.id]: { boundElements: [...container.boundElements, { id: t.id, type: 'text' }] } });
  const st = store();
  const lay = layoutBoundText(st.elementsById[container.id], st.elementsById[t.id] as typeof t);
  if (Object.keys(lay).length) st.updateElements(lay);
  s.setSelection([container.id]);
  ctx.startTextEditing(t.id);
  return t.id;
}
