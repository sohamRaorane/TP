// Single registry of tools, toggles and actions shown by the toolbar, help
// dialog, command palette and menus. Handlers only call `actions.*` or patch
// UI-only app state; shortcuts are displayed here but bound by C's hook.
import {
  ArrowRight, Circle, Diamond, Eraser, Frame, Hand, Image, Laser, Minus, MousePointer2, Pencil,
  Square, Type, type LucideIcon,
} from 'lucide-react';
import { actions } from '@/services/actions';
import { useCanvasStore } from '@/store/canvasStore';
import type { DialogType, ToolType } from '@/types/appState';
import { getApp, run, setUi } from './run';

/** DialogType plus UI dialogs not yet in the contract (see CONTRACT REQUESTS). */
export type UiDialog = DialogType | 'textToDiagram';
export const openDialog = (d: UiDialog) => setUi({ openDialog: d as DialogType, contextMenu: null });
export const closeDialog = () => setUi({ openDialog: null });

export interface ToolDef {
  type: ToolType;
  label: string;
  icon: LucideIcon;
  /** letter shortcut */
  key?: string;
  /** number shortcut */
  num?: string;
}

export const MAIN_TOOLS: ToolDef[] = [
  { type: 'hand', label: 'Hand (panning tool)', icon: Hand, key: 'H' },
  { type: 'selection', label: 'Selection', icon: MousePointer2, key: 'V', num: '1' },
  { type: 'rectangle', label: 'Rectangle', icon: Square, key: 'R', num: '2' },
  { type: 'diamond', label: 'Diamond', icon: Diamond, key: 'D', num: '3' },
  { type: 'ellipse', label: 'Ellipse', icon: Circle, key: 'O', num: '4' },
  { type: 'arrow', label: 'Arrow', icon: ArrowRight, key: 'A', num: '5' },
  { type: 'line', label: 'Line', icon: Minus, key: 'L', num: '6' },
  { type: 'freedraw', label: 'Draw', icon: Pencil, key: 'P', num: '7' },
  { type: 'text', label: 'Text', icon: Type, key: 'T', num: '8' },
  { type: 'image', label: 'Insert image', icon: Image, num: '9' },
  { type: 'eraser', label: 'Eraser', icon: Eraser, key: 'E', num: '0' },
];
export const EXTRA_TOOLS: ToolDef[] = [
  { type: 'laser', label: 'Laser pointer', icon: Laser, key: 'K' },
  { type: 'frame', label: 'Frame tool', icon: Frame, key: 'F' },
];
export const ALL_TOOLS = [...MAIN_TOOLS, ...EXTRA_TOOLS];

export const toolShortcut = (t: ToolDef) => [t.key, t.num].filter(Boolean).join(' or ');

export const setTool = (type: ToolType) => setUi({ activeTool: type });

// ---------------------------------------------------------------- toggles
export const toggles = {
  grid: () => setUi({ gridEnabled: !getApp().gridEnabled }),
  snap: () => setUi({ snapEnabled: !getApp().snapEnabled }),
  zen: () => setUi({ zenMode: !getApp().zenMode }),
  viewMode: () => setUi({ viewModeEnabled: !getApp().viewModeEnabled }),
  theme: () => setUi({ theme: getApp().theme === 'dark' ? 'light' : 'dark' }),
  minimap: () => setUi({ showMinimap: !getApp().showMinimap }),
  stats: () => setUi({ openDialog: getApp().openDialog === 'stats' ? null : 'stats' }),
  toolLock: () => setUi({ toolLocked: !getApp().toolLocked }),
};

const hasSelection = () => Object.keys(useCanvasStore.getState().appState.selectedElementIds).length > 0;

export interface Command {
  id: string;
  label: string;
  category: 'Tools' | 'Editor' | 'View' | 'File' | 'Collaboration' | 'Help';
  shortcut?: string;
  keywords?: string;
  run: () => void;
  enabled?: () => boolean;
}

const a = (fn: () => unknown) => () => run(fn);

export function buildCommands(): Command[] {
  const tools: Command[] = ALL_TOOLS.map((t) => ({
    id: `tool.${t.type}`,
    label: t.label,
    category: 'Tools',
    shortcut: toolShortcut(t),
    keywords: `tool ${t.type}`,
    run: () => setTool(t.type),
  }));
  return [
    ...tools,
    { id: 'tool.lock', label: 'Keep selected tool active after drawing', category: 'Tools', shortcut: 'Q', keywords: 'lock', run: toggles.toolLock },
    // Editor
    { id: 'undo', label: 'Undo', category: 'Editor', shortcut: 'Ctrl+Z', run: a(() => actions.undo()) },
    { id: 'redo', label: 'Redo', category: 'Editor', shortcut: 'Ctrl+Shift+Z', run: a(() => actions.redo()) },
    { id: 'selectAll', label: 'Select all', category: 'Editor', shortcut: 'Ctrl+A', run: a(() => actions.selectAll()) },
    { id: 'cut', label: 'Cut', category: 'Editor', shortcut: 'Ctrl+X', enabled: hasSelection, run: a(() => actions.cut()) },
    { id: 'copy', label: 'Copy', category: 'Editor', shortcut: 'Ctrl+C', enabled: hasSelection, run: a(() => actions.copy()) },
    { id: 'paste', label: 'Paste', category: 'Editor', shortcut: 'Ctrl+V', run: a(() => actions.paste()) },
    { id: 'copyPng', label: 'Copy to clipboard as PNG', category: 'Editor', shortcut: 'Shift+Alt+C', run: a(() => actions.copyAsPNG()) },
    { id: 'duplicate', label: 'Duplicate', category: 'Editor', shortcut: 'Ctrl+D', enabled: hasSelection, run: a(() => actions.duplicateSelected()) },
    { id: 'delete', label: 'Delete', category: 'Editor', shortcut: 'Delete', enabled: hasSelection, run: a(() => actions.deleteSelected()) },
    { id: 'group', label: 'Group selection', category: 'Editor', shortcut: 'Ctrl+G', enabled: hasSelection, run: a(() => actions.group()) },
    { id: 'ungroup', label: 'Ungroup selection', category: 'Editor', shortcut: 'Ctrl+Shift+G', enabled: hasSelection, run: a(() => actions.ungroup()) },
    { id: 'bringForward', label: 'Bring forward', category: 'Editor', shortcut: 'Ctrl+]', enabled: hasSelection, run: a(() => actions.bringForward()) },
    { id: 'sendBackward', label: 'Send backward', category: 'Editor', shortcut: 'Ctrl+[', enabled: hasSelection, run: a(() => actions.sendBackward()) },
    { id: 'bringToFront', label: 'Bring to front', category: 'Editor', shortcut: 'Ctrl+Shift+]', enabled: hasSelection, run: a(() => actions.bringToFront()) },
    { id: 'sendToBack', label: 'Send to back', category: 'Editor', shortcut: 'Ctrl+Shift+[', enabled: hasSelection, run: a(() => actions.sendToBack()) },
    { id: 'flipH', label: 'Flip horizontal', category: 'Editor', shortcut: 'Shift+H', enabled: hasSelection, run: a(() => actions.flip('horizontal')) },
    { id: 'flipV', label: 'Flip vertical', category: 'Editor', shortcut: 'Shift+V', enabled: hasSelection, run: a(() => actions.flip('vertical')) },
    { id: 'lock', label: 'Lock / unlock selection', category: 'Editor', shortcut: 'Ctrl+Shift+L', enabled: hasSelection, run: a(() => actions.toggleLock()) },
    { id: 'alignLeft', label: 'Align left', category: 'Editor', shortcut: 'Ctrl+Shift+←', enabled: hasSelection, run: a(() => actions.align('left')) },
    { id: 'alignRight', label: 'Align right', category: 'Editor', shortcut: 'Ctrl+Shift+→', enabled: hasSelection, run: a(() => actions.align('right')) },
    { id: 'alignTop', label: 'Align top', category: 'Editor', shortcut: 'Ctrl+Shift+↑', enabled: hasSelection, run: a(() => actions.align('top')) },
    { id: 'alignBottom', label: 'Align bottom', category: 'Editor', shortcut: 'Ctrl+Shift+↓', enabled: hasSelection, run: a(() => actions.align('bottom')) },
    { id: 'alignCenterX', label: 'Center horizontally', category: 'Editor', enabled: hasSelection, run: a(() => actions.align('centerX')) },
    { id: 'alignCenterY', label: 'Center vertically', category: 'Editor', enabled: hasSelection, run: a(() => actions.align('centerY')) },
    { id: 'distH', label: 'Distribute horizontally', category: 'Editor', shortcut: 'Alt+H', enabled: hasSelection, run: a(() => actions.distribute('horizontal')) },
    { id: 'distV', label: 'Distribute vertically', category: 'Editor', shortcut: 'Alt+V', enabled: hasSelection, run: a(() => actions.distribute('vertical')) },
    { id: 'addToLibrary', label: 'Add selection to library', category: 'Editor', enabled: hasSelection, run: a(() => actions.addSelectionToLibrary()) },
    { id: 'textToDiagram', label: 'Text to diagram…', category: 'Editor', keywords: 'mermaid flowchart', run: () => openDialog('textToDiagram') },
    // View
    { id: 'zoomIn', label: 'Zoom in', category: 'View', shortcut: 'Ctrl++', run: a(() => actions.zoomIn()) },
    { id: 'zoomOut', label: 'Zoom out', category: 'View', shortcut: 'Ctrl+-', run: a(() => actions.zoomOut()) },
    { id: 'resetZoom', label: 'Reset zoom', category: 'View', shortcut: 'Ctrl+0', run: a(() => actions.resetZoom()) },
    { id: 'zoomToFit', label: 'Zoom to fit all elements', category: 'View', shortcut: 'Shift+1', run: a(() => actions.zoomToFit()) },
    { id: 'zoomToSelection', label: 'Zoom to selection', category: 'View', shortcut: 'Shift+2', enabled: hasSelection, run: a(() => actions.zoomToSelection()) },
    { id: 'grid', label: 'Toggle grid', category: 'View', shortcut: "Ctrl+'", run: toggles.grid },
    { id: 'snap', label: 'Toggle snapping', category: 'View', shortcut: 'Alt+S', run: toggles.snap },
    { id: 'zen', label: 'Zen mode', category: 'View', shortcut: 'Alt+Z', run: toggles.zen },
    { id: 'viewMode', label: 'View mode', category: 'View', shortcut: 'Alt+R', run: toggles.viewMode },
    { id: 'theme', label: 'Toggle dark theme', category: 'View', shortcut: 'Alt+Shift+D', keywords: 'dark light', run: toggles.theme },
    { id: 'minimap', label: 'Toggle minimap', category: 'View', shortcut: 'Alt+M', run: toggles.minimap },
    { id: 'stats', label: 'Toggle stats', category: 'View', shortcut: 'Alt+/', keywords: 'statistics', run: toggles.stats },
    { id: 'presentation', label: 'Start presentation', category: 'View', keywords: 'slides frames present', run: a(() => actions.startPresentation()) },
    { id: 'palette', label: 'Command palette', category: 'View', shortcut: 'Ctrl+/', run: () => openDialog('commandPalette') },
    // File
    { id: 'dashboard', label: 'Open…', category: 'File', shortcut: 'Ctrl+O', keywords: 'drawings dashboard', run: () => openDialog('dashboard') },
    { id: 'new', label: 'New drawing', category: 'File', run: a(() => actions.newDrawing()) },
    { id: 'save', label: 'Save now', category: 'File', shortcut: 'Ctrl+S', run: a(() => actions.saveNow()) },
    { id: 'export', label: 'Export image…', category: 'File', shortcut: 'Ctrl+Shift+E', keywords: 'png svg', run: () => openDialog('export') },
    { id: 'exportJson', label: 'Save to file (JSON)', category: 'File', run: a(() => actions.exportJSON()) },
    { id: 'versions', label: 'Version history', category: 'File', keywords: 'history restore', run: () => openDialog('versions') },
    { id: 'library', label: 'Open library', category: 'File', run: () => openDialog('library') },
    // Collaboration
    { id: 'share', label: 'Live collaboration…', category: 'Collaboration', keywords: 'share room', run: () => openDialog('share') },
    // Help
    { id: 'help', label: 'Help & keyboard shortcuts', category: 'Help', shortcut: '?', run: () => openDialog('help') },
  ];
}
