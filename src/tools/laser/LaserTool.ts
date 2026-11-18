// Laser pointer: a fading trail, shared with collaborators. Creates no elements.
import type { CanvasPointerEvent, Tool, ToolContext } from '@/tools/types';
import { useCollaborationStore } from '@/store/collaborationStore';
import { LASER_FADE_MS } from '@/engine/rendering/interactive';
import { getCollab } from '@/tools/shared';

const LASER_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Ccircle cx='8' cy='8' r='4' fill='%23ff3b30' stroke='white' stroke-width='1.5'/%3E%3C/svg%3E\") 8 8, crosshair";

export class LaserTool implements Tool {
  type = 'laser' as const;
  cursor = LASER_CURSOR;
  private active = false;
  private lastSent = 0;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;

  isBusy() {
    return this.active;
  }

  private push(x: number, y: number) {
    const now = Date.now();
    const pts = useCollaborationStore.getState().localLaser.filter((p) => now - p[2] < LASER_FADE_MS * 1.2);
    useCollaborationStore.getState().set({ localLaser: [...pts, [x, y, now]] });
    this.send();
  }

  private send() {
    const now = Date.now();
    const flush = () => {
      this.lastSent = Date.now();
      this.sendTimer = null;
      const pts = useCollaborationStore.getState().localLaser;
      void getCollab().then((m) => {
        try {
          m?.collab.sendLaser(pts);
        } catch {
          /* collaboration not available */
        }
      });
    };
    if (now - this.lastSent >= 30) flush();
    else if (!this.sendTimer) this.sendTimer = setTimeout(flush, 30 - (now - this.lastSent));
  }

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button !== 0) return;
    this.active = true;
    // a new stroke starts a new trail
    useCollaborationStore.getState().set({ localLaser: [] });
    this.push(e.scene.x, e.scene.y);
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext) {
    ctx.setCursor(this.cursor);
    if (this.active) this.push(e.scene.x, e.scene.y);
  }

  onPointerUp() {
    this.active = false;
  }

  cancel() {
    this.active = false;
  }
}
