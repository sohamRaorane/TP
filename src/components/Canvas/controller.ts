// DOM event handling for the canvas (framework-free): pointer/touch/wheel/keys,
// pan & pinch zoom, tool delegation, context menu, drag&drop, collab pointer.
import { useCanvasStore } from '@/store/canvasStore';
import type { ToolType } from '@/types/appState';
import type { CanvasPointerEvent, Tool, ToolContext } from '@/tools/types';
import { getTool } from '@/tools';
import { clampZoom, screenToScene, zoomAt } from '@/engine/coordinates';
import { hitTestScene } from '@/engine/hitTesting';
import { transient } from '@/engine/state/transient';
import { callAction, getCollab, groupAwareSelection, visibleElements } from '@/tools/shared';
import type { Renderer } from '@/engine/rendering/renderer';

const store = () => useCanvasStore.getState();
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const VIEW_MODE_TOOLS: ToolType[] = ['hand', 'laser', 'selection'];
const DRAWING_TOOLS: ToolType[] = ['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'image', 'frame', 'eraser'];

const isEditableTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};

type PanState = { pointerId: number; startX: number; startY: number; scrollX: number; scrollY: number };
type PinchState = { d0: number; mid0: { x: number; y: number }; scene: { x: number; y: number }; zoom0: number };

export class CanvasController {
  private tool: Tool;
  private toolType: ToolType;
  private spaceDown = false;
  private pan: PanState | null = null;
  private pinch: PinchState | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private toolPointerId: number | null = null;
  private lastDown = { time: 0, x: 0, y: 0, count: 0 };
  private lastPointerSent = 0;
  private pointerTimer: ReturnType<typeof setTimeout> | null = null;
  private lastScene: { x: number; y: number } = { x: 0, y: 0 };
  private buttonDown = false;
  private unsubs: Array<() => void> = [];
  readonly ctx: ToolContext;

  constructor(
    private container: HTMLElement,
    private canvas: HTMLCanvasElement,
    private renderer: Renderer,
  ) {
    this.toolType = store().appState.activeTool;
    this.tool = getTool(this.toolType);
    this.ctx = {
      requestRender: () => this.renderer.invalidate(true),
      setTool: (t) => store().setAppState({ activeTool: t }),
      setCursor: (c) => this.setCursor(c),
      startTextEditing: (id) => store().setAppState({ editingTextId: id }),
    };
    this.setCursor(this.tool.cursor);
    this.unsubs.push(
      useCanvasStore.subscribe(
        (s) => s.appState.activeTool,
        (t) => this.onToolChange(t),
      ),
    );
    const c = canvas;
    const opts = { passive: false } as AddEventListenerOptions;
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerCancel);
    c.addEventListener('dblclick', this.onDoubleClick);
    c.addEventListener('contextmenu', this.onContextMenu);
    c.addEventListener('pointerleave', this.onPointerLeave);
    container.addEventListener('wheel', this.onWheel, opts);
    container.addEventListener('dragover', this.onDragOver);
    container.addEventListener('drop', this.onDrop);
    // Safari gesture events (trackpad pinch)
    container.addEventListener('gesturestart', this.preventDefault, opts);
    container.addEventListener('gesturechange', this.preventDefault, opts);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onWindowBlur);
  }

  destroy() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerCancel);
    c.removeEventListener('dblclick', this.onDoubleClick);
    c.removeEventListener('contextmenu', this.onContextMenu);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    this.container.removeEventListener('wheel', this.onWheel);
    this.container.removeEventListener('dragover', this.onDragOver);
    this.container.removeEventListener('drop', this.onDrop);
    this.container.removeEventListener('gesturestart', this.preventDefault);
    this.container.removeEventListener('gesturechange', this.preventDefault);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onWindowBlur);
    this.unsubs.forEach((u) => u());
    if (this.pointerTimer) clearTimeout(this.pointerTimer);
  }

  private preventDefault = (e: Event) => e.preventDefault();

  private setCursor(c: string) {
    if (this.spaceDown || this.pan) return;
    if (this.canvas.style.cursor !== c) this.canvas.style.cursor = c;
  }

  private onToolChange(t: ToolType) {
    if (t === this.toolType) return;
    this.tool.cancel?.(this.ctx);
    this.toolType = t;
    this.tool = getTool(t);
    const s = store();
    const patch: Record<string, unknown> = { hoveredElementId: null, editingLinearId: null, snapLines: [], selectionBox: null };
    if (DRAWING_TOOLS.includes(t)) patch.selectedElementIds = {};
    s.setAppState(patch);
    transient.set({ suggestedBindingId: null, recognition: null, hoveredPoint: -1, hoveredMidpoint: -1, selectedPoints: [] });
    this.setCursor(this.tool.cursor);
  }

  private local(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private toCanvasEvent(e: PointerEvent | MouseEvent, clickCount = 1): CanvasPointerEvent {
    const screen = this.local(e);
    const a = store().appState;
    const scene = screenToScene(screen.x, screen.y, a);
    const pe = e as PointerEvent;
    const pointerType = (pe.pointerType === 'pen' || pe.pointerType === 'touch' ? pe.pointerType : 'mouse') as CanvasPointerEvent['pointerType'];
    return {
      scene,
      screen,
      button: e.button,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      modKey: isMac ? e.metaKey : e.ctrlKey,
      pressure: typeof pe.pressure === 'number' ? pe.pressure : 0.5,
      pointerType,
      time: performance.now(),
      clickCount,
    };
  }

  private toolAllowed() {
    const a = store().appState;
    return !a.viewModeEnabled || VIEW_MODE_TOOLS.includes(a.activeTool);
  }

  // ------------------------------------------------------------ pointer
  private onPointerDown = (e: PointerEvent) => {
    const s = store();
    if (s.appState.contextMenu) s.setAppState({ contextMenu: null });
    // commit inline text editing first (blur handles it)
    const active = document.activeElement as HTMLElement | null;
    if (active && active.tagName === 'TEXTAREA' && active.dataset.sketchEditor) active.blur();

    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, this.local(e));
      if (this.touches.size === 2) {
        // second finger: abort tool interaction and start pinch
        if (this.toolPointerId !== null) {
          this.tool.cancel?.(this.ctx);
          this.toolPointerId = null;
        }
        this.startPinch();
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (this.touches.size > 2) return;
    }

    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      e.preventDefault();
      const a = s.appState;
      this.pan = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, scrollX: a.scrollX, scrollY: a.scrollY };
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    if (!this.toolAllowed()) return;

    const now = performance.now();
    const p = this.local(e);
    const dbl = now - this.lastDown.time < 400 && Math.hypot(p.x - this.lastDown.x, p.y - this.lastDown.y) < 8;
    const count = dbl ? this.lastDown.count + 1 : 1;
    this.lastDown = { time: now, x: p.x, y: p.y, count };

    this.canvas.setPointerCapture(e.pointerId);
    this.toolPointerId = e.pointerId;
    this.buttonDown = true;
    try {
      this.tool.onPointerDown(this.toCanvasEvent(e, count), this.ctx);
    } catch (err) {
      console.error('[sketchboard] tool pointerdown failed', err);
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, this.local(e));
      if (this.pinch) {
        this.updatePinch();
        return;
      }
    }
    if (this.pan && e.pointerId === this.pan.pointerId) {
      const z = store().appState.zoom;
      store().setAppState({
        scrollX: this.pan.scrollX + (e.clientX - this.pan.startX) / z,
        scrollY: this.pan.scrollY + (e.clientY - this.pan.startY) / z,
      });
      return;
    }
    if (this.toolPointerId !== null && e.pointerId !== this.toolPointerId) return;
    const ce = this.toCanvasEvent(e);
    this.lastScene = ce.scene;
    if (this.toolAllowed()) {
      // coalesced events give smoother freedraw strokes
      const events = this.toolPointerId !== null && this.toolType === 'freedraw' && e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      try {
        if (events.length > 1) for (const ev of events) this.tool.onPointerMove(this.toCanvasEvent(ev), this.ctx);
        else this.tool.onPointerMove(ce, this.ctx);
      } catch (err) {
        console.error('[sketchboard] tool pointermove failed', err);
      }
    } else this.setCursor(this.toolType === 'hand' ? 'grab' : 'default');
    this.sendPointer();
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.pinch) {
        if (this.touches.size < 2) this.pinch = null;
        return;
      }
    }
    if (this.pan && e.pointerId === this.pan.pointerId) {
      this.pan = null;
      this.canvas.style.cursor = this.spaceDown ? 'grab' : this.tool.cursor;
      return;
    }
    if (this.toolPointerId === null || e.pointerId !== this.toolPointerId) return;
    this.toolPointerId = null;
    this.buttonDown = false;
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    try {
      this.tool.onPointerUp(this.toCanvasEvent(e), this.ctx);
    } catch (err) {
      console.error('[sketchboard] tool pointerup failed', err);
    }
    this.sendPointer(true);
  };

  private onPointerCancel = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    if (this.pan?.pointerId === e.pointerId) this.pan = null;
    if (this.toolPointerId === e.pointerId) {
      this.toolPointerId = null;
      this.buttonDown = false;
      this.tool.onPointerUp(this.toCanvasEvent(e), this.ctx);
    }
  };

  private onPointerLeave = () => {
    if (this.toolPointerId === null && store().appState.hoveredElementId) store().setAppState({ hoveredElementId: null });
  };

  private onDoubleClick = (e: MouseEvent) => {
    if (!this.toolAllowed() || this.spaceDown) return;
    try {
      this.tool.onDoubleClick?.(this.toCanvasEvent(e, 2), this.ctx);
    } catch (err) {
      console.error('[sketchboard] double click failed', err);
    }
  };

  // ------------------------------------------------------------ pinch
  private startPinch() {
    const [a, b] = [...this.touches.values()];
    const v = store().appState;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid0: mid, scene: screenToScene(mid.x, mid.y, v), zoom0: v.zoom };
  }

  private updatePinch() {
    const p = this.pinch;
    if (!p || this.touches.size < 2) return;
    const [a, b] = [...this.touches.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const next = clampZoom((p.zoom0 * d) / p.d0);
    store().setAppState({ zoom: next, scrollX: mid.x / next - p.scene.x, scrollY: mid.y / next - p.scene.y });
  }

  // ------------------------------------------------------------ wheel
  private onWheel = (e: WheelEvent) => {
    if (isEditableTarget(e.target) && (e.target as HTMLElement).dataset.sketchEditor === undefined) return;
    e.preventDefault();
    const a = store().appState;
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
    else if (e.deltaMode === 2) { dx *= a.height; dy *= a.height; }
    if (e.ctrlKey || e.metaKey) {
      const p = this.local(e);
      const clamped = Math.max(-50, Math.min(50, dy));
      const factor = Math.exp(-clamped * 0.01);
      const v = zoomAt(a, a.zoom * factor, p.x, p.y);
      store().setAppState(v);
      return;
    }
    if (e.shiftKey && !dx) {
      dx = dy;
      dy = 0;
    }
    store().setAppState({ scrollX: a.scrollX - dx / a.zoom, scrollY: a.scrollY - dy / a.zoom });
  };

  // ------------------------------------------------------------ keys
  private onKeyDown = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    if (e.code === 'Space' || e.key === ' ') {
      if (!this.spaceDown) {
        this.spaceDown = true;
        if (!this.buttonDown) this.canvas.style.cursor = 'grab';
      }
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      const a = store().appState;
      if (this.tool.isBusy?.() || a.editingLinearId || a.selectionBox) {
        this.tool.cancel?.(this.ctx);
        if (a.editingLinearId) store().setAppState({ editingLinearId: null });
        e.stopPropagation();
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Enter') {
      const a = store().appState;
      const t = this.tool as Tool & { finish?: (ctx: ToolContext) => void };
      if (t.finish && t.isBusy?.()) {
        t.finish(this.ctx);
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (a.activeTool === 'selection' && !a.viewModeEnabled) {
        // Enter on a single selected linear element edits its points; on text/containers edits text
        const sel = Object.keys(a.selectedElementIds);
        if (sel.length === 1) {
          const el = store().elementsById[sel[0]];
          if (el && (el.type === 'line' || el.type === 'arrow')) {
            store().setAppState({ editingLinearId: el.id });
            e.preventDefault();
            e.stopPropagation();
          } else if (el && el.type === 'text') {
            this.ctx.startTextEditing(el.id);
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.key === ' ') {
      this.spaceDown = false;
      if (!this.pan) this.canvas.style.cursor = this.tool.cursor;
    }
  };

  private onWindowBlur = () => {
    this.spaceDown = false;
  };

  // ------------------------------------------------------------ context menu
  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const s = store();
    const a = s.appState;
    const p = this.local(e);
    const scene = screenToScene(p.x, p.y, a);
    const els = visibleElements();
    const hit = hitTestScene(scene.x, scene.y, els, 8 / a.zoom, { selectedIds: a.selectedElementIds, zoom: a.zoom });
    if (hit && !a.selectedElementIds[hit.id]) s.setSelection(groupAwareSelection(hit, a, els));
    if (!hit && Object.keys(a.selectedElementIds).length) s.setSelection([]);
    s.setAppState({ contextMenu: { x: e.clientX, y: e.clientY, kind: hit ? 'element' : 'canvas' } });
  };

  // ------------------------------------------------------------ drag & drop
  private onDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  private onDrop = (e: DragEvent) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    const a = store().appState;
    const p = this.local(e);
    const at = screenToScene(p.x, p.y, a);
    if (a.viewModeEnabled) return;
    files.forEach((file, i) => {
      if (file.type.startsWith('image/')) void callAction('insertImage', file, { x: at.x + i * 20, y: at.y + i * 20 });
      else if (/\.(sketchboard|json|excalidraw)$/i.test(file.name) || file.type === 'application/json') void callAction('importFile', file);
    });
  };

  // ------------------------------------------------------------ collaboration
  private sendPointer(force = false) {
    const now = Date.now();
    const doSend = () => {
      this.pointerTimer = null;
      this.lastPointerSent = Date.now();
      const a = store().appState;
      const payload = {
        x: this.lastScene.x,
        y: this.lastScene.y,
        tool: a.activeTool,
        button: this.buttonDown ? 'down' : 'up',
        selectedElementIds: Object.keys(a.selectedElementIds),
        viewport: { scrollX: a.scrollX, scrollY: a.scrollY, zoom: a.zoom, width: a.width, height: a.height },
      };
      void getCollab().then((m) => {
        try {
          m?.collab.sendPointer(payload);
        } catch {
          /* collaboration not connected */
        }
      });
    };
    if (force || now - this.lastPointerSent >= 30) doSend();
    else if (!this.pointerTimer) this.pointerTimer = setTimeout(doSend, 30 - (now - this.lastPointerSent));
  }
}
