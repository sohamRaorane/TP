// Shortcut table as data, for the Help dialog and the command palette (B).
// `keys` lists alternative combos; "Mod" = Ctrl (Cmd on macOS). Use formatShortcut() to display.
export type ShortcutGroup = 'Tools' | 'Editor' | 'View';

export interface Shortcut {
  /** matches an `actions` key where one exists (or a tool id prefixed with "tool:") */
  id: string;
  label: string;
  keys: string[];
  group: ShortcutGroup;
}

export const SHORTCUTS: Shortcut[] = [
  // Tools
  { id: 'tool:selection', label: 'Selection', keys: ['V', '1'], group: 'Tools' },
  { id: 'tool:hand', label: 'Hand (pan)', keys: ['H'], group: 'Tools' },
  { id: 'tool:rectangle', label: 'Rectangle', keys: ['R', '2'], group: 'Tools' },
  { id: 'tool:diamond', label: 'Diamond', keys: ['D', '3'], group: 'Tools' },
  { id: 'tool:ellipse', label: 'Ellipse', keys: ['O', '4'], group: 'Tools' },
  { id: 'tool:arrow', label: 'Arrow', keys: ['A', '5'], group: 'Tools' },
  { id: 'tool:line', label: 'Line', keys: ['L', '6'], group: 'Tools' },
  { id: 'tool:freedraw', label: 'Draw', keys: ['P', '7'], group: 'Tools' },
  { id: 'tool:text', label: 'Text', keys: ['T', '8'], group: 'Tools' },
  { id: 'tool:image', label: 'Insert image', keys: ['9'], group: 'Tools' },
  { id: 'tool:eraser', label: 'Eraser', keys: ['E', '0'], group: 'Tools' },
  { id: 'tool:laser', label: 'Laser pointer', keys: ['K'], group: 'Tools' },
  { id: 'tool:frame', label: 'Frame', keys: ['F'], group: 'Tools' },
  { id: 'toggleToolLock', label: 'Keep selected tool active', keys: ['Q'], group: 'Tools' },
  // Editor
  { id: 'undo', label: 'Undo', keys: ['Mod+Z'], group: 'Editor' },
  { id: 'redo', label: 'Redo', keys: ['Mod+Shift+Z', 'Ctrl+Y'], group: 'Editor' },
  { id: 'copy', label: 'Copy', keys: ['Mod+C'], group: 'Editor' },
  { id: 'cut', label: 'Cut', keys: ['Mod+X'], group: 'Editor' },
  { id: 'paste', label: 'Paste', keys: ['Mod+V'], group: 'Editor' },
  { id: 'duplicateSelected', label: 'Duplicate', keys: ['Mod+D'], group: 'Editor' },
  { id: 'deleteSelected', label: 'Delete', keys: ['Delete', 'Backspace'], group: 'Editor' },
  { id: 'selectAll', label: 'Select all', keys: ['Mod+A'], group: 'Editor' },
  { id: 'escape', label: 'Deselect / cancel / exit group', keys: ['Escape'], group: 'Editor' },
  { id: 'moveSelection', label: 'Move selection (Shift = 10px)', keys: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], group: 'Editor' },
  { id: 'group', label: 'Group', keys: ['Mod+G'], group: 'Editor' },
  { id: 'ungroup', label: 'Ungroup', keys: ['Mod+Shift+G'], group: 'Editor' },
  { id: 'toggleLock', label: 'Lock / unlock', keys: ['Mod+Shift+L'], group: 'Editor' },
  { id: 'bringForward', label: 'Bring forward', keys: ['Mod+]'], group: 'Editor' },
  { id: 'sendBackward', label: 'Send backward', keys: ['Mod+['], group: 'Editor' },
  { id: 'bringToFront', label: 'Bring to front', keys: ['Mod+Shift+]'], group: 'Editor' },
  { id: 'sendToBack', label: 'Send to back', keys: ['Mod+Shift+['], group: 'Editor' },
  { id: 'flipHorizontal', label: 'Flip horizontal', keys: ['Shift+H'], group: 'Editor' },
  { id: 'flipVertical', label: 'Flip vertical', keys: ['Shift+V'], group: 'Editor' },
  { id: 'saveNow', label: 'Save', keys: ['Mod+S'], group: 'Editor' },
  { id: 'export', label: 'Export image', keys: ['Mod+Shift+E'], group: 'Editor' },
  { id: 'dashboard', label: 'Open drawings', keys: ['Mod+O'], group: 'Editor' },
  { id: 'commandPalette', label: 'Command palette', keys: ['Mod+K', 'Mod+/'], group: 'Editor' },
  // View
  { id: 'zoomIn', label: 'Zoom in', keys: ['Mod+='], group: 'View' },
  { id: 'zoomOut', label: 'Zoom out', keys: ['Mod+-'], group: 'View' },
  { id: 'resetZoom', label: 'Reset zoom', keys: ['Mod+0'], group: 'View' },
  { id: 'zoomToFit', label: 'Zoom to fit all', keys: ['Shift+1'], group: 'View' },
  { id: 'zoomToSelection', label: 'Zoom to selection', keys: ['Shift+2'], group: 'View' },
  { id: 'toggleGrid', label: 'Toggle grid', keys: ["Mod+'"], group: 'View' },
  { id: 'toggleSnap', label: 'Toggle snapping', keys: ['Alt+S'], group: 'View' },
  { id: 'toggleZen', label: 'Zen mode', keys: ['Alt+Z'], group: 'View' },
  { id: 'toggleViewMode', label: 'View mode', keys: ['Alt+R'], group: 'View' },
  { id: 'toggleTheme', label: 'Toggle dark mode', keys: ['Alt+Shift+D'], group: 'View' },
  { id: 'help', label: 'Keyboard shortcuts', keys: ['?'], group: 'View' },
  { id: 'stats', label: 'Stats for nerds', keys: ['Alt+/'], group: 'View' },
  { id: 'presentation', label: 'Presentation: next / previous / exit', keys: ['ArrowRight', 'ArrowLeft', 'Escape'], group: 'View' },
  { id: 'pan', label: 'Pan (hold)', keys: ['Space'], group: 'View' },
];

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** "Mod+Shift+Z" -> "⌘⇧Z" on macOS, "Ctrl+Shift+Z" elsewhere */
export function formatShortcut(combo: string, mac = isMac()): string {
  const parts = combo.split('+').filter(Boolean);
  if (combo.endsWith('++')) parts.push('+');
  const map: Record<string, string> = mac
    ? { Mod: '⌘', Ctrl: '⌃', Shift: '⇧', Alt: '⌥', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Delete: '⌦', Backspace: '⌫', Escape: 'Esc' }
    : { Mod: 'Ctrl', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc' };
  return parts.map((p) => map[p] ?? p).join(mac ? '' : '+');
}

/** first combo of a shortcut id, formatted (for menus / tooltips) */
export const shortcutLabel = (id: string) => {
  const s = SHORTCUTS.find((x) => x.id === id);
  return s ? formatShortcut(s.keys[0]) : '';
};
