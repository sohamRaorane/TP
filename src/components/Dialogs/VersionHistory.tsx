import { useEffect, useState } from 'react';
import { ClockArrowLeft, CloudOff, FileImage, RotateCcw } from 'lucide-react';
import type { DrawingVersionSummary } from '@shared/protocol';
import { actions } from '@/services/actions';
import { useCanvasStore } from '@/store/canvasStore';
import { exportToCanvas } from '@/engine/rendering';
import { apiClient } from '../apiClient';
import { confirmDialog } from '../ui/confirm';
import { closeDialog } from '../commands';
import { errorMessage, run, toast } from '../run';
import { Drawer } from './Drawer';
import { relativeTime } from './DashboardDialog';

function Preview({ drawingId, versionId }: { drawingId: string; versionId: string }) {
  const theme = useCanvasStore((s) => s.appState.theme);
  const [src, setSrc] = useState<string | null | 'error'>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    apiClient
      .getVersion(drawingId, versionId)
      .then((v) => {
        const els = v.data.elements.filter((e) => !e.isDeleted);
        const canvas = exportToCanvas(els, v.data.files ?? {}, { scale: 1, padding: 16, background: theme === 'dark' ? '#121212' : '#ffffff', theme });
        if (alive) setSrc(canvas.toDataURL('image/png'));
      })
      .catch(() => alive && setSrc('error'));
    return () => { alive = false; };
  }, [drawingId, versionId, theme]);
  return (
    <div className="sb-checker flex items-center justify-center overflow-hidden" style={{ height: 150, borderRadius: 8, border: '1px solid var(--color-border)', margin: '8px 0' }}>
      {src === null && <span style={{ font: '400 12px var(--ui-font)', color: 'var(--color-muted)' }}>Loading preview…</span>}
      {src === 'error' && (
        <span className="flex flex-col items-center gap-1" style={{ font: '400 12px var(--ui-font)', color: 'var(--color-muted)', background: 'var(--island-bg)', padding: 8, borderRadius: 6 }}>
          <FileImage size={20} strokeWidth={1.4} /> Preview unavailable
        </span>
      )}
      {src && src !== 'error' && <img src={src} alt="Version preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
    </div>
  );
}

export function VersionHistory() {
  const drawingId = useCanvasStore((s) => s.appState.drawingId);
  const [versions, setVersions] = useState<DrawingVersionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!drawingId) return;
    let alive = true;
    apiClient
      .listVersions(drawingId)
      .then((v) => alive && setVersions(v))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => { alive = false; };
  }, [drawingId]);

  const restore = async (v: DrawingVersionSummary) => {
    if (!drawingId) return;
    const ok = await confirmDialog({
      title: 'Restore version',
      message: `Restore the version from ${new Date(v.createdAt).toLocaleString()}? The current state is kept in history.`,
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    try {
      await apiClient.restoreVersion(drawingId, v.id);
      closeDialog();
      run(() => actions.openDrawing(drawingId), { success: 'Version restored' });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <Drawer title="Version history" icon={<ClockArrowLeft size={18} />} onClose={closeDialog} testId="version-history">
      <div className="sb-scroll flex-1 overflow-y-auto" style={{ padding: '0 12px 16px' }}>
        {!drawingId && <Empty text="Save this drawing to the server to start keeping versions." />}
        {drawingId && error && <Empty offline text={`Can't load versions: ${error}`} />}
        {drawingId && !error && versions === null && <Empty text="Loading versions…" />}
        {versions && versions.length === 0 && <Empty text="No versions yet. Versions are created automatically as you work." />}
        {versions && versions.length > 0 && (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="version-list">
            {versions.map((v, i) => {
              const open = selected === v.id;
              return (
                <li key={v.id} style={{ borderRadius: 8, background: open ? 'var(--color-surface-high)' : 'transparent', marginBottom: 2 }}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 text-left hover:bg-[var(--color-surface-high)]"
                    style={{ border: 0, background: 'transparent', padding: '10px 10px', borderRadius: 8, cursor: 'pointer', color: 'var(--color-on-surface)' }}
                    aria-expanded={open}
                    onClick={() => setSelected(open ? null : v.id)}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 4, flex: '0 0 auto', background: i === 0 ? 'var(--color-primary)' : 'var(--color-border-strong)' }} />
                    <span className="flex-1">
                      <span style={{ display: 'block', font: '600 13px/1.3 var(--ui-font)' }}>{v.label ?? new Date(v.createdAt).toLocaleString()}</span>
                      <span style={{ font: '400 12px/1.3 var(--ui-font)', color: 'var(--color-muted)' }}>
                        {relativeTime(v.createdAt)} · {v.elementCount} element{v.elementCount === 1 ? '' : 's'}{i === 0 ? ' · latest' : ''}
                      </span>
                    </span>
                  </button>
                  {open && (
                    <div style={{ padding: '0 10px 10px' }}>
                      <Preview drawingId={drawingId!} versionId={v.id} />
                      <button type="button" className="sb-btn sb-btn--primary sb-btn--sm" onClick={() => restore(v)} data-testid="restore-version">
                        <RotateCcw size={14} /> Restore this version
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Drawer>
  );
}

function Empty({ text, offline }: { text: string; offline?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center" style={{ padding: '40px 16px', color: 'var(--color-muted)', font: '400 13px/1.5 var(--ui-font)' }}>
      {offline ? <CloudOff size={28} strokeWidth={1.4} /> : <ClockArrowLeft size={28} strokeWidth={1.4} />}
      {text}
    </div>
  );
}
