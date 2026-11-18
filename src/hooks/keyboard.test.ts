import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
vi.mock('@/engine/rendering', () => ({ exportToCanvas: vi.fn(), exportToSvg: vi.fn() }));
import { handleKeyDown } from './keyboard';
import { actions } from '@/services/actions';
import { useCanvasStore } from '@/store/canvasStore';
import { resetStores, rect, addCommitted, select } from '@/test/helpers';
import { SHORTCUTS, formatShortcut } from './shortcutMap';

const st = () => useCanvasStore.getState();
const key = (k: string, init: KeyboardEventInit & { target?: EventTarget } = {}) => {
  const code = init.code ?? (/^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : /^[0-9]$/.test(k) ? `Digit${k}` : '');
  const e = new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true, ...init });
  if (init.target) Object.defineProperty(e, 'target', { value: init.target });
  return e;
};

beforeEach(resetStores);
afterEach(() => vi.restoreAllMocks());

describe('keyboard shortcuts', () => {
  it('switches tools by letter and digit', () => {
    expect(handleKeyDown(key('r'))).toBe(true);
    expect(st().appState.activeTool).toBe('rectangle');
    handleKeyDown(key('6'));
    expect(st().appState.activeTool).toBe('line');
    handleKeyDown(key('v'));
    expect(st().appState.activeTool).toBe('selection');
  });

  it('ignores keys typed into inputs, textareas and contenteditable', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      const el = document.createElement(tag);
      expect(handleKeyDown(key('r', { target: el }))).toBe(false);
    }
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    expect(handleKeyDown(key('Delete', { target: div }))).toBe(false);
    expect(st().appState.activeTool).toBe('selection');
  });

  it('ignores everything while editing text', () => {
    st().setAppState({ editingTextId: 'x' });
    const undo = vi.spyOn(actions, 'undo');
    expect(handleKeyDown(key('z', { ctrlKey: true }))).toBe(false);
    expect(handleKeyDown(key('Escape'))).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });

  it('does not switch tools while a pointer is down', () => {
    expect(handleKeyDown(key('r'), { pointerDown: true })).toBe(false);
    expect(st().appState.activeTool).toBe('selection');
  });

  it('maps modifier combos to actions and prevents default', () => {
    const spies = {
      undo: vi.spyOn(actions, 'undo').mockImplementation(() => {}),
      redo: vi.spyOn(actions, 'redo').mockImplementation(() => {}),
      duplicateSelected: vi.spyOn(actions, 'duplicateSelected').mockImplementation(() => {}),
      group: vi.spyOn(actions, 'group').mockImplementation(() => {}),
      ungroup: vi.spyOn(actions, 'ungroup').mockImplementation(() => {}),
      bringToFront: vi.spyOn(actions, 'bringToFront').mockImplementation(() => {}),
      sendBackward: vi.spyOn(actions, 'sendBackward').mockImplementation(() => {}),
      saveNow: vi.spyOn(actions, 'saveNow').mockImplementation(async () => {}),
      flip: vi.spyOn(actions, 'flip').mockImplementation(() => {}),
      zoomToFit: vi.spyOn(actions, 'zoomToFit').mockImplementation(() => {}),
      toggleSnap: vi.spyOn(actions, 'toggleSnap').mockImplementation(() => {}),
    };
    const d = key('d', { ctrlKey: true });
    handleKeyDown(d);
    expect(d.defaultPrevented).toBe(true);
    handleKeyDown(key('z', { metaKey: true }));
    handleKeyDown(key('Z', { ctrlKey: true, shiftKey: true }));
    handleKeyDown(key('y', { ctrlKey: true }));
    handleKeyDown(key('g', { ctrlKey: true }));
    handleKeyDown(key('G', { ctrlKey: true, shiftKey: true }));
    handleKeyDown(key('}', { ctrlKey: true, shiftKey: true, code: 'BracketRight' }));
    handleKeyDown(key('[', { ctrlKey: true, code: 'BracketLeft' }));
    handleKeyDown(key('s', { ctrlKey: true }));
    handleKeyDown(key('H', { shiftKey: true }));
    handleKeyDown(key('!', { shiftKey: true, code: 'Digit1' }));
    handleKeyDown(key('ß', { altKey: true, code: 'KeyS' })); // macOS Alt+S
    expect(spies.undo).toHaveBeenCalledTimes(1);
    expect(spies.redo).toHaveBeenCalledTimes(2);
    expect(spies.duplicateSelected).toHaveBeenCalledTimes(1);
    expect(spies.group).toHaveBeenCalledTimes(1);
    expect(spies.ungroup).toHaveBeenCalledTimes(1);
    expect(spies.bringToFront).toHaveBeenCalledTimes(1);
    expect(spies.sendBackward).toHaveBeenCalledTimes(1);
    expect(spies.saveNow).toHaveBeenCalledTimes(1);
    expect(spies.flip).toHaveBeenCalledWith('horizontal');
    expect(spies.zoomToFit).toHaveBeenCalledTimes(1);
    expect(spies.toggleSnap).toHaveBeenCalledTimes(1);
    expect(st().appState.activeTool).toBe('selection'); // Shift+H did not pick the hand tool
  });

  it('leaves Ctrl+C/X/V to native clipboard events', () => {
    for (const k of ['c', 'x', 'v']) {
      const e = key(k, { ctrlKey: true });
      expect(handleKeyDown(e)).toBe(false);
      expect(e.defaultPrevented).toBe(false);
    }
  });

  it('arrows move the selection (shift = 10), delete removes it', () => {
    const [a] = addCommitted(rect(0, 0));
    select(a.id);
    handleKeyDown(key('ArrowRight'));
    handleKeyDown(key('ArrowDown', { shiftKey: true }));
    expect(st().elementsById[a.id].x).toBe(1);
    expect(st().elementsById[a.id].y).toBe(10);
    handleKeyDown(key('Delete'));
    expect(st().elementsById[a.id].isDeleted).toBe(true);
  });

  it('Escape closes dialogs first, then resets tool, exits group, clears selection', () => {
    const [a] = addCommitted(rect(0, 0, 10, 10, { groupIds: ['g'] }));
    st().setAppState({ openDialog: 'help', activeTool: 'rectangle', editingGroupId: 'g' });
    select(a.id);
    handleKeyDown(key('Escape'));
    expect(st().appState.openDialog).toBeNull();
    handleKeyDown(key('Escape'));
    expect(st().appState.activeTool).toBe('selection');
    handleKeyDown(key('Escape'));
    expect(st().appState.editingGroupId).toBeNull();
    expect(Object.keys(st().appState.selectedElementIds)).toEqual([a.id]);
    handleKeyDown(key('Escape'));
    expect(st().appState.selectedElementIds).toEqual({});
    expect(handleKeyDown(key('Escape'))).toBe(false);
  });

  it('toggles: Q tool lock, grid, zen, theme, help', () => {
    handleKeyDown(key('q'));
    expect(st().appState.toolLocked).toBe(true);
    handleKeyDown(key("'", { ctrlKey: true, code: 'Quote' }));
    expect(st().appState.gridEnabled).toBe(true);
    handleKeyDown(key('Ω', { altKey: true, code: 'KeyZ' }));
    expect(st().appState.zenMode).toBe(true);
    handleKeyDown(key('D', { altKey: true, shiftKey: true, code: 'KeyD' }));
    expect(st().appState.theme).toBe('dark');
    handleKeyDown(key('?', { shiftKey: true, code: 'Slash' }));
    expect(st().appState.openDialog).toBe('help');
    handleKeyDown(key('k', { ctrlKey: true }));
    expect(st().appState.openDialog).toBe('commandPalette');
  });

  it('presentation keys', () => {
    const next = vi.spyOn(actions, 'nextSlide').mockImplementation(() => {});
    const stop = vi.spyOn(actions, 'stopPresentation').mockImplementation(() => {});
    st().setAppState({ presentation: { active: true, frameIndex: 0 } });
    handleKeyDown(key('ArrowRight'));
    handleKeyDown(key('Escape'));
    expect(next).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it('shortcut table is well formed', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SHORTCUTS.every((s) => s.keys.length > 0)).toBe(true);
    expect(formatShortcut('Mod+Shift+Z', false)).toBe('Ctrl+Shift+Z');
    expect(formatShortcut('Mod+Shift+Z', true)).toBe('⌘⇧Z');
  });
});
