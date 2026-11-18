// Render loop: repaints the static and interactive canvases on demand
// (store/collab/transient changes) via requestAnimationFrame.
import { useCanvasStore, type CanvasStore } from '@/store/canvasStore';
import { useCollaborationStore, type CollaborationState } from '@/store/collaborationStore';
import type { AppState } from '@/types/appState';
import { transient } from '@/engine/state/transient';
import { renderStaticScene } from './renderScene';
import { renderInteractive } from './interactive';
import { onImageLoaded } from './imageCache';

const STATIC_KEYS: (keyof AppState)[] = [
  'scrollX', 'scrollY', 'zoom', 'width', 'height', 'viewBackgroundColor', 'gridEnabled', 'pendingEraseIds', 'editingTextId', 'theme',
];

export class Renderer {
  private staticDirty = true;
  private interactiveDirty = true;
  private raf = 0;
  private unsubs: Array<() => void> = [];
  private laserReceivedAt: Record<string, number> = {};
  private dpr = 1;
  private destroyed = false;
  private visibleCache: { elements: CanvasStore['elements'] | null; visible: CanvasStore['elements'] } = { elements: null, visible: [] };

  constructor(
    private staticCanvas: HTMLCanvasElement,
    private interactiveCanvas: HTMLCanvasElement,
  ) {
    this.unsubs.push(
      useCanvasStore.subscribe((s, prev) => this.onScene(s, prev)),
      useCollaborationStore.subscribe((s, prev) => this.onCollab(s, prev)),
      transient.subscribe(() => this.invalidate(false)),
      onImageLoaded(() => this.invalidate(true)),
    );
    this.invalidate(true);
  }

  private onScene(s: CanvasStore, prev: CanvasStore) {
    if (s.sceneNonce !== prev.sceneNonce || s.elements !== prev.elements || s.files !== prev.files) {
      this.invalidate(true);
      return;
    }
    if (s.appState !== prev.appState) {
      const staticChange = STATIC_KEYS.some((k) => s.appState[k] !== prev.appState[k]);
      this.invalidate(staticChange);
    }
  }

  private onCollab(s: CollaborationState, prev: CollaborationState) {
    if (s.lasers !== prev.lasers) {
      for (const [sid, pts] of Object.entries(s.lasers)) if (pts !== prev.lasers[sid]) this.laserReceivedAt[sid] = Date.now();
    }
    this.invalidate(false);
  }

  /** schedule a repaint; `all` also repaints the static layer */
  invalidate(all = true) {
    if (all) this.staticDirty = true;
    this.interactiveDirty = true;
    if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame(this.frame);
  }

  private visibleElements(elements: CanvasStore['elements']) {
    if (this.visibleCache.elements !== elements) {
      this.visibleCache = { elements, visible: elements.filter((e) => !e.isDeleted) };
    }
    return this.visibleCache.visible;
  }

  private syncSize(canvas: HTMLCanvasElement, w: number, h: number) {
    const pw = Math.max(1, Math.round(w * this.dpr));
    const ph = Math.max(1, Math.round(h * this.dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      return true;
    }
    return false;
  }

  private frame = () => {
    this.raf = 0;
    if (this.destroyed) return;
    const s = useCanvasStore.getState();
    const a = s.appState;
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.staticDirty = true;
    }
    if (this.syncSize(this.staticCanvas, a.width, a.height)) this.staticDirty = true;
    this.syncSize(this.interactiveCanvas, a.width, a.height);
    const visible = this.visibleElements(s.elements);
    if (this.staticDirty) {
      this.staticDirty = false;
      const ctx = this.staticCanvas.getContext('2d');
      if (ctx)
        renderStaticScene(ctx, {
          elements: visible,
          files: s.files,
          scrollX: a.scrollX,
          scrollY: a.scrollY,
          zoom: a.zoom,
          width: a.width,
          height: a.height,
          dpr,
          background: a.viewBackgroundColor,
          gridEnabled: a.gridEnabled,
          pendingEraseIds: a.pendingEraseIds,
          hiddenIds: a.editingTextId ? { [a.editingTextId]: true } : undefined,
        });
    }
    if (this.interactiveDirty) {
      this.interactiveDirty = false;
      const ctx = this.interactiveCanvas.getContext('2d');
      const c = useCollaborationStore.getState();
      if (ctx) {
        const animating = renderInteractive(ctx, {
          elements: visible,
          byId: s.elementsById,
          appState: a,
          transient: transient.get(),
          dpr,
          now: Date.now(),
          collaborators: c.collaborators,
          pointers: c.pointers,
          lasers: c.lasers,
          localLaser: c.localLaser,
          laserReceivedAt: this.laserReceivedAt,
        });
        if (animating) this.invalidate(false);
      }
    }
  };

  destroy() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.unsubs.forEach((u) => u());
  }
}
