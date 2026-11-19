// Image tool: clicking opens a file picker; the chosen file is inserted at the
// click point via actions.insertImage (implemented by the state agent).
import type { CanvasPointerEvent, Tool, ToolContext } from '@/tools/types';
import { callAction, store } from '@/tools/shared';

export const pickImageFile = (): Promise<File | null> =>
  new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/svg+xml,image/webp';
    input.style.display = 'none';
    let done = false;
    const finish = (f: File | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(f);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });

export class ImageTool implements Tool {
  type = 'image' as const;
  cursor = 'crosshair';

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext) {
    if (e.button !== 0) return;
    const at = { ...e.scene };
    void pickImageFile().then(async (file) => {
      if (file) await callAction('insertImage', file, at);
      if (!store().appState.toolLocked) ctx.setTool('selection');
    });
  }

  onPointerMove(_e: CanvasPointerEvent, ctx: ToolContext) {
    ctx.setCursor(this.cursor);
  }

  onPointerUp() {}
}
