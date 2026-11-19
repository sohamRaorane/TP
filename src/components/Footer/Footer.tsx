import { ChartNoAxesColumn, Focus, Map as MapIcon, Maximize, Minus, Plus, Wifi, WifiOff } from 'lucide-react';
import { actions } from '@/services/actions';
import { useCanvasStore } from '@/store/canvasStore';
import { useCollaborationStore } from '@/store/collaborationStore';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { kbd } from '../ui/portal';
import { openDialog, toggles } from '../commands';
import { run } from '../run';

export function ZoomControls() {
  const zoom = useCanvasStore((s) => s.appState.zoom);
  const hasSelection = useCanvasStore((s) => Object.keys(s.appState.selectedElementIds).length > 0);
  const minimap = useCanvasStore((s) => s.appState.showMinimap);
  return (
    <div className="sb-footer-left absolute flex items-center gap-2" style={{ left: 16, bottom: 16 }}>
      <div className="sb-island flex items-center" role="group" aria-label="Zoom">
        <IconButton label="Zoom out" shortcut={kbd('Ctrl+-')} side="top" icon={<Minus size={16} />} data-testid="zoom-out" onClick={() => run(() => actions.zoomOut())} />
        <Tooltip label="Reset zoom" shortcut={kbd('Ctrl+0')} side="top">
          <button
            type="button"
            className="sb-tool"
            style={{ width: 'auto', minWidth: 58, padding: '0 6px', font: '500 13px/1 var(--ui-font)', fontVariantNumeric: 'tabular-nums' }}
            aria-label={`Zoom ${Math.round(zoom * 100)}%. Reset zoom`}
            data-testid="zoom-reset"
            onClick={() => run(() => actions.resetZoom())}
          >
            {Math.round(zoom * 100)}%
          </button>
        </Tooltip>
        <IconButton label="Zoom in" shortcut={kbd('Ctrl++')} side="top" icon={<Plus size={16} />} data-testid="zoom-in" onClick={() => run(() => actions.zoomIn())} />
      </div>
      <div className="sb-island flex items-center sb-hide-narrow">
        <IconButton label="Zoom to fit all elements" shortcut="Shift+1" side="top" icon={<Maximize size={16} />} data-testid="zoom-fit" onClick={() => run(() => actions.zoomToFit())} />
        <IconButton label="Zoom to selection" shortcut="Shift+2" side="top" disabled={!hasSelection} icon={<Focus size={16} />} data-testid="zoom-selection" onClick={() => run(() => actions.zoomToSelection())} />
        <IconButton label={minimap ? 'Hide minimap' : 'Show minimap'} shortcut="Alt+M" side="top" active={minimap} aria-pressed={minimap} icon={<MapIcon size={16} />} data-testid="minimap-toggle" onClick={toggles.minimap} />
      </div>
    </div>
  );
}

function ConnectionChip() {
  const roomId = useCollaborationStore((s) => s.roomId);
  const status = useCollaborationStore((s) => s.status);
  const role = useCollaborationStore((s) => s.role);
  const count = useCollaborationStore((s) => s.collaborators.length);
  if (!roomId) return null;
  const ok = status === 'connected';
  const color = ok ? 'var(--color-success)' : status === 'disconnected' ? 'var(--color-danger-strong)' : '#f08c00';
  const label = ok ? `Live · ${count + 1}` : status === 'connecting' ? 'Connecting…' : status === 'reconnecting' ? 'Reconnecting…' : 'Disconnected';
  return (
    <Tooltip label={`${ok ? 'Connected' : label}${role === 'view' ? ' (view only)' : ''} — open session`} side="top">
      <button
        type="button"
        className="sb-island inline-flex items-center gap-1.5"
        role="status"
        aria-live="polite"
        data-testid="connection-chip"
        style={{ height: 36, padding: '0 12px', border: 0, cursor: 'pointer', font: '500 13px/1 var(--ui-font)', color: 'var(--color-on-surface)' }}
        onClick={() => openDialog('share')}
      >
        <span style={{ width: 8, height: 8, borderRadius: 4, background: color, boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)` }} />
        {ok ? <Wifi size={14} /> : <WifiOff size={14} />}
        {label}
      </button>
    </Tooltip>
  );
}

export function FooterRight() {
  const stats = useCanvasStore((s) => s.appState.openDialog === 'stats');
  return (
    <div className="absolute flex items-center gap-2" style={{ right: 16, bottom: 16 }}>
      <ConnectionChip />
      <div className="sb-island flex items-center sb-hide-narrow">
        <IconButton label={stats ? 'Hide stats' : 'Stats for nerds'} shortcut="Alt+/" side="top" active={stats} aria-pressed={stats} icon={<ChartNoAxesColumn size={16} />} data-testid="stats-toggle" onClick={toggles.stats} />
      </div>
    </div>
  );
}
