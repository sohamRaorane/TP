import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { actions } from '@/services/actions';
import { selectors, useCanvasStore } from '@/store/canvasStore';
import { screenToScene } from '@/engine/coordinates';
import { CanvasBackgroundPicker } from '../TopBar/MainMenu';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu';
import { clampToViewport, kbd, portalRoot } from '../ui/portal';
import { toggles } from '../commands';
import { run, setUi } from '../run';

const close = () => setUi({ contextMenu: null });

/** Right-click menu for elements or empty canvas (appState.contextMenu). */
export function ContextMenu() {
  const menu = useCanvasStore((s) => s.appState.contextMenu);
  if (!menu) return null;
  return <ContextMenuBody key={`${menu.x},${menu.y},${menu.kind}`} x={menu.x} y={menu.y} kind={menu.kind} />;
}

function ContextMenuBody({ x, y, kind }: { x: number; y: number; kind: 'element' | 'canvas' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const selected = useCanvasStore(useShallow(selectors.selectedElements));
  const grid = useCanvasStore((s) => s.appState.gridEnabled);
  const snap = useCanvasStore((s) => s.appState.snapEnabled);
  const zen = useCanvasStore((s) => s.appState.zenMode);
  const viewMode = useCanvasStore((s) => s.appState.viewModeEnabled);
  const theme = useCanvasStore((s) => s.appState.theme);

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos(clampToViewport(x, y, r.width, r.height));
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onScroll, { capture: true, passive: true });
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onScroll, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, []);

  const pick = (fn: () => unknown) => () => { close(); run(fn); };
  const scenePoint = () => {
    const a = useCanvasStore.getState().appState;
    return screenToScene(x, y, a);
  };

  const n = selected.length;
  const ungroupable = selected.some((e) => e.groupIds.length > 0);
  const allLocked = n > 0 && selected.every((e) => e.locked);

  return createPortal(
    <div
      ref={ref}
      className="sb-popover"
      style={{ left: pos?.x ?? x, top: pos?.y ?? y, visibility: pos ? 'visible' : 'hidden' }}
      data-testid="context-menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <Menu label={kind === 'element' ? 'Element actions' : 'Canvas actions'}>
        {kind === 'element' ? (
          <>
            {!viewMode && <MenuItem label="Cut" shortcut={kbd('Ctrl+X')} onSelect={pick(() => actions.cut())} />}
            <MenuItem label="Copy" shortcut={kbd('Ctrl+C')} onSelect={pick(() => actions.copy())} />
            {!viewMode && <MenuItem label="Paste" shortcut={kbd('Ctrl+V')} onSelect={pick(() => actions.paste(scenePoint()))} />}
            <MenuItem label="Copy to clipboard as PNG" shortcut={kbd('Shift+Alt+C')} onSelect={pick(() => actions.copyAsPNG())} />
            {!viewMode && (
              <>
                <MenuItem label="Duplicate" shortcut={kbd('Ctrl+D')} onSelect={pick(() => actions.duplicateSelected())} />
                <MenuItem label="Delete" shortcut="Delete" danger onSelect={pick(() => actions.deleteSelected())} />
                <MenuSeparator />
                <MenuItem label="Bring forward" shortcut={kbd('Ctrl+]')} onSelect={pick(() => actions.bringForward())} />
                <MenuItem label="Send backward" shortcut={kbd('Ctrl+[')} onSelect={pick(() => actions.sendBackward())} />
                <MenuItem label="Bring to front" shortcut={kbd('Ctrl+Shift+]')} onSelect={pick(() => actions.bringToFront())} />
                <MenuItem label="Send to back" shortcut={kbd('Ctrl+Shift+[')} onSelect={pick(() => actions.sendToBack())} />
                <MenuSeparator />
                {n > 1 && <MenuItem label="Group selection" shortcut={kbd('Ctrl+G')} onSelect={pick(() => actions.group())} />}
                {ungroupable && <MenuItem label="Ungroup selection" shortcut={kbd('Ctrl+Shift+G')} onSelect={pick(() => actions.ungroup())} />}
                <MenuItem label="Flip horizontal" shortcut="Shift+H" onSelect={pick(() => actions.flip('horizontal'))} />
                <MenuItem label="Flip vertical" shortcut="Shift+V" onSelect={pick(() => actions.flip('vertical'))} />
                <MenuItem label={allLocked ? 'Unlock' : 'Lock'} shortcut={kbd('Ctrl+Shift+L')} onSelect={pick(() => actions.toggleLock())} />
                <MenuItem label="Add to library" onSelect={pick(() => actions.addSelectionToLibrary())} />
              </>
            )}
          </>
        ) : (
          <>
            {!viewMode && <MenuItem label="Paste" shortcut={kbd('Ctrl+V')} onSelect={pick(() => actions.paste(scenePoint()))} />}
            {!viewMode && <MenuItem label="Select all" shortcut={kbd('Ctrl+A')} onSelect={pick(() => actions.selectAll())} />}
            <MenuSeparator />
            <MenuItem label={grid ? 'Hide grid' : 'Show grid'} shortcut={kbd("Ctrl+'")} onSelect={pick(toggles.grid)} />
            <MenuItem label={snap ? 'Disable snapping' : 'Enable snapping'} shortcut={kbd('Alt+S')} onSelect={pick(toggles.snap)} />
            <MenuItem label={zen ? 'Exit zen mode' : 'Zen mode'} shortcut={kbd('Alt+Z')} onSelect={pick(toggles.zen)} />
            <MenuItem label={viewMode ? 'Exit view mode' : 'View mode'} shortcut={kbd('Alt+R')} onSelect={pick(toggles.viewMode)} />
            <MenuItem label={theme === 'dark' ? 'Light mode' : 'Dark mode'} shortcut={kbd('Alt+Shift+D')} onSelect={pick(toggles.theme)} />
            <MenuItem label="Zoom to fit all elements" shortcut="Shift+1" onSelect={pick(() => actions.zoomToFit())} />
            <MenuSeparator />
            <div className="sb-menu-group-label">Canvas background</div>
            <div style={{ padding: '4px 10px 6px' }}>
              <CanvasBackgroundPicker />
            </div>
          </>
        )}
      </Menu>
    </div>,
    portalRoot(),
  );
}
