import { ChevronLeft, ChevronRight, Eye, LogOut, X } from 'lucide-react';
import { actions } from '@/services/actions';
import { useCanvasStore } from '@/store/canvasStore';
import { useCollaborationStore } from '@/store/collaborationStore';
import { IconButton } from '../ui/IconButton';
import { toggles } from '../commands';
import { run } from '../run';

/** Bottom bar shown during presentation mode (all other chrome hidden). */
export function PresentationBar() {
  const active = useCanvasStore((s) => s.appState.presentation.active);
  const index = useCanvasStore((s) => s.appState.presentation.frameIndex);
  const total = useCanvasStore((s) => s.elements.reduce((n, e) => n + (e.type === 'frame' && !e.isDeleted ? 1 : 0), 0));
  if (!active) return null;
  return (
    <div className="absolute" style={{ left: '50%', bottom: 20, transform: 'translateX(-50%)' }}>
      <div className="sb-island flex items-center gap-1" style={{ padding: 4 }} role="toolbar" aria-label="Presentation controls" data-testid="presentation-bar">
        <IconButton label="Previous slide" shortcut="←" side="top" icon={<ChevronLeft size={18} />} disabled={index <= 0} onClick={() => run(() => actions.prevSlide())} />
        <span aria-live="polite" style={{ minWidth: 92, textAlign: 'center', font: '600 14px var(--ui-font)', fontVariantNumeric: 'tabular-nums' }}>
          {total ? `Slide ${Math.min(index + 1, total)} / ${total}` : 'No frames'}
        </span>
        <IconButton label="Next slide" shortcut="→" side="top" icon={<ChevronRight size={18} />} disabled={index >= total - 1} onClick={() => run(() => actions.nextSlide())} />
        <span className="sb-vdivider" style={{ height: 22, alignSelf: 'center' }} />
        <button type="button" className="sb-btn sb-btn--ghost sb-btn--sm" onClick={() => run(() => actions.stopPresentation())} data-testid="presentation-exit">
          <LogOut size={15} /> Exit
        </button>
      </div>
    </div>
  );
}

/** Small exit button while zen mode hides the panels. */
export function ZenExit() {
  const zen = useCanvasStore((s) => s.appState.zenMode && !s.appState.presentation.active);
  if (!zen) return null;
  return (
    <div className="absolute" style={{ left: '50%', bottom: 16, transform: 'translateX(-50%)' }}>
      <button type="button" className="sb-btn sb-btn--sm" style={{ background: 'var(--island-bg)', boxShadow: 'var(--island-shadow)' }} onClick={toggles.zen} data-testid="zen-exit">
        <X size={14} /> Exit zen mode
      </button>
    </div>
  );
}

/** "View only" badge while view mode is enabled. */
export function ViewModeBadge() {
  const view = useCanvasStore((s) => s.appState.viewModeEnabled && !s.appState.presentation.active);
  const forced = useCollaborationStore((s) => !!s.roomId && s.role === 'view');
  if (!view) return null;
  return (
    <div className="absolute" style={{ left: '50%', top: 16, transform: 'translateX(-50%)' }}>
      <div className="sb-island flex items-center gap-2" style={{ height: 36, padding: '0 6px 0 12px', font: '600 13px var(--ui-font)' }} data-testid="view-mode-badge">
        <Eye size={16} style={{ color: 'var(--color-primary)' }} />
        View only
        {!forced ? (
          <button type="button" className="sb-btn sb-btn--sm" onClick={toggles.viewMode}>Exit</button>
        ) : (
          <span style={{ width: 6 }} />
        )}
      </div>
    </div>
  );
}

/** Colored frame and banner while following a collaborator's viewport. */
export function FollowBanner() {
  const socketId = useCanvasStore((s) => s.appState.followingSocketId);
  const user = useCollaborationStore((s) => s.collaborators.find((c) => c.socketId === socketId));
  if (!socketId) return null;
  const color = user?.color ?? 'var(--color-primary)';
  return (
    <>
      <div className="pointer-events-none absolute inset-0" style={{ boxShadow: `inset 0 0 0 3px ${color}`, zIndex: 9 }} aria-hidden />
      <div className="absolute" style={{ left: '50%', top: 0, transform: 'translateX(-50%)', zIndex: 11 }}>
        <div
          className="flex items-center gap-2"
          style={{ background: color, color: '#fff', padding: '4px 4px 4px 12px', borderRadius: '0 0 8px 8px', font: '600 13px var(--ui-font)' }}
          role="status"
          data-testid="follow-banner"
        >
          Following {user?.name ?? 'collaborator'}
          <button
            type="button"
            className="inline-flex items-center justify-center"
            style={{ width: 22, height: 22, border: 0, borderRadius: 4, background: 'rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer' }}
            aria-label="Stop following"
            onClick={() => run(() => actions.followUser(null))}
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </>
  );
}
