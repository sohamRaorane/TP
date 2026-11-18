// Text tool: click to create text (or edit text / a shape label under the pointer).
import type { CanvasPointerEvent, Tool, ToolContext } from '@/tools/types';
import { hitTestScene } from '@/engine/hitTesting';
import { canHaveLabel } from '@/engine/drawing/boundText';
import { store, visibleElements } from '@/tools/shared';
import { createTextAt, editContainerLabel } from '@/tools/shared/text';

export class TextTool implements Tool {
  type = 'text' as const;
  cursor = 'text';

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext) {
    if (e.button !== 0) return;
    const a = store().appState;
    if (a.editingTextId) return; // the editor's blur commits first
    const hit = hitTestScene(e.scene.x, e.scene.y, visibleElements(), 6 / a.zoom, { skipLocked: true, mapLabelsToContainer: false, zoom: a.zoom });
    if (hit?.type === 'text') {
      store().setSelection([hit.containerId ?? hit.id]);
      ctx.startTextEditing(hit.id);
      return;
    }
    if (hit && canHaveLabel(hit) && hit.backgroundColor !== 'transparent') {
      editContainerLabel(hit, ctx);
      return;
    }
    createTextAt(e.scene.x, e.scene.y, ctx);
  }

  onPointerMove(_e: CanvasPointerEvent, ctx: ToolContext) {
    ctx.setCursor(this.cursor);
  }

  onPointerUp() {}
}
