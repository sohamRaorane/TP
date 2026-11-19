// Main drawing surface: static + interactive canvases, inline text editor.
import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { useHistoryStore } from '@/store/historyStore';
import { useCollaborationStore } from '@/store/collaborationStore';
import { Renderer } from '@/engine/rendering/renderer';
import { DARK_FILTER } from '@/engine/rendering';
import { CanvasController } from './controller';
import { TextEditor } from './TextEditor';

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const interactiveRef = useRef<HTMLCanvasElement>(null);
  const theme = useCanvasStore((s) => s.appState.theme);

  useEffect(() => {
    const container = containerRef.current!;
    const renderer = new Renderer(staticRef.current!, interactiveRef.current!);
    const controller = new CanvasController(container, interactiveRef.current!, renderer);

    const syncSize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      const a = useCanvasStore.getState().appState;
      if (a.width !== w || a.height !== h) useCanvasStore.getState().setAppState({ width: w, height: h });
    };
    syncSize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncSize) : null;
    ro?.observe(container);
    window.addEventListener('resize', syncSize);
    // re-render once web fonts (Kalam) are ready so text measures/draws correctly
    void document.fonts?.load?.('20px Kalam').then(() => renderer.invalidate(true)).catch(() => {});
    void document.fonts?.ready.then(() => renderer.invalidate(true));
    const onFont = () => renderer.invalidate(true);
    document.fonts?.addEventListener?.('loadingdone', onFont);

    if (import.meta.env.DEV) {
      (window as unknown as { __sketch: unknown }).__sketch = { useCanvasStore, useHistoryStore, useCollaborationStore };
    }
    return () => {
      controller.destroy();
      renderer.destroy();
      ro?.disconnect();
      window.removeEventListener('resize', syncSize);
      document.fonts?.removeEventListener?.('loadingdone', onFont);
    };
  }, []);

  const filter = theme === 'dark' ? DARK_FILTER : undefined;
  return (
    <div
      ref={containerRef}
      data-testid="canvas-container"
      className="absolute inset-0 overflow-hidden"
      style={{ touchAction: 'none', userSelect: 'none' }}
    >
      <canvas ref={staticRef} data-testid="canvas-static" className="absolute inset-0" style={{ filter, pointerEvents: 'none' }} />
      <canvas ref={interactiveRef} data-testid="canvas-interactive" className="absolute inset-0" style={{ touchAction: 'none' }} />
      <TextEditor />
    </div>
  );
}
