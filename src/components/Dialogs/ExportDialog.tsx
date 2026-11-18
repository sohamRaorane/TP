import { useEffect, useRef, useState } from 'react';
import { Clipboard, Download, FileImage } from 'lucide-react';
import { actions } from '@/services/actions';
import { useCanvasStore } from '@/store/canvasStore';
import { exportToCanvas } from '@/engine/rendering';
import { Dialog } from '../ui/Dialog';
import { Switch } from '../ui/Switch';
import { closeDialog } from '../commands';
import { run } from '../run';

export function ExportDialog() {
  const hasSelection = useCanvasStore((s) => Object.keys(s.appState.selectedElementIds).length > 0);
  const theme = useCanvasStore((s) => s.appState.theme);
  const viewBg = useCanvasStore((s) => s.appState.viewBackgroundColor);
  const [background, setBackground] = useState(true);
  const [dark, setDark] = useState(theme === 'dark');
  const [onlySelected, setOnlySelected] = useState(hasSelection);
  const [scale, setScale] = useState(2);
  const preview = useRef<HTMLDivElement>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const host = preview.current;
    if (!host) return;
    const s = useCanvasStore.getState();
    const els = s.elements.filter((e) => !e.isDeleted && (!onlySelected || s.appState.selectedElementIds[e.id]));
    host.replaceChildren();
    if (!els.length) { setPreviewError('Nothing to export'); setSize(null); return; }
    try {
      const canvas = exportToCanvas(els, s.files, { scale, padding: 10, background: background ? viewBg : null, theme: dark ? 'dark' : 'light' });
      canvas.style.maxWidth = '100%';
      canvas.style.maxHeight = '100%';
      canvas.style.objectFit = 'contain';
      host.appendChild(canvas);
      setSize({ w: canvas.width, h: canvas.height });
      setPreviewError(null);
    } catch (e) {
      console.warn('[export] preview failed', e);
      setPreviewError('Preview unavailable');
      setSize(null);
    }
  }, [background, dark, onlySelected, scale, viewBg]);

  const opts = { transparent: !background, onlySelected, dark };

  return (
    <Dialog title="Export image" onClose={closeDialog} width={880} testId="export-dialog">
      <div className="sb-dialog__body flex flex-wrap gap-6" style={{ paddingTop: 12 }}>
        <div
          className="sb-checker relative flex items-center justify-center overflow-hidden"
          style={{ flex: '1 1 380px', height: 340, borderRadius: 10, border: '1px solid var(--color-border)' }}
          data-testid="export-preview"
        >
          <div ref={preview} className="flex h-full w-full items-center justify-center" style={{ padding: 16, boxSizing: 'border-box' }} />
          {previewError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ color: 'var(--color-muted)', font: '500 14px var(--ui-font)', background: 'color-mix(in srgb, var(--island-bg) 70%, transparent)' }}>
              <FileImage size={28} strokeWidth={1.5} />
              {previewError}
            </div>
          )}
          {size && (
            <span className="absolute" style={{ right: 8, bottom: 8, font: '500 11px var(--ui-font)', color: 'var(--color-muted)', background: 'var(--island-bg)', padding: '3px 6px', borderRadius: 4 }}>
              {size.w} × {size.h}px
            </span>
          )}
        </div>
        <div className="flex flex-col" style={{ flex: '1 1 260px', gap: 6 }}>
          <Switch label="Background" checked={background} onChange={setBackground} testId="export-background" />
          <Switch label="Dark mode" checked={dark} onChange={setDark} testId="export-dark" />
          <Switch label="Only selected" checked={onlySelected && hasSelection} onChange={(v) => hasSelection && setOnlySelected(v)} testId="export-only-selected" hint={hasSelection ? undefined : 'Select elements to enable'} />
          <div className="flex items-center justify-between" style={{ minHeight: 36 }}>
            <span style={{ font: '500 14px var(--ui-font)' }}>Scale</span>
            <div className="sb-row" role="radiogroup" aria-label="Scale">
              {[1, 2, 3].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={scale === n} className="sb-opt sb-opt--text" data-testid={`export-scale-${n}`} onClick={() => setScale(n)}>
                  {n}×
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex flex-wrap gap-2" style={{ marginTop: 16 }}>
            <button type="button" className="sb-btn sb-btn--primary" style={{ flex: 1 }} data-testid="export-png" onClick={() => run(() => actions.exportPNG({ scale, ...opts }))}>
              <Download size={16} /> PNG
            </button>
            <button type="button" className="sb-btn sb-btn--primary" style={{ flex: 1 }} data-testid="export-svg" onClick={() => run(() => actions.exportSVG(opts))}>
              <Download size={16} /> SVG
            </button>
          </div>
          <button type="button" className="sb-btn sb-btn--outline" data-testid="export-copy" onClick={() => run(() => actions.copyAsPNG(), { success: 'Copied to clipboard as PNG' })}>
            <Clipboard size={16} /> Copy to clipboard
          </button>
        </div>
      </div>
    </Dialog>
  );
}
