import { useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Check, CloudOff, LoaderCircle, Menu as MenuIcon } from 'lucide-react';
import { actions } from '@/services/actions';
import { useCanvasStore } from '@/store/canvasStore';
import type { SaveStatus } from '@/types/appState';
import { LogoMark } from '../icons';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { run } from '../run';
import { MainMenu } from './MainMenu';

const STATUS: Record<Exclude<SaveStatus, 'idle'>, { label: string; color: string; icon: ReactNode }> = {
  saved: { label: 'Saved', color: 'var(--color-muted-2)', icon: <Check size={13} /> },
  saving: { label: 'Saving…', color: 'var(--color-muted-2)', icon: <LoaderCircle size={13} className="sb-spin" /> },
  unsaved: { label: 'Unsaved', color: 'var(--color-muted-2)', icon: <span style={{ width: 6, height: 6, borderRadius: 3, background: '#f08c00', display: 'inline-block' }} /> },
  offline: { label: 'Offline', color: '#e8590c', icon: <CloudOff size={13} /> },
  error: { label: 'Save failed', color: 'var(--color-danger-strong)', icon: <AlertCircle size={13} /> },
};

function SaveIndicator() {
  const status = useCanvasStore((s) => s.appState.saveStatus);
  const lastSavedAt = useCanvasStore((s) => s.appState.lastSavedAt);
  if (status === 'idle') return null;
  const s = STATUS[status];
  const when = lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : s.label;
  return (
    <Tooltip label={when}>
      <span
        role="status"
        aria-live="polite"
        data-testid="save-status"
        className="sb-hide-narrow inline-flex items-center gap-1 whitespace-nowrap"
        style={{ color: s.color, font: '500 12px/1 var(--ui-font)', padding: '0 8px 0 2px' }}
      >
        {s.icon}
        {s.label}
      </span>
    </Tooltip>
  );
}

function DrawingName() {
  const name = useCanvasStore((s) => s.appState.name);
  const viewMode = useCanvasStore((s) => s.appState.viewModeEnabled);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== name) run(() => actions.rename(next));
  };

  if (editing)
    return (
      <input
        autoFocus
        aria-label="Drawing name"
        data-testid="drawing-name-input"
        className="sb-input sb-input--sm"
        style={{ width: Math.min(260, Math.max(120, draft.length * 8 + 24)) }}
        value={draft}
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
        }}
      />
    );
  return (
    <Tooltip label={viewMode ? name : 'Rename drawing'}>
      <button
        type="button"
        data-testid="drawing-name"
        disabled={viewMode}
        className="truncate rounded-md px-1.5 py-1 text-left hover:bg-[var(--button-hover)] disabled:hover:bg-transparent"
        style={{ maxWidth: 220, font: '600 14px/1.2 var(--ui-font)', color: 'var(--color-on-surface)', background: 'transparent', border: 0, cursor: viewMode ? 'default' : 'text' }}
        onClick={() => { setDraft(name); setEditing(true); }}
      >
        {name || 'Untitled drawing'}
      </button>
    </Tooltip>
  );
}

export function TopLeft() {
  const [menuOpen, setMenuOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <div className="absolute flex items-center gap-2" style={{ left: 16, top: 16 }}>
      <div className="sb-island">
        <IconButton
          ref={btn}
          label="Main menu"
          icon={<MenuIcon size={18} />}
          active={menuOpen}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-testid="main-menu-button"
          tooltip={!menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        />
      </div>
      <div className="sb-island flex items-center gap-1" style={{ height: 36, padding: '0 4px 0 8px' }}>
        <span className="inline-flex shrink-0" title="Sketchboard"><LogoMark size={22} /></span>
        <span className="sb-hide-narrow" style={{ font: '700 14px/1 var(--font-hand)', color: 'var(--color-primary)', marginRight: 2, marginTop: 2 }}>
          Sketchboard
        </span>
        <span className="sb-hide-narrow" aria-hidden style={{ width: 1, height: 18, background: 'var(--color-border)', margin: '0 4px' }} />
        <DrawingName />
        <SaveIndicator />
      </div>
      {menuOpen && <MainMenu anchor={btn.current} onClose={() => setMenuOpen(false)} />}
    </div>
  );
}
