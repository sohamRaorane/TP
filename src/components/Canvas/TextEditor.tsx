// Inline text editor (textarea overlay) for appState.editingTextId.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import type { TextElement } from '@/types/appState';
import { FONT_FAMILIES } from '@/engine/drawing/textMeasure';
import { layoutBoundText, textSizeChanges } from '@/engine/drawing/boundText';
import { DARK_FILTER } from '@/engine/rendering';
import { assignToFrames } from '@/tools/shared';

const store = () => useCanvasStore.getState();

/** apply new text to the element (and re-layout its container) without committing */
const applyText = (id: string, value: string) => {
  const s = store();
  const el = s.elementsById[id];
  if (!el || el.type !== 'text') return;
  if (el.containerId) {
    s.updateElements({ [id]: { text: value } });
    const s2 = store();
    const c = s2.elementsById[el.containerId];
    const t = s2.elementsById[id] as TextElement;
    if (c && !c.isDeleted) {
      const lay = layoutBoundText(c, t);
      if (Object.keys(lay).length) s2.updateElements(lay);
    }
  } else s.updateElements({ [id]: textSizeChanges(el, value) });
};

export function finishTextEditing(id: string) {
  const s = store();
  if (s.appState.editingTextId !== id) return;
  const el = s.elementsById[id];
  s.setAppState({ editingTextId: null });
  if (el && el.type === 'text') {
    if (!el.text.trim()) {
      s.deleteElements([id]);
      if (el.containerId) s.setSelection([el.containerId]);
    } else {
      s.setSelection([el.containerId ?? el.id]);
      if (!el.containerId) assignToFrames([id]);
    }
  }
  s.commit();
  const a = store().appState;
  if (a.activeTool === 'text' && !a.toolLocked) s.setAppState({ activeTool: 'selection' });
}

export function TextEditor() {
  const editingId = useCanvasStore((s) => s.appState.editingTextId);
  const el = useCanvasStore((s) => (s.appState.editingTextId ? s.elementsById[s.appState.editingTextId] : undefined));
  const zoom = useCanvasStore((s) => s.appState.zoom);
  const scrollX = useCanvasStore((s) => s.appState.scrollX);
  const scrollY = useCanvasStore((s) => s.appState.scrollY);
  const theme = useCanvasStore((s) => s.appState.theme);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  // initial value + focus when a new element starts editing
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta || !editingId) return;
    done.current = false;
    const t = store().elementsById[editingId];
    ta.value = t && t.type === 'text' ? t.text : '';
    // focus after the pointer event that started editing has finished
    const raf = requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      if (ta.value) ta.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [editingId]);

  // element deleted remotely / by undo: close editor
  useEffect(() => {
    if (editingId && (!el || el.isDeleted)) store().setAppState({ editingTextId: null });
  }, [editingId, el]);

  if (!editingId || !el || el.type !== 'text' || el.isDeleted) return null;

  const finish = () => {
    if (done.current) return;
    done.current = true;
    finishTextEditing(el.id);
  };

  const left = (el.x + scrollX) * zoom;
  const top = (el.y + scrollY) * zoom;
  const fontPx = el.fontSize * zoom;
  const width = Math.max(el.width, el.fontSize * 0.6) * zoom + fontPx * 0.6;
  // extra room so the textarea never scrolls its content (which would offset it from the canvas)
  const height = Math.max(el.height, el.fontSize * el.lineHeight) * zoom + fontPx;
  const centered = el.textAlign === 'center' ? -fontPx * 0.3 : el.textAlign === 'right' ? -fontPx * 0.6 : 0;

  return (
    <textarea
      ref={ref}
      data-sketch-editor="true"
      data-testid="text-editor"
      spellCheck={false}
      wrap="off"
      autoCapitalize="off"
      autoComplete="off"
      onPointerDown={(e) => e.stopPropagation()}
      onInput={(e) => applyText(el.id, (e.target as HTMLTextAreaElement).value)}
      onScroll={(e) => {
        const ta = e.target as HTMLTextAreaElement;
        ta.scrollTop = 0;
        ta.scrollLeft = 0;
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          const ta = e.target as HTMLTextAreaElement;
          const s = ta.selectionStart;
          ta.setRangeText('    ', s, ta.selectionEnd, 'end');
          applyText(el.id, ta.value);
        }
      }}
      style={{
        position: 'absolute',
        left: left + centered,
        top,
        width,
        height,
        margin: 0,
        padding: 0,
        border: 0,
        outline: 0,
        resize: 'none',
        overflow: 'hidden',
        background: 'transparent',
        whiteSpace: 'pre',
        color: el.strokeColor,
        opacity: el.opacity / 100,
        font: `${fontPx}px ${FONT_FAMILIES[el.fontFamily] ?? FONT_FAMILIES[1]}`,
        lineHeight: el.lineHeight,
        textAlign: el.textAlign,
        transform: el.angle ? `rotate(${el.angle}rad)` : undefined,
        transformOrigin: `${(el.width * zoom) / 2 - centered}px ${(el.height * zoom) / 2}px`,
        caretColor: el.strokeColor,
        filter: theme === 'dark' ? DARK_FILTER : undefined,
        zIndex: 2,
        boxSizing: 'content-box',
      }}
    />
  );
}
