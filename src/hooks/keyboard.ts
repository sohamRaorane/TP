// Pure-ish keydown handler (testable without React). useKeyboardShortcuts wires it to window.
import type { ToolType } from '@/types/appState';
import { useCanvasStore } from '@/store/canvasStore';
import { actions } from '@/services/actions';
import { isEditableTarget } from '@/utils/dom';

const TOOL_KEYS: Record<string, ToolType> = {
  v: 'selection', '1': 'selection',
  h: 'hand',
  r: 'rectangle', '2': 'rectangle',
  d: 'diamond', '3': 'diamond',
  o: 'ellipse', '4': 'ellipse',
  a: 'arrow', '5': 'arrow',
  l: 'line', '6': 'line',
  p: 'freedraw', '7': 'freedraw',
  t: 'text', '8': 'text',
  '9': 'image',
  e: 'eraser', '0': 'eraser',
  k: 'laser',
  f: 'frame',
};

export interface KeyContext {
  /** a pointer button is held on the page (drag/draw in progress) */
  pointerDown: boolean;
}

/** layout-independent letter/digit: prefer e.code for Latin letters/digits */
const baseKey = (e: KeyboardEvent): string => {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (/^Numpad[0-9]$/.test(e.code)) return e.code.slice(6);
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
};

/** returns true when the event was handled (and default prevented) */
export function handleKeyDown(e: KeyboardEvent, ctx: KeyContext = { pointerDown: false }): boolean {
  if (e.defaultPrevented || e.isComposing) return false;
  const st = useCanvasStore.getState();
  const a = st.appState;
  // text fields and the in-canvas text editor own their keys (Escape included)
  if (isEditableTarget(e.target) || a.editingTextId) return false;

  const mod = e.ctrlKey || e.metaKey;
  const k = baseKey(e);
  const done = () => {
    e.preventDefault();
    e.stopPropagation();
    return true;
  };

  // ---- presentation mode
  if (a.presentation.active) {
    if (e.key === 'Escape') return actions.stopPresentation(), done();
    if (['ArrowRight', 'ArrowDown', 'PageDown', 'Enter'].includes(e.key)) return actions.nextSlide(), done();
    if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) return actions.prevSlide(), done();
  }

  // ---- Escape
  if (e.key === 'Escape') {
    if (a.openDialog) return st.setAppState({ openDialog: null }), done();
    if (a.contextMenu) return st.setAppState({ contextMenu: null }), done();
    if (a.followingSocketId) return actions.followUser(null), done();
    if (a.editingLinearId) return st.setAppState({ editingLinearId: null }), done();
    if (a.activeTool !== 'selection' && !a.toolLocked) return actions.setTool('selection'), done();
    if (a.editingGroupId) {
      const g = a.editingGroupId;
      const members = st.elements.filter((el) => !el.isDeleted && el.groupIds.includes(g)).map((el) => el.id);
      st.setAppState({ editingGroupId: null });
      st.setSelection(members);
      return done();
    }
    if (Object.keys(a.selectedElementIds).length) return st.setSelection([]), done();
    return false;
  }

  // ---- modifier shortcuts
  if (mod && !e.altKey) {
    if (k === 'z') return (e.shiftKey ? actions.redo() : actions.undo()), done();
    if (k === 'y' && !e.shiftKey) return actions.redo(), done();
    if (k === 'd' && !e.shiftKey) return actions.duplicateSelected(), done();
    if (k === 'a' && !e.shiftKey) return actions.selectAll(), done();
    if (k === 'g') return (e.shiftKey ? actions.ungroup() : actions.group()), done();
    if (k === 'l' && e.shiftKey) return actions.toggleLock(), done();
    if (e.code === 'BracketRight' || k === ']' || k === '}')
      return (e.shiftKey ? actions.bringToFront() : actions.bringForward()), done();
    if (e.code === 'BracketLeft' || k === '[' || k === '{')
      return (e.shiftKey ? actions.sendToBack() : actions.sendBackward()), done();
    if (k === '=' || k === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') return actions.zoomIn(), done();
    if (k === '-' || k === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') return actions.zoomOut(), done();
    if (k === '0' && !e.shiftKey) return actions.resetZoom(), done();
    if (e.code === 'Quote' || k === "'") return actions.toggleGrid(), done();
    if (k === 'k' || e.code === 'Slash' || k === '/') return actions.toggleDialog('commandPalette'), done();
    if (k === 's' && !e.shiftKey) return void actions.saveNow(), done();
    if (k === 'e' && e.shiftKey) return actions.openDialog('export'), done();
    if (k === 'o' && !e.shiftKey) return actions.toggleDialog('dashboard'), done();
    // Mod+C / X / V go through native copy/cut/paste events (services/clipboard.ts)
    return false;
  }

  // ---- Alt shortcuts (use e.code: Alt changes e.key on macOS)
  if (e.altKey && !mod) {
    if (e.code === 'KeyS' && !e.shiftKey) return actions.toggleSnap(), done();
    if (e.code === 'KeyZ' && !e.shiftKey) return actions.toggleZen(), done();
    if (e.code === 'KeyR' && !e.shiftKey) return actions.toggleViewMode(), done();
    if (e.code === 'KeyD' && e.shiftKey) return actions.toggleTheme(), done();
    if (e.code === 'Slash') return actions.toggleDialog('stats'), done();
    return false;
  }
  if (mod || e.altKey) return false;

  // ---- plain keys
  if (e.key === '?') return actions.toggleDialog('help'), done();
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!Object.keys(a.selectedElementIds).length) return false;
    return actions.deleteSelected(), done();
  }
  if (e.key.startsWith('Arrow')) {
    if (!Object.keys(a.selectedElementIds).length) return false;
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    return actions.moveSelection(dx, dy), done();
  }
  if (e.shiftKey) {
    if (k === 'h') return actions.flip('horizontal'), done();
    if (k === 'v') return actions.flip('vertical'), done();
    if (k === '1') return actions.zoomToFit(), done();
    if (k === '2') return actions.zoomToSelection(), done();
    return false;
  }
  if (e.repeat) return false;
  if (k === 'q') return actions.toggleToolLock(), done();
  const tool = TOOL_KEYS[k];
  if (tool) {
    if (ctx.pointerDown) return false; // don't switch tools mid-drag
    return actions.setTool(tool), done();
  }
  return false;
}
