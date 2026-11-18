// Hand tool: drag to pan.
import type { CanvasPointerEvent, Tool, ToolContext } from '@/tools/types';
import { store } from '@/tools/shared';

export class HandTool implements Tool {
  type = 'hand' as const;
  cursor = 'grab';
  private start: { x: number; y: number; scrollX: number; scrollY: number } | null = null;

  isBusy() {
    return !!this.start;
  }

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext) {
    const a = store().appState;
    this.start = { x: e.screen.x, y: e.screen.y, scrollX: a.scrollX, scrollY: a.scrollY };
    ctx.setCursor('grabbing');
  }

  onPointerMove(e: CanvasPointerEvent) {
    if (!this.start) return;
    const z = store().appState.zoom;
    store().setAppState({
      scrollX: this.start.scrollX + (e.screen.x - this.start.x) / z,
      scrollY: this.start.scrollY + (e.screen.y - this.start.y) / z,
    });
  }

  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext) {
    this.start = null;
    ctx.setCursor(this.cursor);
  }

  cancel(ctx: ToolContext) {
    this.onPointerUp({} as CanvasPointerEvent, ctx);
  }
}
