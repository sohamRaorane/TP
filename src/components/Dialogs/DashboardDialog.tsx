import { useCallback, useEffect, useState } from 'react';
import { CloudOff, Copy, FilePlus, FileText, Pencil, RefreshCw, Search, Trash } from 'lucide-react';
import type { DrawingSummary } from '@shared/protocol';
import { actions } from '@/services/actions';
import { useCanvasStore } from '@/store/canvasStore';
import { apiClient } from '../apiClient';
import { Dialog } from '../ui/Dialog';
import { Tooltip } from '../ui/Tooltip';
import { confirmDialog } from '../ui/confirm';
import { closeDialog } from '../commands';
import { errorMessage, run, runAsync, toast } from '../run';

export const relativeTime = (iso: string) => {
  const d = new Date(iso).getTime();
  const s = Math.round((Date.now() - d) / 1000);
  if (Number.isNaN(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
};

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; drawings: DrawingSummary[] };

function Card({ d, current, onChanged }: { d: DrawingSummary; current: boolean; onChanged: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(d.name);

  const commitRename = async () => {
    setRenaming(false);
    const next = name.trim();
    if (!next || next === d.name) { setName(d.name); return; }
    if (current) { await runAsync(() => actions.rename(next)); onChanged(); }
    else if (await runAsync(() => apiClient.renameDrawing(d.id, next))) onChanged();
  };

  return (
    <li
      className="group flex flex-col overflow-hidden"
      style={{ border: `1px solid ${current ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 10, background: 'var(--island-bg)' }}
      data-testid="drawing-card"
    >
      <button
        type="button"
        className="sb-checker relative block"
        style={{ border: 0, padding: 0, aspectRatio: '16 / 10', cursor: 'pointer', width: '100%' }}
        aria-label={`Open ${d.name}`}
        onClick={() => { closeDialog(); run(() => actions.openDrawing(d.id)); }}
      >
        {d.thumbnail ? (
          <img src={d.thumbnail} alt="" className="h-full w-full" style={{ objectFit: 'contain', background: '#fff' }} />
        ) : (
          <span className="flex h-full w-full items-center justify-center" style={{ background: 'var(--color-surface-mid)', color: 'var(--color-muted-2)' }}>
            <FileText size={28} strokeWidth={1.3} />
          </span>
        )}
        {current && (
          <span className="absolute" style={{ left: 8, top: 8, background: 'var(--color-primary)', color: 'var(--color-on-primary)', font: '600 11px var(--ui-font)', padding: '3px 7px', borderRadius: 6 }}>
            Current
          </span>
        )}
      </button>
      <div className="flex items-center gap-1" style={{ padding: '8px 6px 8px 10px', borderTop: '1px solid var(--color-border)' }}>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              className="sb-input sb-input--sm"
              aria-label="Drawing name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename();
                if (e.key === 'Escape') { e.stopPropagation(); setName(d.name); setRenaming(false); }
              }}
            />
          ) : (
            <div className="truncate" style={{ font: '600 14px/1.3 var(--ui-font)' }} title={d.name}>{d.name || 'Untitled drawing'}</div>
          )}
          <div style={{ font: '400 12px/1.4 var(--ui-font)', color: 'var(--color-muted)' }}>
            {relativeTime(d.updatedAt)} · {d.elementCount} element{d.elementCount === 1 ? '' : 's'}
          </div>
        </div>
        <Tooltip label="Rename">
          <button type="button" className="sb-tool" style={{ width: 30, height: 30 }} aria-label={`Rename ${d.name}`} onClick={() => setRenaming(true)}><Pencil size={15} /></button>
        </Tooltip>
        <Tooltip label="Duplicate">
          <button
            type="button"
            className="sb-tool"
            style={{ width: 30, height: 30 }}
            aria-label={`Duplicate ${d.name}`}
            onClick={async () => { if (await runAsync(() => apiClient.duplicateDrawing(d.id))) { toast('Drawing duplicated', 'success'); onChanged(); } }}
          >
            <Copy size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Delete">
          <button
            type="button"
            className="sb-tool"
            style={{ width: 30, height: 30, color: 'var(--color-danger-strong)' }}
            aria-label={`Delete ${d.name}`}
            onClick={async () => {
              const ok = await confirmDialog({ title: 'Delete drawing', message: `"${d.name}" will be permanently deleted. This cannot be undone.`, confirmLabel: 'Delete', danger: true });
              if (!ok) return;
              try { await apiClient.deleteDrawing(d.id); toast('Drawing deleted', 'success'); onChanged(); } catch (e) { toast(errorMessage(e), 'error'); }
            }}
          >
            <Trash size={15} />
          </button>
        </Tooltip>
      </div>
    </li>
  );
}

export function DashboardDialog() {
  const currentId = useCanvasStore((s) => s.appState.drawingId);
  const [search, setSearch] = useState('');
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async (q: string) => {
    try {
      const drawings = await apiClient.listDrawings(q);
      setState({ kind: 'ready', drawings });
    } catch (e) {
      setState({ kind: 'error', message: errorMessage(e) });
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(search), search ? 220 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  return (
    <Dialog title="Your drawings" onClose={closeDialog} width={920} testId="dashboard-dialog" initialFocus="input">
      <div className="flex flex-wrap items-center gap-2" style={{ padding: '4px 24px 14px' }}>
        <div className="relative" style={{ flex: '1 1 240px' }}>
          <Search size={16} className="absolute" style={{ left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted-2)' }} />
          <input className="sb-input" style={{ paddingLeft: 32 }} placeholder="Search drawings…" aria-label="Search drawings" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="dashboard-search" />
        </div>
        <button type="button" className="sb-btn sb-btn--primary" data-testid="dashboard-new" onClick={() => { closeDialog(); run(() => actions.newDrawing()); }}>
          <FilePlus size={16} /> New drawing
        </button>
      </div>
      <div className="sb-dialog__body sb-scroll" style={{ minHeight: 260 }}>
        {state.kind === 'loading' && (
          <ul className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, listStyle: 'none', margin: 0, padding: 0 }} aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} style={{ height: 180, borderRadius: 10, background: 'var(--color-surface-mid)', animation: 'sb-fade-in 0.8s ease-in-out infinite alternate' }} />
            ))}
          </ul>
        )}
        {state.kind === 'error' && (
          <div className="flex flex-col items-center gap-3 text-center" style={{ padding: '48px 16px', color: 'var(--color-muted)', font: '400 14px/1.5 var(--ui-font)' }} role="alert">
            <CloudOff size={36} strokeWidth={1.4} />
            <strong style={{ color: 'var(--color-on-surface)', fontSize: 16 }}>Can't reach the server</strong>
            <span>Your drawings are stored on the Sketchboard server, which seems to be offline ({state.message}).<br />Your current drawing is still saved locally in this browser.</span>
            <button type="button" className="sb-btn sb-btn--outline sb-btn--sm" onClick={() => { setState({ kind: 'loading' }); void load(search); }}>
              <RefreshCw size={14} /> Try again
            </button>
          </div>
        )}
        {state.kind === 'ready' && state.drawings.length === 0 && (
          <div className="flex flex-col items-center gap-3 text-center" style={{ padding: '48px 16px', color: 'var(--color-muted)', font: '400 14px/1.5 var(--ui-font)' }}>
            <FileText size={36} strokeWidth={1.4} />
            <strong style={{ color: 'var(--color-on-surface)', fontSize: 16 }}>{search ? 'No drawings match your search' : 'No drawings yet'}</strong>
            {!search && <span>Start drawing and it will be saved here automatically.</span>}
          </div>
        )}
        {state.kind === 'ready' && state.drawings.length > 0 && (
          <ul className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, listStyle: 'none', margin: 0, padding: 0 }} data-testid="drawing-list">
            {state.drawings.map((d) => <Card key={d.id} d={d} current={d.id === currentId} onChanged={() => void load(search)} />)}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
